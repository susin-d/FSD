const crypto = require("node:crypto");
const express = require("express");
const { requireAuth, requireRole } = require("../../middleware/auth");
const ProviderProfile = require("../providers/provider.model");
const Booking = require("../bookings/booking.model");
const Payment = require("./payment.model");
const { asyncHandler, ensure, isObjectId, LifecycleError } = require("../../utils/lifecycle");
const {
  verifyCheckout,
  processWebhookEvent,
  createAdminRefund,
  publicPayment,
} = require("./service");

const router = express.Router();

async function canViewPayment(payment, user) {
  if (user.role === "admin") return true;
  if (String(payment.customer) === String(user.id)) return true;
  const profile = await ProviderProfile.findOne({ user: user.id }).select("_id");
  return Boolean(profile && String(profile._id) === String(payment.provider));
}

router.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
    ensure(Buffer.isBuffer(rawBody), 400, "Webhook requires the raw request body", "RAW_WEBHOOK_BODY_REQUIRED");
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    ensure(secret, 503, "Razorpay webhook secret is not configured", "PAYMENTS_NOT_CONFIGURED");
    const received = req.get("x-razorpay-signature");
    ensure(typeof received === "string" && /^[a-f\d]{64}$/i.test(received), 401, "Webhook signature is missing or invalid", "INVALID_WEBHOOK_SIGNATURE");
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const receivedBuffer = Buffer.from(received, "hex");
    ensure(expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer), 401, "Webhook signature is invalid", "INVALID_WEBHOOK_SIGNATURE");

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch (_error) {
      throw new LifecycleError(400, "Webhook body is not valid JSON", "INVALID_WEBHOOK_BODY");
    }
    const eventName = payload?.event;
    ensure(typeof eventName === "string", 400, "Webhook event is missing", "INVALID_WEBHOOK_BODY");
    const eventId = req.get("x-razorpay-event-id") || crypto.createHash("sha256").update(rawBody).digest("hex");
    const result = await processWebhookEvent(eventId, eventName, payload);
    res.status(200).json({ success: true, data: { received: true, duplicate: result.duplicate } });
  })
);

router.get(
  "/:bookingId",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.bookingId), 400, "Invalid booking ID", "INVALID_BOOKING_ID");
    const payment = await Payment.findOne({ booking: req.params.bookingId });
    ensure(payment, 404, "Payment not found", "PAYMENT_NOT_FOUND");
    ensure(await canViewPayment(payment, req.user), 403, "Only the booking participants can view this payment", "FORBIDDEN");
    res.json({ success: true, data: { payment: publicPayment(payment) } });
  })
);

router.post(
  "/:bookingId/verify",
  requireAuth,
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.bookingId), 400, "Invalid booking ID", "INVALID_BOOKING_ID");
    const result = await verifyCheckout({ bookingId: req.params.bookingId, customerId: req.user.id, body: req.body, req });
    res.json({ success: true, data: result });
  })
);

router.post(
  "/:bookingId/refund",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.bookingId), 400, "Invalid booking ID", "INVALID_BOOKING_ID");
    const amountPaise = Number(req.body?.amountPaise);
    ensure(Number.isInteger(amountPaise) && amountPaise > 0, 400, "amountPaise must be a positive integer", "INVALID_REFUND_AMOUNT");
    const payment = await createAdminRefund({ bookingId: req.params.bookingId, amountPaise, reason: req.body?.reason, actorId: req.user.id, req });
    res.json({ success: true, data: { payment: publicPayment(payment) } });
  })
);

module.exports = router;
