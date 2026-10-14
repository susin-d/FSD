const crypto = require("node:crypto");
const Booking = require("../bookings/booking.model");
const ProviderProfile = require("../providers/provider.model");
const User = require("../users/user.model");
const MarketplaceSettings = require("../settings/marketplace-settings.model");
const Payment = require("./payment.model");
const WebhookEvent = require("./webhook-event.model");
const Dispute = require("../disputes/dispute.model");
const { getProviderWindow, reserveSlot, setReservationState } = require("../availability/service");
const { ensure, LifecycleError, recordAudit, sendEmail } = require("../../utils/lifecycle");

const RAZORPAY_API = "https://api.razorpay.com/v1";

function razorpayCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  ensure(keyId && keySecret && webhookSecret, 503, "Razorpay credentials and webhook secret are not configured", "PAYMENTS_NOT_CONFIGURED");
  return { keyId, keySecret, webhookSecret };
}

async function requireLaunchSettings() {
  const settings = await MarketplaceSettings.findOne({ key: "marketplace" }).lean();
  const policy = settings?.cancellationPolicy;
  const configured = Number.isInteger(settings?.commissionBps) &&
    Number.isInteger(settings?.checkoutTimeoutMinutes) &&
    Number.isInteger(settings?.completionReviewHours) &&
    Number.isInteger(policy?.customerEarlyWindowHours) &&
    Number.isInteger(policy?.customerEarlyRefundBps) &&
    Number.isInteger(policy?.customerLateRefundBps) &&
    Number.isInteger(policy?.providerCancelRefundBps);
  ensure(configured, 503, "Commission, cancellation/refund rules, checkout timeout, and completion review period must be configured before checkout", "MARKETPLACE_NOT_CONFIGURED");
  ensure(settings.razorpayRouteEnabled === true, 503, "Razorpay Route is not enabled in marketplace settings", "ROUTE_NOT_CONFIGURED");
  const credentials = razorpayCredentials();
  return { ...settings, credentials };
}

async function razorpayRequest(method, path, body, extraHeaders = {}) {
  const { keyId, keySecret } = razorpayCredentials();
  let response;
  try {
    response = await fetch(`${RAZORPAY_API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const failure = new LifecycleError(502, "Could not reach Razorpay", "RAZORPAY_UNAVAILABLE");
    failure.ambiguous = true;
    throw failure;
  }
  let payload = {};
  try {
    payload = await response.json();
  } catch (_error) {
    // Preserve the generic provider error below for non-JSON responses.
  }
  if (!response.ok) {
    const providerMessage = payload?.error?.description;
    const safeMessage = typeof providerMessage === "string" && providerMessage.length < 250
      ? `Razorpay rejected the request: ${providerMessage}`
      : "Razorpay rejected the request";
    const failure = new LifecycleError(502, safeMessage, "RAZORPAY_REQUEST_FAILED");
    failure.ambiguous = response.status >= 500;
    throw failure;
  }
  return payload;
}

function equalHexSignatures(expected, received) {
  if (typeof received !== "string" || !/^[a-f\d]{64}$/i.test(received)) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const receivedBytes = Buffer.from(received, "hex");
  return expectedBytes.length === receivedBytes.length && crypto.timingSafeEqual(expectedBytes, receivedBytes);
}

function calculateRetainedAllocation(amountPaise, refundedAmountPaise, commissionBps) {
  const retainedAmountPaise = Math.max(0, amountPaise - refundedAmountPaise);
  const commissionPaise = Math.floor((retainedAmountPaise * commissionBps) / 10_000);
  return {
    retainedAmountPaise,
    commissionPaise,
    providerAmountPaise: retainedAmountPaise - commissionPaise,
  };
}

async function createCheckout({ bookingId, customerId, req }) {
  let booking = await Booking.findById(bookingId);
  ensure(booking, 404, "Booking not found", "BOOKING_NOT_FOUND");
  ensure(String(booking.customer) === String(customerId), 403, "Only the booking customer can start checkout", "FORBIDDEN");

  if (["accepted", "awaiting_payment"].includes(booking.status) && booking.slotHoldExpiresAt && booking.slotHoldExpiresAt <= new Date()) {
    const { expireCheckoutHolds } = require("../../utils/lifecycle");
    await expireCheckoutHolds();
    booking = await Booking.findById(bookingId);
  }
  ensure(["accepted", "checkout_expired", "awaiting_payment"].includes(booking.status), 409, "Checkout is available only after provider acceptance", "BOOKING_STATE_CONFLICT");

  const settings = await requireLaunchSettings();
  const provider = await ProviderProfile.findById(booking.provider).select("+razorpayAccountId");
  ensure(provider?.verificationStatus === "verified", 409, "Provider verification is no longer active", "PROVIDER_NOT_VERIFIED");
  ensure(provider.razorpayAccountId, 503, "Provider has no configured Razorpay Route linked account", "ROUTE_ACCOUNT_NOT_CONFIGURED");
  ensure((provider.servicePincodes || []).includes(booking.servicePincode), 409, "Provider no longer serves this exact pincode", "PINCODE_NOT_SERVED");

  const existing = await Payment.findOne({ booking: booking._id });
  ensure(!existing?.orderCreationReconciliationRequired, 503, "A previous order creation needs payment-provider reconciliation before checkout can be retried", "ORDER_RECONCILIATION_REQUIRED");
  if (["paid", "partially_refunded"].includes(existing?.status)) throw new LifecycleError(409, "This booking has already been paid", "PAYMENT_ALREADY_CAPTURED");
  if (existing?.status === "created" && existing.checkoutExpiresAt > new Date() && booking.status === "awaiting_payment") {
    ensure(existing.providerAccountId === provider.razorpayAccountId, 409, "Provider Route account changed; a new checkout is required", "ROUTE_ACCOUNT_CHANGED");
    return { keyId: settings.credentials.keyId, orderId: existing.razorpayOrderId, amount: existing.amountPaise, currency: "INR", bookingId: String(booking._id), expiresAt: existing.checkoutExpiresAt };
  }

  const startsAt = new Date(booking.scheduledAt);
  const endsAt = new Date(startsAt.getTime() + booking.durationMinutes * 60_000);
  ensure(await getProviderWindow(provider._id, startsAt, endsAt), 409, "Provider availability has changed; select another time", "OUTSIDE_AVAILABILITY");

  const currentHoldIsActive = booking.slotHoldExpiresAt && booking.slotHoldExpiresAt > new Date();
  const expiresAt = currentHoldIsActive
    ? new Date(booking.slotHoldExpiresAt)
    : new Date(Date.now() + settings.checkoutTimeoutMinutes * 60_000);
  const reserved = await reserveSlot({ providerId: provider._id, bookingId: booking._id, startsAt, endsAt, expiresAt });
  ensure(reserved, 409, "The requested time has already been held or booked", "SLOT_UNAVAILABLE");

  if (["accepted", "checkout_expired"].includes(booking.status)) {
    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, customer: customerId, status: booking.status },
      { $set: { status: "awaiting_payment", slotHoldExpiresAt: expiresAt } },
      { new: true }
    );
    if (!updated) {
      await setReservationState(booking._id, "expired");
      throw new LifecycleError(409, "Booking state changed; reload before checking out", "BOOKING_STATE_CONFLICT");
    }
    booking = updated;
  } else {
    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, customer: customerId, status: "awaiting_payment", slotHoldExpiresAt: { $gt: new Date() } },
      { $set: { slotHoldExpiresAt: expiresAt } },
      { new: true }
    );
    if (!updated) {
      await setReservationState(booking._id, "expired");
      throw new LifecycleError(409, "Checkout hold has expired; please retry", "CHECKOUT_EXPIRED");
    }
    booking = updated;
  }

  const commissionBps = settings.commissionBps;
  const commissionPaise = Math.floor((booking.pricePaise * commissionBps) / 10_000);
  const providerAmountPaise = booking.pricePaise - commissionPaise;
  ensure(providerAmountPaise > 0, 503, "The configured commission leaves no amount for provider settlement", "INVALID_COMMISSION");

  let payment;
  if (existing) {
    if (existing.razorpayOrderId || existing.razorpayPaymentId || existing.status === "refunded") {
      existing.attemptHistory.push({
        orderId: existing.razorpayOrderId || null,
        paymentId: existing.razorpayPaymentId || null,
        status: existing.status,
        refundedAmountPaise: existing.refundedAmountPaise || 0,
        providerRefundedAmountPaise: existing.providerRefundedAmountPaise || 0,
        refundIds: [...(existing.refundIds || [])],
        transferId: existing.razorpayTransferId || null,
        transferStatus: existing.transferStatus || "not_created",
      });
      await existing.save();
    }
    payment = await Payment.findOneAndUpdate(
      { _id: existing._id, status: { $in: ["failed", "expired", "refunded"] } },
      {
        $set: {
          customer: customerId,
          provider: provider._id,
          providerAccountId: provider.razorpayAccountId,
          amountPaise: booking.pricePaise,
          commissionPaise,
          commissionBps,
          providerAmountPaise,
          currency: "INR",
          status: "creating",
          orderCreationReconciliationRequired: false,
          razorpayOrderId: null,
          razorpayPaymentId: null,
          checkoutExpiresAt: expiresAt,
          refundedAmountPaise: 0,
          providerRefundedAmountPaise: 0,
          captureProcessingLeaseUntil: null,
          refundInProgress: false,
          refundOperation: { key: null, amountPaise: null, previousRefundedPaise: null, status: null, requestStarted: false, reason: "", refundId: null },
          refundReconciliationRequired: false,
          transferReconciliationRequired: false,
          transferStatus: "not_created",
          razorpayTransferId: null,
          routeReversalOperation: { key: null, amountPaise: null, status: null, refundId: null, transferId: null, reversalId: null },
          lastError: "",
        },
      },
      { new: true }
    );
    ensure(payment, 409, "A payment is already being initialized for this booking", "CHECKOUT_IN_PROGRESS");
  } else {
    payment = await Payment.create({
      booking: booking._id,
      customer: customerId,
      provider: provider._id,
      providerAccountId: provider.razorpayAccountId,
      amountPaise: booking.pricePaise,
      commissionPaise,
      commissionBps,
      providerAmountPaise,
      currency: "INR",
      status: "creating",
      checkoutExpiresAt: expiresAt,
      razorpayOrderIds: [],
      orderCreationReconciliationRequired: false,
    });
  }

  try {
    const order = await razorpayRequest("POST", "/orders", {
      amount: payment.amountPaise,
      currency: "INR",
      receipt: String(booking._id),
      payment_capture: 1,
      notes: { booking_id: String(booking._id), customer_id: String(customerId) },
    });
    payment.razorpayOrderId = order.id;
    if (!payment.razorpayOrderIds.includes(order.id)) payment.razorpayOrderIds.push(order.id);
    payment.status = "created";
    await payment.save();
    await recordAudit({ actorId: customerId, action: "payment.order_created", resourceType: "payment", resourceId: payment._id, metadata: { bookingId: String(booking._id), amountPaise: payment.amountPaise }, req });
    return { keyId: settings.credentials.keyId, orderId: order.id, amount: payment.amountPaise, currency: "INR", bookingId: String(booking._id), expiresAt };
  } catch (error) {
    payment.status = error.ambiguous ? "creating" : "failed";
    payment.orderCreationReconciliationRequired = Boolean(error.ambiguous);
    payment.lastError = error.message;
    await payment.save().catch(() => undefined);
    await Booking.updateOne({ _id: booking._id, status: "awaiting_payment" }, { $set: { status: "checkout_expired", slotHoldExpiresAt: null } });
    await setReservationState(booking._id, "expired");
    throw error;
  }
}

async function verifyCheckout({ bookingId, customerId, body, req }) {
  const orderId = body?.razorpay_order_id;
  const paymentId = body?.razorpay_payment_id;
  const signature = body?.razorpay_signature;
  ensure(typeof orderId === "string" && typeof paymentId === "string" && typeof signature === "string", 400, "Razorpay order, payment, and signature values are required", "INVALID_CHECKOUT_SIGNATURE");
  const payment = await Payment.findOne({ booking: bookingId, customer: customerId });
  ensure(payment, 404, "Payment was not found for this booking", "PAYMENT_NOT_FOUND");
  ensure(payment.razorpayOrderId === orderId || (payment.razorpayOrderIds || []).includes(orderId), 400, "Razorpay order does not match this booking", "ORDER_MISMATCH");
  const { keySecret } = razorpayCredentials();
  const expected = crypto.createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  ensure(equalHexSignatures(expected, signature), 400, "Razorpay signature could not be verified", "INVALID_CHECKOUT_SIGNATURE");

  let remote = await razorpayRequest("GET", `/payments/${encodeURIComponent(paymentId)}`);
  ensure(remote.order_id === orderId, 400, "Razorpay payment does not belong to this order", "ORDER_MISMATCH");
  ensure(Number(remote.amount) === payment.amountPaise && remote.currency === "INR", 400, "Razorpay payment amount does not match this booking", "PAYMENT_AMOUNT_MISMATCH");
  if (remote.status === "authorized") {
    remote = await razorpayRequest("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: payment.amountPaise, currency: "INR" });
  }
  ensure(remote.status === "captured", 409, "Razorpay has not captured this payment yet", "PAYMENT_NOT_CAPTURED");
  const result = await markPaymentCaptured(payment, remote, { signatureVerified: true, req });
  return { payment: publicPayment(result.payment), bookingStatus: result.booking?.status || "cancelled", transferPending: result.payment.transferStatus === "failed" };
}

async function markPaymentCaptured(paymentArg, remotePayment, { signatureVerified = false, req } = {}) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 60_000);
  let payment = await Payment.findOneAndUpdate(
    { _id: paymentArg._id, $or: [{ captureProcessingLeaseUntil: null }, { captureProcessingLeaseUntil: { $lte: now } }] },
    { $set: { captureProcessingLeaseUntil: leaseUntil } },
    { new: true }
  );
  ensure(payment, 409, "A capture for this booking is already being processed; retry shortly", "CAPTURE_IN_PROGRESS");

  try {
    const orderId = remotePayment.order_id;
    ensure(typeof remotePayment.id === "string" && (payment.razorpayOrderId === orderId || (payment.razorpayOrderIds || []).includes(orderId)), 400, "Captured payment is not linked to a Nearby checkout order", "ORDER_MISMATCH");
    ensure(Number(remotePayment.amount) === payment.amountPaise && remotePayment.currency === "INR", 400, "Captured payment amount does not match this booking", "PAYMENT_AMOUNT_MISMATCH");
    await recordAudit({
      actorId: null,
      action: "payment.captured",
      resourceType: "payment",
      resourceId: payment._id,
      idempotencyKey: `payment_capture_${String(payment._id)}_${remotePayment.id}`,
      metadata: { bookingId: String(payment.booking), paymentId: remotePayment.id, amountPaise: Number(remotePayment.amount), source: signatureVerified ? "checkout_verify" : "webhook" },
      req,
    });

    const alreadyCaptured = (payment.capturedPaymentIds || []).includes(remotePayment.id);
    if (payment.razorpayPaymentId && payment.razorpayPaymentId !== remotePayment.id) {
      const knownDuplicate = payment.duplicateCaptureRefunds.find((item) => item.paymentId === remotePayment.id);
      if (alreadyCaptured && !knownDuplicate) {
        return { payment, booking: await Booking.findById(payment.booking) };
      }
      await refundDuplicateCapture(payment, remotePayment);
      return { payment: await Payment.findById(payment._id), booking: await Booking.findById(payment.booking) };
    }
    if (alreadyCaptured && payment.razorpayPaymentId !== remotePayment.id) {
      return { payment, booking: await Booking.findById(payment.booking) };
    }
    if (alreadyCaptured && payment.razorpayPaymentId === remotePayment.id) {
      const booking = await Booking.findById(payment.booking);
      if (booking && ["paid", "partially_refunded"].includes(payment.status)
          && !payment.refundInProgress
          && !["pending", "failed", "reconciliation_required"].includes(payment.refundOperation?.status)
          && !payment.refundReconciliationRequired && !payment.transferReconciliationRequired) {
        try {
          if (["completed", "cancelled"].includes(booking.status)) await releaseHeldTransfer(payment, booking);
          else if (["confirmed", "completion_pending"].includes(booking.status)) await createHeldTransfer(payment);
        } catch (error) {
          console.error(`Could not retry transfer for captured payment ${payment._id}:`, error.message);
        }
      }
      return { payment: await Payment.findById(payment._id), booking };
    }

    const firstCapture = !alreadyCaptured;
    if (firstCapture) payment.capturedPaymentIds.push(remotePayment.id);
    payment.status = "paid";
    payment.razorpayPaymentId = remotePayment.id;
    if (signatureVerified) payment.checkoutSignatureVerifiedAt = new Date();
    payment.lastError = "";
    await payment.save();
    let booking = await Booking.findById(payment.booking);
    if (!booking) throw new LifecycleError(404, "Booking not found for payment", "BOOKING_NOT_FOUND");
    const holdIsValid = booking.status === "awaiting_payment" && booking.slotHoldExpiresAt && booking.slotHoldExpiresAt > new Date();
    if (holdIsValid) {
      const confirmed = await Booking.findOneAndUpdate(
        { _id: booking._id, status: "awaiting_payment", slotHoldExpiresAt: { $gt: new Date() } },
        { $set: { status: "confirmed", slotHoldExpiresAt: null } },
        { new: true }
      );
      if (confirmed) {
        booking = confirmed;
        await setReservationState(booking._id, "confirmed", null);
      } else booking = await Booking.findById(payment.booking);
    }

    if (!booking || !["confirmed", "completion_pending", "completed"].includes(booking.status)) {
      await refundPayment(payment._id, payment.amountPaise, "Late or cancelled booking payment", { system: true });
      if (booking?.status === "awaiting_payment") {
        await Booking.updateOne({ _id: booking._id, status: "awaiting_payment" }, { $set: { status: "accepted", slotHoldExpiresAt: null } });
        await setReservationState(booking._id, "expired");
      }
      payment = await Payment.findById(payment._id);
      return { payment, booking: booking ? await Booking.findById(booking._id) : null };
    }

    try {
      payment = await createHeldTransfer(payment);
    } catch (error) {
      payment.transferStatus = "failed";
      payment.lastError = error.message;
      await payment.save();
      console.error(`Razorpay transfer setup failed for booking ${booking._id}:`, error.message);
    }
    if (signatureVerified) {
      await recordAudit({ actorId: payment.customer, action: "payment.signature_verified", resourceType: "payment", resourceId: payment._id, metadata: { bookingId: String(booking._id) }, req });
    }
    await notifyPaymentCaptured(booking, payment);
    return { payment: await Payment.findById(payment._id), booking };
  } finally {
    await Payment.updateOne({ _id: paymentArg._id, captureProcessingLeaseUntil: leaseUntil }, { $set: { captureProcessingLeaseUntil: null } });
  }
}

async function refundDuplicateCapture(payment, remotePayment) {
  let entry = payment.duplicateCaptureRefunds.find((item) => item.paymentId === remotePayment.id);
  if (entry?.status === "refunded") return entry;
  ensure(entry?.status !== "reconciliation_required", 409, "Duplicate payment refund needs provider reconciliation", "REFUND_RECONCILIATION_REQUIRED");
  if (!entry) {
    entry = { paymentId: remotePayment.id, orderId: remotePayment.order_id, amountPaise: Number(remotePayment.amount), status: "pending", refundId: null, requestStarted: false };
    payment.duplicateCaptureRefunds.push(entry);
    if (!(payment.capturedPaymentIds || []).includes(remotePayment.id)) payment.capturedPaymentIds.push(remotePayment.id);
    await payment.save();
  }
  const idempotencyKey = `nearby_duplicate_${String(payment.booking)}_${remotePayment.id}`;
  const findExistingRefund = async () => {
    const result = await razorpayRequest("GET", `/payments/${encodeURIComponent(remotePayment.id)}/refunds?count=100`);
    return (result.items || []).find((refund) => refund.notes?.nearby_refund_key === idempotencyKey);
  };
  let refund;
  try {
    refund = await razorpayRequest(
      "POST",
      `/payments/${encodeURIComponent(remotePayment.id)}/refund`,
      {
        amount: Number(remotePayment.amount),
        notes: { booking_id: String(payment.booking), reason: "Duplicate captured checkout", nearby_refund_key: idempotencyKey },
      },
      { "X-Refund-Idempotency": idempotencyKey }
    );
  } catch (error) {
    if (error.ambiguous) refund = await findExistingRefund().catch(() => null);
    if (!refund) {
      entry.status = "pending";
      entry.requestStarted = true;
      await payment.save();
      if (error.ambiguous) return entry;
      throw error;
    }
  }
  if (refund.status === "processed") {
    entry.status = "refunded";
    entry.refundId = refund.id;
  } else if (refund.status === "pending") {
    entry.status = "pending";
    entry.refundId = refund.id;
    entry.requestStarted = true;
  } else {
    entry.status = "reconciliation_required";
    entry.refundId = refund.id || null;
    payment.lastError = refund.status === "failed"
      ? "Duplicate capture refund failed at Razorpay and requires reconciliation"
      : "Razorpay returned an unrecognized duplicate refund state";
  }
  await payment.save();
  if (entry.status === "refunded") {
    await recordAudit({ actorId: null, action: "payment.duplicate_capture_refunded", resourceType: "payment", resourceId: payment._id, metadata: { bookingId: String(payment.booking), paymentId: remotePayment.id, refundId: refund.id, amountPaise: Number(remotePayment.amount) } });
  }
  return entry;
}

async function createHeldTransfer(paymentArg) {
  let payment = await Payment.findById(paymentArg._id);
  ensure(["paid", "partially_refunded"].includes(payment?.status), 409, "Captured payment is required before a Route transfer", "PAYMENT_NOT_CAPTURED");
  if (payment.razorpayTransferId) return payment;
  ensure(!payment.refundInProgress && payment.refundOperation?.status !== "pending", 409, "A pending refund must settle before the provider transfer is created", "REFUND_IN_PROGRESS");
  const settings = await MarketplaceSettings.findOne({ key: "marketplace" }).lean();
  ensure(settings?.razorpayRouteEnabled === true, 503, "Razorpay Route is not enabled", "ROUTE_NOT_CONFIGURED");
  razorpayCredentials();
  const provider = await ProviderProfile.findById(payment.provider).select("+razorpayAccountId");
  const accountId = provider?.razorpayAccountId || payment.providerAccountId;
  ensure(accountId && accountId === payment.providerAccountId, 503, "Provider linked account is missing or changed", "ROUTE_ACCOUNT_NOT_CONFIGURED");
  ensure(payment.razorpayPaymentId, 409, "Captured Razorpay payment ID is missing", "PAYMENT_NOT_CAPTURED");
  const remainingProviderAmount = payment.providerAmountPaise - payment.providerRefundedAmountPaise;
  ensure(remainingProviderAmount > 0, 409, "No provider amount remains to transfer", "NO_PROVIDER_BALANCE");
  const transferKey = `nearby_transfer_${String(payment.booking)}_${payment.razorpayPaymentId}`;

  if (payment.transferCreateStartedAt) {
    let priorTransfer;
    try {
      const existing = await razorpayRequest("GET", `/payments/${encodeURIComponent(payment.razorpayPaymentId)}/transfers?count=100`);
      priorTransfer = (existing.items || []).find((item) => item.notes?.nearby_transfer_key === transferKey);
    } catch (_error) {
      payment.transferReconciliationRequired = true;
      payment.transferStatus = "failed";
      payment.transferCreationLeaseUntil = null;
      payment.lastError = "Route transfer outcome is unknown; automatic creation was stopped for reconciliation";
      await payment.save();
      throw new LifecycleError(409, payment.lastError, "TRANSFER_RECONCILIATION_REQUIRED");
    }
    if (priorTransfer?.id) {
      payment.razorpayTransferId = priorTransfer.id;
      payment.transferStatus = priorTransfer.on_hold === false ? "released" : "held";
      payment.transferCreateStartedAt = null;
      payment.transferCreationLeaseUntil = null;
      payment.transferReconciliationRequired = false;
      payment.lastError = "";
      await payment.save();
      return payment;
    }
    payment.transferReconciliationRequired = true;
    payment.transferStatus = "failed";
    payment.transferCreationLeaseUntil = null;
    payment.lastError = "Route transfer outcome is unknown; automatic creation was stopped for reconciliation";
    await payment.save();
    throw new LifecycleError(409, payment.lastError, "TRANSFER_RECONCILIATION_REQUIRED");
  }

  ensure(!payment.transferReconciliationRequired, 409, "This payment needs payout reconciliation before transfer", "TRANSFER_RECONCILIATION_REQUIRED");

  const now = new Date();
  const lock = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      razorpayTransferId: null,
      transferCreateStartedAt: null,
      transferCreationLeaseUntil: { $not: { $gt: now } },
      transferReconciliationRequired: false,
    },
    { $set: { transferCreationLeaseUntil: new Date(now.getTime() + 60_000), transferCreateStartedAt: now, transferStatus: "held" } },
    { new: true }
  );
  if (!lock) return Payment.findById(payment._id);
  let result;
  try {
    result = await razorpayRequest("POST", `/payments/${encodeURIComponent(payment.razorpayPaymentId)}/transfers`, {
      transfers: [{
        account: accountId,
        amount: remainingProviderAmount,
        currency: "INR",
        on_hold: true,
        notes: { booking_id: String(payment.booking), nearby_transfer_key: transferKey },
      }],
    });
  } catch (error) {
    if (error.ambiguous) {
      await Payment.updateOne(
        { _id: payment._id },
        { $set: { transferStatus: "failed", transferReconciliationRequired: true, transferCreationLeaseUntil: null, lastError: "Route transfer outcome is unknown; automatic creation was stopped for reconciliation" } }
      );
      throw new LifecycleError(409, "Route transfer outcome is unknown; automatic creation was stopped for reconciliation", "TRANSFER_RECONCILIATION_REQUIRED");
    }
    await Payment.updateOne({ _id: payment._id }, { $set: { transferStatus: "failed", transferCreateStartedAt: null, transferCreationLeaseUntil: null, lastError: error.message } });
    throw error;
  }
  const transfer = result.items?.[0] || result.transfer || (Array.isArray(result) ? result[0] : null);
  if (!transfer?.id) {
    await Payment.updateOne(
      { _id: payment._id },
      { $set: { transferStatus: "failed", transferReconciliationRequired: true, transferCreationLeaseUntil: null, lastError: "Route returned no transfer ID; outcome must be reconciled" } }
    );
    throw new LifecycleError(409, "Route returned no transfer ID; outcome must be reconciled", "TRANSFER_RECONCILIATION_REQUIRED");
  }
  payment = await Payment.findByIdAndUpdate(
    payment._id,
    { $set: { razorpayTransferId: transfer.id, transferStatus: transfer.on_hold === false ? "released" : "held", transferCreateStartedAt: null, transferCreationLeaseUntil: null, lastError: "" } },
    { new: true }
  );
  await recordAudit({ actorId: null, action: "payment.route_transfer_held", resourceType: "payment", resourceId: payment._id, metadata: { transferId: transfer.id, amountPaise: remainingProviderAmount } });
  return payment;
}

async function releaseHeldTransfer(paymentArg, bookingArg) {
  const payment = await Payment.findById(paymentArg._id || paymentArg);
  const booking = bookingArg ? await Booking.findById(bookingArg._id || bookingArg) : await Booking.findById(payment?.booking);
  ensure(payment && booking, 404, "Payment or booking not found", "PAYMENT_NOT_FOUND");
  ensure(["completed", "cancelled"].includes(booking.status), 409, "Provider transfer remains held until completion or final cancellation", "BOOKING_NOT_COMPLETED");
  ensure(!await Dispute.exists({ booking: booking._id, status: "open" }), 409, "Provider transfer remains held while a dispute is open", "DISPUTE_OPEN");
  ensure(!payment.transferReconciliationRequired, 409, "Transfer reversal must be reconciled before payout", "TRANSFER_RECONCILIATION_REQUIRED");
  ensure(!payment.refundReconciliationRequired, 409, "Refund state must be reconciled before payout", "REFUND_RECONCILIATION_REQUIRED");
  ensure(!payment.refundInProgress && !["pending", "failed", "reconciliation_required"].includes(payment.refundOperation?.status), 409, "Provider transfer remains held while a refund is pending or unresolved", "REFUND_IN_PROGRESS");
  ensure(["paid", "partially_refunded"].includes(payment.status), 409, "Captured payment is required before payout", "PAYMENT_NOT_CAPTURED");
  ensure(payment.providerAmountPaise - payment.providerRefundedAmountPaise > 0, 409, "No provider amount remains to transfer", "NO_PROVIDER_BALANCE");
  if (payment.transferStatus === "released") return payment;
  let current = payment;
  if (!current.razorpayTransferId) current = await createHeldTransfer(current);
  ensure(current.razorpayTransferId, 502, "Held provider transfer is not available yet", "ROUTE_TRANSFER_PENDING");
  let released;
  try {
    released = await razorpayRequest("PATCH", `/transfers/${encodeURIComponent(current.razorpayTransferId)}`, { on_hold: false });
  } catch (error) {
    current.transferStatus = "failed";
    current.transferReconciliationRequired = true;
    current.lastError = "Route release outcome needs reconciliation; automatic retries were stopped";
    await current.save();
    throw new LifecycleError(409, current.lastError, "TRANSFER_RECONCILIATION_REQUIRED");
  }
  current.transferStatus = released.on_hold === false ? "released" : "held";
  await current.save();
  if (current.transferStatus !== "released") throw new LifecycleError(502, "Razorpay did not release the held provider transfer", "ROUTE_RELEASE_FAILED");
  await recordAudit({ actorId: null, action: "payment.route_transfer_released", resourceType: "payment", resourceId: current._id, metadata: { transferId: current.razorpayTransferId, bookingId: String(booking._id) } });
  return current;
}

async function applyProcessedRefund(paymentArg, refund, { system = false, actorId, req, reason = "Marketplace refund" } = {}) {
  let payment = await Payment.findById(paymentArg._id || paymentArg);
  ensure(payment, 404, "Payment not found for refund", "PAYMENT_NOT_FOUND");
  if (payment.refundIds.includes(refund.id)) return payment;
  ensure(refund.status === "processed", 409, "Only a processed Razorpay refund can update refund totals", "REFUND_NOT_PROCESSED");
  const operation = payment.refundOperation || {};
  const refundKey = refund.notes?.nearby_refund_key;
  const amountPaise = Number(refund.amount);
  const operationCanComplete = operation.status === "pending"
    || (operation.status === "failed" && operation.refundId === refund.id);
  if (refund.payment_id !== payment.razorpayPaymentId || !refundKey || refundKey !== operation.key
      || !operationCanComplete || operation.amountPaise !== amountPaise
      || operation.previousRefundedPaise !== payment.refundedAmountPaise) {
    payment.refundReconciliationRequired = true;
    payment.lastError = "Processed Razorpay refund does not match the pending Nearby refund operation";
    payment.refundOperation.status = "reconciliation_required";
    payment.refundInProgress = false;
    payment.refundProcessingLeaseUntil = null;
    await payment.save();
    throw new LifecycleError(409, payment.lastError, "REFUND_RECONCILIATION_REQUIRED");
  }

  const oldProviderRefunded = payment.providerRefundedAmountPaise || 0;
  const nextRefundTotal = payment.refundedAmountPaise + amountPaise;
  const commissionBps = Number.isInteger(payment.commissionBps)
    ? payment.commissionBps
    : Math.round((payment.commissionPaise * 10_000) / payment.amountPaise);
  ensure(Number.isInteger(commissionBps) && commissionBps >= 0 && commissionBps <= 10_000, 409, "Payment commission basis points need reconciliation", "PAYMENT_RECONCILIATION_REQUIRED");
  const retainedAllocation = calculateRetainedAllocation(payment.amountPaise, nextRefundTotal, commissionBps);
  const providerRefundTarget = Math.max(oldProviderRefunded, Math.min(payment.providerAmountPaise, payment.providerAmountPaise - retainedAllocation.providerAmountPaise));
  const providerRefundAmount = Math.max(0, providerRefundTarget - oldProviderRefunded);
  let reversalSucceeded = true;
  if (providerRefundAmount > 0 && (payment.razorpayTransferId || payment.transferCreateStartedAt || payment.transferStatus === "held")) {
    const reversalOperation = payment.routeReversalOperation || {};
    const reversalKey = `nearby_reversal_${refund.id}`;
    const sameCompletedReversal = reversalOperation.status === "completed" && reversalOperation.refundId === refund.id;
    if (sameCompletedReversal) {
      if (reversalOperation.amountPaise !== providerRefundAmount || reversalOperation.transferId !== payment.razorpayTransferId) {
        reversalSucceeded = false;
        payment.transferReconciliationRequired = true;
        payment.routeReversalOperation.status = "reconciliation_required";
        payment.lastError = "Recorded Route reversal does not match the processed refund allocation";
      }
    } else if (reversalOperation.status === "pending" || reversalOperation.status === "reconciliation_required") {
      reversalSucceeded = false;
      payment.transferReconciliationRequired = true;
      payment.routeReversalOperation.status = "reconciliation_required";
      payment.lastError = "Route reversal outcome needs reconciliation; automatic retries were stopped";
    } else {
      payment.routeReversalOperation = {
        key: reversalKey,
        amountPaise: providerRefundAmount,
        status: "pending",
        refundId: refund.id,
        transferId: payment.razorpayTransferId || null,
        reversalId: null,
      };
      await payment.save();
      if (!payment.razorpayTransferId) {
        reversalSucceeded = false;
        payment.routeReversalOperation.status = "reconciliation_required";
        payment.transferReconciliationRequired = true;
        payment.lastError = "Refund processed while a Route transfer was being created; payout needs reconciliation";
      } else {
        try {
          const reversal = await razorpayRequest("POST", `/transfers/${encodeURIComponent(payment.razorpayTransferId)}/reversals`, {
            amount: providerRefundAmount,
            notes: { nearby_refund_key: refundKey, nearby_refund_id: refund.id, nearby_reversal_key: reversalKey },
          });
          ensure(typeof reversal.id === "string" && Number(reversal.amount) === providerRefundAmount, 502, "Razorpay did not confirm the requested Route reversal", "ROUTE_REVERSAL_UNCONFIRMED");
          payment.routeReversalOperation.status = "completed";
          payment.routeReversalOperation.reversalId = reversal.id;
          await payment.save();
        } catch (error) {
          reversalSucceeded = false;
          payment.routeReversalOperation.status = "reconciliation_required";
          payment.transferReconciliationRequired = true;
          payment.lastError = `Refund processed but Route reversal needs reconciliation: ${error.message}`;
          console.error(payment.lastError);
        }
      }
    }
  }

  payment.refundedAmountPaise = nextRefundTotal;
  payment.commissionBps = commissionBps;
  payment.providerRefundedAmountPaise = reversalSucceeded ? providerRefundTarget : oldProviderRefunded;
  payment.commissionPaise = retainedAllocation.commissionPaise;
  payment.refundIds.push(refund.id);
  payment.status = nextRefundTotal >= payment.amountPaise ? "refunded" : "partially_refunded";
  payment.refundOperation.status = "completed";
  payment.refundOperation.refundId = refund.id;
  payment.refundInProgress = false;
  payment.refundProcessingLeaseUntil = null;
  await payment.save();
  await recordAudit({ actorId: actorId || null, action: "payment.refunded", resourceType: "payment", resourceId: payment._id, metadata: { amountPaise, refundId: refund.id, system, reversalSucceeded, reason: String(reason || "").slice(0, 200) }, req });

  if (payment.status === "partially_refunded" && !payment.transferReconciliationRequired
      && !payment.refundInProgress && payment.refundOperation?.status === "completed") {
    const booking = await Booking.findById(payment.booking);
    const openDispute = booking ? await Dispute.exists({ booking: booking._id, status: "open" }) : true;
    const remainingProviderBalance = payment.providerAmountPaise - payment.providerRefundedAmountPaise;
    if (["completed", "cancelled"].includes(booking?.status) && !openDispute && remainingProviderBalance > 0) {
      try {
        payment = await releaseHeldTransfer(payment, booking);
      } catch (error) {
        console.error(`Could not release remaining provider balance after processed refund ${refund.id}:`, error.message);
      }
    }
  }
  return payment;
}

async function refundPayment(paymentId, amountPaise, reason, { system = false, actorId, req } = {}) {
  let payment = await Payment.findById(paymentId);
  ensure(payment, 404, "Payment not found", "PAYMENT_NOT_FOUND");
  ensure(["paid", "partially_refunded"].includes(payment.status), 409, "Only a captured payment can be refunded", "PAYMENT_NOT_REFUNDABLE");
  ensure(!payment.refundReconciliationRequired, 409, "A previous refund needs provider reconciliation", "REFUND_RECONCILIATION_REQUIRED");
  ensure(Number.isInteger(amountPaise) && amountPaise > 0 && amountPaise <= payment.amountPaise - payment.refundedAmountPaise, 400, "Refund amount is outside the refundable balance", "INVALID_REFUND_AMOUNT");
  ensure(payment.razorpayPaymentId, 409, "Captured Razorpay payment ID is missing", "PAYMENT_NOT_CAPTURED");
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 60_000);
  const lock = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      refundReconciliationRequired: { $ne: true },
      status: { $in: ["paid", "partially_refunded"] },
      $or: [{ refundProcessingLeaseUntil: null }, { refundProcessingLeaseUntil: { $lte: now } }],
    },
    { $set: { refundInProgress: true, refundProcessingLeaseUntil: leaseUntil } },
    { new: true }
  );
  ensure(lock, 409, "A refund is already being processed for this payment", "REFUND_IN_PROGRESS");
  payment = lock;

  try {
    ensure(amountPaise <= payment.amountPaise - payment.refundedAmountPaise, 400, "Refund amount is outside the refundable balance", "INVALID_REFUND_AMOUNT");
    const previousRefunded = payment.refundedAmountPaise;
    const currentOperation = payment.refundOperation || {};
    const recovering = currentOperation.status === "pending"
      && currentOperation.amountPaise === amountPaise
      && currentOperation.previousRefundedPaise === previousRefunded;
    if (currentOperation.status === "pending" && !recovering) {
      throw new LifecycleError(409, "A different refund is still pending with Razorpay", "REFUND_IN_PROGRESS");
    }
    const operationKey = recovering ? currentOperation.key : `nearby_refund_${payment._id}_${crypto.randomUUID()}`;
    const operationReason = recovering ? currentOperation.reason : String(reason || "Marketplace refund").slice(0, 200);
    if (!recovering) {
      payment.refundOperation = {
        key: operationKey,
        amountPaise,
        previousRefundedPaise: previousRefunded,
        status: "pending",
        requestStarted: false,
        reason: operationReason,
        refundId: null,
      };
      await payment.save();
    }
    const lookupExisting = async () => {
      const result = await razorpayRequest("GET", `/payments/${encodeURIComponent(payment.razorpayPaymentId)}/refunds?count=100`);
      return (result.items || []).find((item) => item.notes?.nearby_refund_key === operationKey);
    };
    payment.refundOperation.requestStarted = true;
    await payment.save();
    let refund;
    try {
      refund = await razorpayRequest(
        "POST",
        `/payments/${encodeURIComponent(payment.razorpayPaymentId)}/refund`,
        { amount: amountPaise, notes: { booking_id: String(payment.booking), reason: operationReason, nearby_refund_key: operationKey } },
        { "X-Refund-Idempotency": operationKey }
      );
    } catch (error) {
      if (!error.ambiguous) {
        payment.refundOperation.status = "failed";
        payment.refundOperation.requestStarted = false;
        await payment.save();
        throw error;
      }
      refund = await lookupExisting().catch(() => null);
      if (!refund) {
        payment.refundOperation.status = "pending";
        payment.refundInProgress = false;
        payment.refundProcessingLeaseUntil = null;
        payment.lastError = "Refund request outcome is pending provider confirmation";
        await payment.save();
        await recordAudit({ actorId: actorId || null, action: "payment.refund_pending", resourceType: "payment", resourceId: payment._id, metadata: { amountPaise, system, reason: operationReason }, req });
        return payment;
      }
    }
    ensure(refund?.id, 502, "Razorpay did not return a refund ID", "REFUND_REQUEST_FAILED");
    if (refund.status === "processed") {
      return applyProcessedRefund(payment, refund, { system, actorId, req, reason: operationReason });
    }
    if (refund.status === "pending") {
      payment.refundOperation.status = "pending";
      payment.refundOperation.refundId = refund.id;
      payment.refundInProgress = false;
      payment.refundProcessingLeaseUntil = null;
      payment.lastError = "Refund is pending confirmation from Razorpay";
      await payment.save();
      await recordAudit({ actorId: actorId || null, action: "payment.refund_pending", resourceType: "payment", resourceId: payment._id, metadata: { amountPaise, refundId: refund.id, system, reason: operationReason }, req });
      return payment;
    }
    if (refund.status === "failed") {
      payment.refundOperation.status = "failed";
      payment.refundOperation.refundId = refund.id;
      payment.refundOperation.requestStarted = false;
      payment.refundInProgress = false;
      payment.refundProcessingLeaseUntil = null;
      payment.lastError = "Razorpay reports that the refund failed";
      await payment.save();
      await recordAudit({ actorId: actorId || null, action: "payment.refund_failed", resourceType: "payment", resourceId: payment._id, metadata: { amountPaise, refundId: refund.id, system }, req });
      throw new LifecycleError(502, "Razorpay reports that the refund failed", "REFUND_FAILED");
    }
    payment.refundReconciliationRequired = true;
    payment.refundOperation.status = "reconciliation_required";
    payment.refundOperation.refundId = refund.id || null;
    payment.refundInProgress = false;
    payment.refundProcessingLeaseUntil = null;
    payment.lastError = "Razorpay returned an unrecognized refund state";
    await payment.save();
    throw new LifecycleError(409, payment.lastError, "REFUND_RECONCILIATION_REQUIRED");
  } catch (error) {
    await Payment.updateOne(
      { _id: payment._id, refundProcessingLeaseUntil: leaseUntil },
      { $set: { refundInProgress: false, refundProcessingLeaseUntil: null, lastError: error.message } }
    );
    throw error;
  }
}

async function cancelBooking({ bookingId, user, reason = "", req }) {
  let booking = await Booking.findById(bookingId);
  ensure(booking, 404, "Booking not found", "BOOKING_NOT_FOUND");
  let isCustomer = String(booking.customer) === String(user.id) && user.role === "customer";
  let isProvider = false;
  if (user.role === "provider") {
    const profile = await ProviderProfile.findOne({ user: user.id }).select("_id");
    isProvider = Boolean(profile && String(profile._id) === String(booking.provider));
  }
  ensure(isCustomer || isProvider, 403, "Only a booking customer or provider can cancel", "FORBIDDEN");
  ensure(["requested", "accepted", "awaiting_payment", "confirmed"].includes(booking.status), 409, "Booking cannot be cancelled in its current state", "BOOKING_STATE_CONFLICT");

  const payment = await Payment.findOne({ booking: booking._id });
  let refundBps = 0;
  const settings = await MarketplaceSettings.findOne({ key: "marketplace" }).lean();
  if (payment && ["paid", "partially_refunded"].includes(payment.status)) {
    ensure(settings, 503, "Cancellation policy is not configured", "MARKETPLACE_NOT_CONFIGURED");
    if (isProvider) {
      ensure(Number.isInteger(settings.cancellationPolicy?.providerCancelRefundBps), 503, "Provider cancellation refund rule is not configured", "MARKETPLACE_NOT_CONFIGURED");
      refundBps = settings.cancellationPolicy.providerCancelRefundBps;
    } else {
      ensure(Number.isInteger(settings.cancellationPolicy?.customerEarlyWindowHours)
        && Number.isInteger(settings.cancellationPolicy?.customerEarlyRefundBps)
        && Number.isInteger(settings.cancellationPolicy?.customerLateRefundBps), 503, "Customer cancellation refund rules are not configured", "MARKETPLACE_NOT_CONFIGURED");
      const hoursUntilJob = (new Date(booking.scheduledAt).getTime() - Date.now()) / 3_600_000;
      refundBps = hoursUntilJob >= settings.cancellationPolicy.customerEarlyWindowHours
        ? settings.cancellationPolicy.customerEarlyRefundBps
        : settings.cancellationPolicy.customerLateRefundBps;
    }
    const targetRefundAmount = Math.floor((payment.amountPaise * refundBps) / 10_000);
    const refundAmount = Math.max(0, Math.min(payment.amountPaise - payment.refundedAmountPaise, targetRefundAmount - payment.refundedAmountPaise));
    if (refundAmount > 0) await refundPayment(payment._id, refundAmount, reason || "Booking cancelled", { actorId: user.id, req });
  }

  booking = await Booking.findOneAndUpdate(
    { _id: booking._id, status: { $in: ["requested", "accepted", "awaiting_payment", "confirmed"] } },
    { $set: { status: "cancelled", cancelledAt: new Date(), cancellationReason: String(reason || "").trim().slice(0, 1000), slotHoldExpiresAt: null } },
    { new: true }
  );
  ensure(booking, 409, "Booking changed while cancellation was being processed", "BOOKING_STATE_CONFLICT");
  await setReservationState(booking._id, "cancelled");
  if (payment && ["paid", "partially_refunded"].includes(payment.status)) {
    const refreshedPayment = await Payment.findById(payment._id);
    if (refreshedPayment && !refreshedPayment.refundInProgress
        && !["pending", "failed", "reconciliation_required"].includes(refreshedPayment.refundOperation?.status)
        && !refreshedPayment.refundReconciliationRequired
        && !refreshedPayment.transferReconciliationRequired
        && refreshedPayment.providerAmountPaise - refreshedPayment.providerRefundedAmountPaise > 0) {
      try {
        await releaseHeldTransfer(refreshedPayment, booking);
      } catch (error) {
        console.error(`Could not release remaining provider share after cancellation ${booking._id}:`, error.message);
      }
    }
  }
  await recordAudit({ actorId: user.id, action: "booking.cancelled", resourceType: "booking", resourceId: booking._id, metadata: { refundBps }, req });
  await notifyOtherParticipant(booking, user.id, "Booking cancelled", `The booking has been cancelled${refundBps ? `; the refund policy is ${refundBps / 100}%` : ""}.`);
  return booking;
}

async function processWebhookEvent(eventId, eventName, payload) {
  const now = new Date();
  let event;
  try {
    event = await WebhookEvent.create({ eventId, event: eventName, status: "processing", leaseUntil: new Date(now.getTime() + 60_000), attempts: 1 });
  } catch (error) {
    if (error.code !== 11000) throw error;
    event = await WebhookEvent.findOne({ eventId });
    if (event?.status === "processed") return { duplicate: true };
    const claimed = await WebhookEvent.findOneAndUpdate(
      { eventId, $or: [{ status: "failed" }, { status: "processing", leaseUntil: { $lte: now } }] },
      { $set: { status: "processing", leaseUntil: new Date(now.getTime() + 60_000), error: "" }, $inc: { attempts: 1 } },
      { new: true }
    );
    if (!claimed) throw new LifecycleError(409, "Webhook event is already being processed", "WEBHOOK_IN_PROGRESS");
    event = claimed;
  }

  try {
    const refundEntity = payload?.payload?.refund?.entity;
    if (["refund.processed", "refund.failed"].includes(eventName) && refundEntity?.id) {
      await processRefundWebhook(eventName, refundEntity);
    }
    const paymentEntity = payload?.payload?.payment?.entity;
    const orderEntity = payload?.payload?.order?.entity;
    let remotePayment = paymentEntity || null;
    const orderId = remotePayment?.order_id || orderEntity?.id;
    const payment = orderId ? await Payment.findOne({ $or: [{ razorpayOrderId: orderId }, { razorpayOrderIds: orderId }] }) : null;

    if (eventName === "order.paid" && orderId && !remotePayment) {
      const orderPayments = await razorpayRequest("GET", `/orders/${encodeURIComponent(orderId)}/payments?count=100`);
      remotePayment = (orderPayments.items || []).find((item) => item.status === "captured") || null;
      ensure(remotePayment, 409, "Razorpay has not exposed the captured payment for this paid order yet", "PAYMENT_NOT_READY");
    }

    if (["payment.captured", "order.paid"].includes(eventName) && payment && remotePayment) {
      ensure(remotePayment.order_id === orderId, 400, "Webhook payment does not belong to its order", "ORDER_MISMATCH");
      if (Number(remotePayment.amount) === payment.amountPaise && remotePayment.currency === "INR") {
        await markPaymentCaptured(payment, remotePayment, { signatureVerified: false });
      } else {
        throw new LifecycleError(400, "Webhook payment details do not match the order", "PAYMENT_AMOUNT_MISMATCH");
      }
    } else if (eventName === "payment.failed" && payment && payment.razorpayOrderId === orderId && ["creating", "created"].includes(payment.status) && !payment.razorpayPaymentId) {
      payment.status = "failed";
      payment.lastError = String(remotePayment?.error_description || "Payment failed").slice(0, 1000);
      await payment.save();
      await Booking.updateOne({ _id: payment.booking, status: "awaiting_payment" }, { $set: { status: "accepted", slotHoldExpiresAt: null } });
      await setReservationState(payment.booking, "expired");
    }

    event.status = "processed";
    event.processedAt = new Date();
    event.leaseUntil = null;
    await event.save();
    return { duplicate: false };
  } catch (error) {
    event.status = "failed";
    event.leaseUntil = null;
    event.error = String(error.message || "Webhook processing failed").slice(0, 1000);
    await event.save();
    throw error;
  }
}

async function processRefundWebhook(eventName, refund) {
  if (!refund?.payment_id) return;
  const payment = await Payment.findOne({ razorpayPaymentId: refund.payment_id });
  if (payment) {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + 60_000);
    const locked = await Payment.findOneAndUpdate(
      { _id: payment._id, $or: [{ refundProcessingLeaseUntil: null }, { refundProcessingLeaseUntil: { $lte: now } }] },
      { $set: { refundInProgress: true, refundProcessingLeaseUntil: leaseUntil } },
      { new: true }
    );
    ensure(locked, 409, "Refund state is being updated; provider webhook should retry", "REFUND_IN_PROGRESS");
    try {
      if (eventName === "refund.processed") {
        await applyProcessedRefund(locked, refund, { system: true, reason: locked.refundOperation?.reason || "Marketplace refund" });
      } else {
        const operation = locked.refundOperation || {};
        if (locked.refundIds.includes(refund.id) || (operation.status === "completed" && operation.refundId === refund.id)
            || (operation.status === "failed" && operation.refundId === refund.id)) {
          return;
        }
        if (operation.key !== refund.notes?.nearby_refund_key || operation.status !== "pending") {
          locked.refundReconciliationRequired = true;
          locked.lastError = "Failed refund webhook did not match the pending Nearby operation";
          locked.refundOperation.status = "reconciliation_required";
        } else {
          locked.refundOperation.status = "failed";
          locked.refundOperation.requestStarted = false;
          locked.refundOperation.refundId = refund.id;
          locked.lastError = "Razorpay reports that the refund failed";
        }
        locked.refundInProgress = false;
        locked.refundProcessingLeaseUntil = null;
        await locked.save();
        await recordAudit({ actorId: null, action: "payment.refund_failed", resourceType: "payment", resourceId: locked._id, metadata: { refundId: refund.id, amountPaise: refund.amount } });
      }
    } finally {
      await Payment.updateOne({ _id: payment._id, refundProcessingLeaseUntil: leaseUntil }, { $set: { refundInProgress: false, refundProcessingLeaseUntil: null } });
    }
    return;
  }

  const duplicateOwner = await Payment.findOne({ "duplicateCaptureRefunds.paymentId": refund.payment_id });
  const duplicateEntry = duplicateOwner?.duplicateCaptureRefunds.find((entry) => entry.paymentId === refund.payment_id);
  if (!duplicateOwner || !duplicateEntry) return;
  if (duplicateEntry.refundId === refund.id && duplicateEntry.status === "refunded") return;
  if (duplicateEntry.refundId === refund.id && duplicateEntry.status === "reconciliation_required" && eventName === "refund.failed") return;
  const expectedKey = `nearby_duplicate_${String(duplicateOwner.booking)}_${refund.payment_id}`;
  if (refund.notes?.nearby_refund_key !== expectedKey) {
    duplicateEntry.status = "reconciliation_required";
    duplicateOwner.lastError = "Duplicate capture refund webhook had an unexpected idempotency key";
  } else if (eventName === "refund.processed") {
    duplicateEntry.status = "refunded";
    duplicateEntry.refundId = refund.id;
  } else {
    duplicateEntry.status = "reconciliation_required";
    duplicateEntry.refundId = refund.id;
    duplicateOwner.lastError = "Duplicate capture refund failed at Razorpay and requires reconciliation";
  }
  await duplicateOwner.save();
  if (eventName === "refund.processed" && duplicateEntry.status === "refunded") {
    await recordAudit({ actorId: null, action: "payment.duplicate_capture_refunded", resourceType: "payment", resourceId: duplicateOwner._id, metadata: { bookingId: String(duplicateOwner.booking), paymentId: refund.payment_id, refundId: refund.id, amountPaise: refund.amount } });
  }
}

async function reconcilePendingRefunds() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_WEBHOOK_SECRET) return;
  const candidates = await Payment.find({
    $or: [
      { "refundOperation.status": "pending" },
      { "duplicateCaptureRefunds.status": "pending" },
    ],
    refundReconciliationRequired: { $ne: true },
  }).limit(50);
  for (const payment of candidates) {
    const mainOperation = payment.refundOperation;
    if (mainOperation?.status === "pending" && payment.razorpayPaymentId && mainOperation.key) {
      try {
        const results = await razorpayRequest("GET", `/payments/${encodeURIComponent(payment.razorpayPaymentId)}/refunds?count=100`);
        const refund = (results.items || []).find((item) => item.notes?.nearby_refund_key === mainOperation.key);
        if (refund?.status === "processed") {
          const now = new Date();
          const leaseUntil = new Date(now.getTime() + 60_000);
          const locked = await Payment.findOneAndUpdate(
            { _id: payment._id, "refundOperation.status": "pending", $or: [{ refundProcessingLeaseUntil: null }, { refundProcessingLeaseUntil: { $lte: now } }] },
            { $set: { refundInProgress: true, refundProcessingLeaseUntil: leaseUntil } },
            { new: true }
          );
          if (locked) {
            try {
              await applyProcessedRefund(locked, refund, { system: true, reason: locked.refundOperation.reason || "Marketplace refund" });
            } finally {
              await Payment.updateOne({ _id: payment._id, refundProcessingLeaseUntil: leaseUntil }, { $set: { refundInProgress: false, refundProcessingLeaseUntil: null } });
            }
          }
        } else if (refund?.status === "failed") {
          payment.refundOperation.status = "failed";
          payment.refundOperation.refundId = refund.id;
          payment.refundOperation.requestStarted = false;
          payment.lastError = "Razorpay reports that the refund failed";
          await payment.save();
        } else if (refund?.status === "pending" && payment.refundOperation.refundId !== refund.id) {
          payment.refundOperation.refundId = refund.id;
          await payment.save();
        }
      } catch (error) {
        console.error(`Pending refund reconciliation failed for payment ${payment._id}:`, error.message);
      }
    }

    for (const duplicate of payment.duplicateCaptureRefunds.filter((item) => item.status === "pending")) {
      const idempotencyKey = `nearby_duplicate_${String(payment.booking)}_${duplicate.paymentId}`;
      try {
        const results = await razorpayRequest("GET", `/payments/${encodeURIComponent(duplicate.paymentId)}/refunds?count=100`);
        const refund = (results.items || []).find((item) => item.notes?.nearby_refund_key === idempotencyKey);
        if (refund?.status === "processed") {
          duplicate.status = "refunded";
          duplicate.refundId = refund.id;
          await payment.save();
          await recordAudit({ actorId: null, action: "payment.duplicate_capture_refunded", resourceType: "payment", resourceId: payment._id, metadata: { bookingId: String(payment.booking), paymentId: duplicate.paymentId, refundId: refund.id, amountPaise: duplicate.amountPaise } });
        } else if (refund?.status === "failed") {
          duplicate.status = "reconciliation_required";
          duplicate.refundId = refund.id;
          payment.lastError = "Duplicate capture refund failed at Razorpay and requires reconciliation";
          await payment.save();
        } else if (refund?.status === "pending" && duplicate.refundId !== refund.id) {
          duplicate.refundId = refund.id;
          await payment.save();
        }
      } catch (error) {
        console.error(`Duplicate refund reconciliation failed for payment ${payment._id}:`, error.message);
      }
    }
  }
}

async function createAdminRefund({ bookingId, amountPaise, reason, actorId, req }) {
  const booking = await Booking.findById(bookingId);
  ensure(booking, 404, "Booking not found", "BOOKING_NOT_FOUND");
  const payment = await Payment.findOne({ booking: booking._id });
  ensure(payment, 404, "Payment not found for booking", "PAYMENT_NOT_FOUND");
  return refundPayment(payment._id, amountPaise, reason || "Admin refund", { actorId, req });
}

async function notifyPaymentCaptured(booking, payment) {
  const customer = await User.findById(booking.customer).select("name email");
  if (customer?.email) {
    await sendEmail({ to: customer.email, subject: "Nearby payment confirmed", text: `Hello ${customer.name || ""}, your booking payment of INR ${(payment.amountPaise / 100).toFixed(2)} was confirmed.` })
      .catch((error) => console.error("Payment notification email failed:", error.message));
  }
}

async function notifyOtherParticipant(booking, actorId, subject, message) {
  let otherUserId = booking.customer;
  if (String(booking.customer) === String(actorId)) {
    const provider = await ProviderProfile.findById(booking.provider).select("user");
    otherUserId = provider?.user;
  }
  const other = otherUserId ? await User.findById(otherUserId).select("name email") : null;
  if (other?.email) {
    await sendEmail({ to: other.email, subject, text: `Hello ${other.name || ""}, ${message}` })
      .catch((error) => console.error("Booking email notification failed:", error.message));
  }
}

function publicPayment(payment) {
  return {
    bookingId: String(payment.booking),
    amountPaise: payment.amountPaise,
    commissionPaise: payment.commissionPaise,
    providerAmountPaise: payment.providerAmountPaise,
    currency: payment.currency,
    status: payment.status,
    transferStatus: payment.transferStatus,
    refundedAmountPaise: payment.refundedAmountPaise,
    refundStatus: payment.refundOperation?.status || null,
    pendingRefundAmountPaise: payment.refundOperation?.status === "pending" ? payment.refundOperation.amountPaise : 0,
    remainingProviderAmountPaise: Math.max(0, payment.providerAmountPaise - payment.providerRefundedAmountPaise),
    checkoutExpiresAt: payment.checkoutExpiresAt,
  };
}

module.exports = {
  requireLaunchSettings,
  razorpayRequest,
  createCheckout,
  verifyCheckout,
  markPaymentCaptured,
  createHeldTransfer,
  releaseHeldTransfer,
  refundPayment,
  cancelBooking,
  processWebhookEvent,
  createAdminRefund,
  reconcilePendingRefunds,
  publicPayment,
  calculateRetainedAllocation,
};
