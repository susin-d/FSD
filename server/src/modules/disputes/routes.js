const express = require("express");
const { requireAuth, requireRole } = require("../../middleware/auth");
const Booking = require("../bookings/booking.model");
const ProviderProfile = require("../providers/provider.model");
const User = require("../users/user.model");
const Dispute = require("./dispute.model");
const Payment = require("../payments/payment.model");
const MarketplaceSettings = require("../settings/marketplace-settings.model");
const { refundPayment, releaseHeldTransfer } = require("../payments/service");
const { setReservationState } = require("../availability/service");
const { asyncHandler, ensure, isObjectId, recordAudit, sendEmail } = require("../../utils/lifecycle");

const router = express.Router();
const DISPUTABLE_STATES = ["confirmed", "completion_pending", "completed"];

async function isParticipant(booking, user) {
  if (String(booking.customer) === String(user.id)) return true;
  const profile = await ProviderProfile.findOne({ user: user.id }).select("_id");
  return Boolean(profile && String(profile._id) === String(booking.provider));
}

router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bookingId, reason } = req.body || {};
    ensure(isObjectId(bookingId), 400, "bookingId must be a valid booking ID", "INVALID_BOOKING_ID");
    ensure(typeof reason === "string" && reason.trim().length >= 10 && reason.trim().length <= 3000, 400, "reason must be between 10 and 3000 characters", "INVALID_DISPUTE_REASON");
    const booking = await Booking.findById(bookingId);
    ensure(booking, 404, "Booking not found", "BOOKING_NOT_FOUND");
    ensure(await isParticipant(booking, req.user), 403, "Only booking participants can open a dispute", "FORBIDDEN");
    ensure(DISPUTABLE_STATES.includes(booking.status), 409, "This booking cannot be disputed in its current state", "BOOKING_STATE_CONFLICT");
    const existing = await Dispute.findOne({ booking: booking._id });
    ensure(!existing, 409, "A dispute already exists for this booking", "DISPUTE_ALREADY_EXISTS");

    // Claim the booking state first so a stale completion write cannot replace "disputed".
    // Returning the pre-update document captures the actual state if completion advanced it
    // after the initial read above.
    const transitionedFrom = await Booking.findOneAndUpdate(
      { _id: booking._id, status: { $in: DISPUTABLE_STATES } },
      { $set: { status: "disputed" } },
      { new: false },
    );
    ensure(transitionedFrom, 409, "This booking cannot be disputed in its current state", "BOOKING_STATE_CONFLICT");

    let dispute;
    try {
      dispute = await Dispute.create({
        booking: booking._id,
        openedBy: req.user.id,
        reason: reason.trim(),
        previousBookingStatus: transitionedFrom.status,
        status: "open",
      });
    } catch (error) {
      await Booking.updateOne(
        { _id: booking._id, status: "disputed" },
        { $set: { status: transitionedFrom.status } },
      ).catch((rollbackError) => console.error("Could not restore booking after dispute creation failed:", rollbackError.message));
      throw error;
    }
    await recordAudit({ actorId: req.user.id, action: "dispute.opened", resourceType: "dispute", resourceId: dispute._id, metadata: { bookingId: String(booking._id) }, req });
    await notifyParticipants(booking, req.user.id, "Nearby booking dispute opened", "A dispute has been opened and provider payout is paused while it is reviewed.");
    res.status(201).json({ success: true, data: { dispute: await Dispute.findById(dispute._id).populate("openedBy", "name role").lean() } });
  })
);

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    let query = {};
    if (req.user.role === "admin") {
      query.status = req.query.status === "resolved" ? "resolved" : "open";
    } else {
      const customerBookings = await Booking.find({ customer: req.user.id }).distinct("_id");
      const profile = req.user.role === "provider" ? await ProviderProfile.findOne({ user: req.user.id }).select("_id") : null;
      const providerBookings = profile ? await Booking.find({ provider: profile._id }).distinct("_id") : [];
      query.booking = { $in: [...customerBookings, ...providerBookings] };
    }
    const disputes = await Dispute.find(query).sort({ createdAt: -1 }).limit(100)
      .populate("openedBy", "name role")
      .populate({ path: "booking", select: "status scheduledAt customer provider service", populate: [{ path: "customer", select: "name" }, { path: "provider", select: "businessName" }, { path: "service", select: "title" }] })
      .lean();
    res.json({ success: true, data: { disputes } });
  })
);

router.get(
  "/:disputeId",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.disputeId), 400, "Invalid dispute ID", "INVALID_DISPUTE_ID");
    const dispute = await Dispute.findById(req.params.disputeId)
      .populate("openedBy", "name role")
      .populate("booking", "status scheduledAt servicePincode serviceAddress customer provider service")
      .lean();
    ensure(dispute, 404, "Dispute not found", "DISPUTE_NOT_FOUND");
    const booking = await Booking.findById(dispute.booking?._id || dispute.booking);
    ensure(req.user.role === "admin" || (booking && await isParticipant(booking, req.user)), 403, "Only dispute participants can view this case", "FORBIDDEN");
    res.json({ success: true, data: { dispute } });
  })
);

router.patch(
  "/:disputeId",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.disputeId), 400, "Invalid dispute ID", "INVALID_DISPUTE_ID");
    const dispute = await Dispute.findById(req.params.disputeId);
    ensure(dispute, 404, "Dispute not found", "DISPUTE_NOT_FOUND");
    const { status = "resolved", refundBps } = req.body || {};
    const resolutionInput = req.body?.resolution;
    const requestedOutcome = typeof resolutionInput === "string" ? resolutionInput : resolutionInput?.outcome || req.body?.outcome;
    const requestedRefundBps = refundBps ?? resolutionInput?.refundBps;
    const notes = req.body?.note ?? resolutionInput?.note ?? req.body?.notes ?? "";
    ensure(status === "resolved", 400, "status must be resolved", "INVALID_DISPUTE_STATUS");
    ensure(typeof notes === "string" && notes.length <= 3000, 400, "notes cannot exceed 3000 characters", "INVALID_DISPUTE_NOTES");
    const wasOpen = dispute.status === "open";
    const outcome = wasOpen ? requestedOutcome : dispute.resolution?.outcome;
    ensure(["provider_favor", "customer_refund", "partial_refund"].includes(outcome), 409, "Resolved dispute is missing a valid recorded outcome", "INVALID_DISPUTE_OUTCOME");
    if (!wasOpen && requestedOutcome) ensure(requestedOutcome === outcome, 409, "This dispute was already resolved with a different outcome", "DISPUTE_ALREADY_RESOLVED");
    const booking = await Booking.findById(dispute.booking);
    ensure(booking, 404, "Booking not found for dispute", "BOOKING_NOT_FOUND");
    if (wasOpen) ensure(booking.status === "disputed", 409, "Booking no longer has an open dispute state", "BOOKING_STATE_CONFLICT");
    const payment = await Payment.findOne({ booking: booking._id });
    let resolvedRefundBps = wasOpen ? 0 : Number(dispute.resolution?.refundBps || 0);

    if (wasOpen && (outcome === "customer_refund" || outcome === "partial_refund")) {
      resolvedRefundBps = outcome === "customer_refund" ? 10_000 : Number(requestedRefundBps);
      ensure(Number.isInteger(resolvedRefundBps) && resolvedRefundBps > 0 && resolvedRefundBps <= 10_000, 400, "partial_refund requires refundBps from 1 to 10000", "INVALID_REFUND_BPS");
      ensure(payment && ["paid", "partially_refunded", "refunded"].includes(payment.status), 409, "There is no refundable captured payment for this booking", "PAYMENT_NOT_REFUNDABLE");
      const targetRefund = Math.floor((payment.amountPaise * resolvedRefundBps) / 10_000);
      const refundAmount = Math.max(0, targetRefund - payment.refundedAmountPaise);
      if (refundAmount > 0) await refundPayment(payment._id, refundAmount, `Dispute ${outcome}`, { actorId: req.user.id, req });
    } else if (wasOpen) {
      ensure(requestedRefundBps === undefined, 400, "refundBps is only valid for a customer or partial refund outcome", "INVALID_REFUND_BPS");
    }

    if (wasOpen) {
      dispute.status = "resolved";
      dispute.resolution = {
        outcome,
        refundBps: outcome === "provider_favor" ? null : resolvedRefundBps,
        notes: notes.trim(),
        resolvedBy: req.user.id,
        resolvedAt: new Date(),
      };
      await dispute.save();
    }

    if (outcome === "provider_favor") {
      booking.status = dispute.previousBookingStatus;
    } else if (dispute.previousBookingStatus === "completed" || dispute.previousBookingStatus === "completion_pending") {
      booking.status = "completed";
      booking.completedAt = booking.completedAt || new Date();
      booking.reviewDeadlineAt = null;
    } else {
      booking.status = "cancelled";
      booking.cancelledAt = booking.cancelledAt || new Date();
      booking.cancellationReason = booking.cancellationReason || "Resolved through dispute review";
      booking.slotHoldExpiresAt = null;
    }
    await booking.save();
    if (booking.status === "completed") await setReservationState(booking._id, "completed");
    if (booking.status === "cancelled") await setReservationState(booking._id, "cancelled");

    if (payment && ["completed", "cancelled"].includes(booking.status)) {
      try {
        const refreshedPayment = await Payment.findById(payment._id);
        const remainingProviderBalance = (refreshedPayment?.providerAmountPaise || 0) - (refreshedPayment?.providerRefundedAmountPaise || 0);
        if (remainingProviderBalance > 0 && ["paid", "partially_refunded"].includes(refreshedPayment?.status)) {
          await releaseHeldTransfer(refreshedPayment, booking);
        }
      } catch (error) {
        console.error(`Could not release remaining provider payout after dispute ${dispute._id}:`, error.message);
      }
    }

    if (wasOpen) {
      await recordAudit({ actorId: req.user.id, action: "dispute.resolved", resourceType: "dispute", resourceId: dispute._id, metadata: { bookingId: String(booking._id), outcome, refundBps: resolvedRefundBps }, req });
      await notifyParticipants(booking, req.user.id, "Nearby dispute resolved", `The dispute was resolved in favor of ${outcome === "provider_favor" ? "the provider" : "the customer"}${resolvedRefundBps ? ` with a ${resolvedRefundBps / 100}% refund` : ""}.`);
    }
    res.json({
      success: true,
      data: {
        dispute: await Dispute.findById(dispute._id)
          .populate({ path: "resolution.resolvedBy", select: "name" })
          .lean(),
        bookingStatus: booking.status,
      },
    });
  })
);

async function notifyParticipants(booking, actorId, subject, text) {
  const profile = await ProviderProfile.findById(booking.provider).select("user");
  const ids = [booking.customer, profile?.user].filter((id) => id && String(id) !== String(actorId));
  const users = await User.find({ _id: { $in: ids } }).select("name email");
  await Promise.all(users.filter((user) => user.email).map((user) =>
    sendEmail({ to: user.email, subject, text: `Hello ${user.name || ""}, ${text}` }).catch((error) => console.error("Dispute notification email failed:", error.message))
  ));
}

module.exports = router;
