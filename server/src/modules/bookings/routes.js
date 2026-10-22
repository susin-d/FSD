const express = require("express");
const { requireAuth, requireRole } = require("../../middleware/auth");
const User = require("../users/user.model");
const ProviderProfile = require("../providers/provider.model");
const Service = require("../services/service.model");
const Booking = require("./booking.model");
const MarketplaceSettings = require("../settings/marketplace-settings.model");
const { getProviderWindow, reserveSlot, setReservationState, getBusyIntervals } = require("../availability/service");
const { asyncHandler, ensure, isObjectId, sendEmail, recordAudit } = require("../../utils/lifecycle");

const router = express.Router();
const ACTIVE_BOOKING_STATUSES = ["requested", "accepted", "awaiting_payment", "confirmed", "completion_pending", "disputed"];

function populateBooking(query) {
  return query
    .populate("customer", "name email")
    .populate({ path: "provider", select: "businessName user", populate: { path: "user", select: "name email" } })
    .populate("service", "title category pricePaise durationMinutes")
    .populate({ path: "review", select: "_id" });
}

async function actorCanAccess(booking, user) {
  if (user.role === "admin") return true;
  if (String(booking.customer) === String(user.id)) return true;
  const profile = await ProviderProfile.findOne({ user: user.id }).select("_id");
  return Boolean(profile && String(booking.provider) === String(profile._id));
}

router.post(
  "/",
  requireAuth,
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const { serviceId, scheduledAt, servicePincode, serviceAddress, notes = "" } = req.body || {};
    ensure(isObjectId(serviceId), 400, "serviceId must be a valid service ID", "INVALID_SERVICE_ID");
    ensure(typeof scheduledAt === "string" && !Number.isNaN(Date.parse(scheduledAt)), 400, "scheduledAt must be an ISO date-time", "INVALID_SCHEDULED_AT");
    ensure(/^\d{6}$/.test(servicePincode || ""), 400, "servicePincode must contain six digits", "INVALID_PINCODE");
    ensure(typeof serviceAddress === "string" && serviceAddress.trim().length >= 8 && serviceAddress.trim().length <= 500, 400, "serviceAddress must be between 8 and 500 characters", "INVALID_ADDRESS");
    ensure(typeof notes === "string" && notes.length <= 2000, 400, "notes cannot exceed 2000 characters", "INVALID_NOTES");

    const service = await Service.findById(serviceId);
    ensure(service && service.isActive, 404, "Active service not found", "SERVICE_NOT_FOUND");
    ensure((service.servicePincodes || []).includes(servicePincode), 400, "Service is not available in this exact pincode", "PINCODE_NOT_SERVED");
    const provider = await ProviderProfile.findOne({ _id: service.provider, verificationStatus: "verified" });
    ensure(provider && provider.isActive !== false, 404, "Verified provider not found", "PROVIDER_NOT_AVAILABLE");
    ensure((provider.servicePincodes || []).includes(servicePincode), 400, "Provider does not serve this exact pincode", "PINCODE_NOT_SERVED");

    const start = new Date(scheduledAt);
    ensure(start > new Date(), 400, "scheduledAt must be in the future", "SCHEDULED_AT_IN_PAST");
    const durationMinutes = Number(service.durationMinutes);
    ensure(Number.isInteger(durationMinutes) && durationMinutes > 0, 409, "Service duration is not configured", "INVALID_SERVICE_DURATION");
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    const slot = await getProviderWindow(provider._id, start, end);
    ensure(slot, 409, "The requested time is outside the provider's published availability", "OUTSIDE_AVAILABILITY");

    const conflict = await Booking.exists({
      provider: provider._id,
      status: { $in: ACTIVE_BOOKING_STATUSES },
      scheduledAt: { $lt: end },
      $expr: {
        $gt: [
          { $add: ["$scheduledAt", { $multiply: ["$durationMinutes", 60_000] }] },
          start,
        ],
      },
    });
    ensure(!conflict, 409, "The requested time is already booked", "SLOT_UNAVAILABLE");
    const busy = await getBusyIntervals(provider._id, require("../../utils/lifecycle").localDateAndMinute(start, "Asia/Kolkata").dateKey);
    ensure(!busy.some((interval) => interval.startsAt < end && interval.endsAt > start), 409, "The requested time is currently held or booked", "SLOT_UNAVAILABLE");

    const booking = await Booking.create({
      customer: req.user.id,
      provider: provider._id,
      service: service._id,
      scheduledAt: start,
      servicePincode,
      serviceAddress: serviceAddress.trim(),
      notes: notes.trim(),
      status: "requested",
      pricePaise: Number(service.pricePaise),
      durationMinutes,
    });
    await recordAudit({ actorId: req.user.id, action: "booking.created", resourceType: "booking", resourceId: booking._id, req });
    const [customer, providerUser] = await Promise.all([
      User.findById(req.user.id).select("name email"),
      User.findById(provider.user).select("name email"),
    ]);
    if (providerUser?.email) {
      await sendEmail({
        to: providerUser.email,
        subject: "New Nearby booking request",
        text: `Hello ${providerUser.name || ""}, you have a new booking request for ${service.title}. Sign in to review it.`,
      }).catch((error) => console.error("Booking notification email failed:", error.message));
    }
    res.status(201).json({ success: true, data: { booking: await populateBooking(Booking.findById(booking._id)) } });
  })
);

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    let filter = {};
    if (req.user.role === "customer") filter.customer = req.user.id;
    else if (req.user.role === "provider") {
      const provider = await ProviderProfile.findOne({ user: req.user.id }).select("_id");
      ensure(provider, 404, "Provider profile not found", "PROVIDER_PROFILE_REQUIRED");
      filter.provider = provider._id;
    } else ensure(req.user.role === "admin", 403, "Not authorized", "FORBIDDEN");

    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    if (req.query.status) filter.status = req.query.status;
    const [items, total] = await Promise.all([
      populateBooking(Booking.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
      Booking.countDocuments(filter),
    ]);
    res.json({ success: true, data: { bookings: items, page, limit, total } });
  })
);

router.get(
  "/:bookingId",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.bookingId), 400, "Invalid booking ID", "INVALID_BOOKING_ID");
    const booking = await Booking.findById(req.params.bookingId);
    ensure(booking, 404, "Booking not found", "BOOKING_NOT_FOUND");
    ensure(await actorCanAccess(booking, req.user), 403, "Only the booking participants can access this booking", "FORBIDDEN");
    res.json({ success: true, data: { booking: await populateBooking(Booking.findById(booking._id)) } });
  })
);

router.post(
  "/:bookingId/accept",
  requireAuth,
  requireRole("provider"),
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.bookingId), 400, "Invalid booking ID", "INVALID_BOOKING_ID");
    const provider = await ProviderProfile.findOne({ user: req.user.id });
    ensure(provider, 404, "Provider profile not found", "PROVIDER_PROFILE_REQUIRED");
    const current = await Booking.findOne({ _id: req.params.bookingId, provider: provider._id, status: "requested" });
    ensure(current, 409, "Booking cannot be accepted in its current state", "BOOKING_STATE_CONFLICT");
    const conflict = await Booking.exists({
      _id: { $ne: current._id },
      provider: provider._id,
      status: { $in: ["accepted", "awaiting_payment", "confirmed", "completion_pending", "disputed"] },
      scheduledAt: { $lt: new Date(current.scheduledAt.getTime() + current.durationMinutes * 60_000) },
      $expr: { $gt: [{ $add: ["$scheduledAt", { $multiply: ["$durationMinutes", 60_000] }] }, current.scheduledAt] },
    });
    ensure(!conflict, 409, "Another booking already holds this time", "SLOT_UNAVAILABLE");
    const start = new Date(current.scheduledAt);
    const end = new Date(start.getTime() + current.durationMinutes * 60_000);
    ensure(await getProviderWindow(provider._id, start, end), 409, "Provider availability has changed", "OUTSIDE_AVAILABILITY");
    const settings = await MarketplaceSettings.findOne({ key: "marketplace" }).lean();
    ensure(Number.isInteger(settings?.checkoutTimeoutMinutes), 503, "Checkout timeout is not configured", "MARKETPLACE_NOT_CONFIGURED");
    const holdExpiresAt = new Date(Date.now() + settings.checkoutTimeoutMinutes * 60_000);
    ensure(await reserveSlot({ providerId: provider._id, bookingId: current._id, startsAt: start, endsAt: end, expiresAt: holdExpiresAt }), 409, "Another booking already holds this time", "SLOT_UNAVAILABLE");
    const booking = await Booking.findOneAndUpdate(
      { _id: current._id, provider: provider._id, status: "requested" },
      { $set: { status: "accepted", slotHoldExpiresAt: holdExpiresAt } },
      { new: true }
    );
    if (!booking) {
      await setReservationState(current._id, "expired");
      throw new (require("../../utils/lifecycle").LifecycleError)(409, "Booking cannot be accepted in its current state", "BOOKING_STATE_CONFLICT");
    }
    await recordAudit({ actorId: req.user.id, action: "booking.accepted", resourceType: "booking", resourceId: booking._id, req });
    await notifyBookingCustomer(booking, "Your Nearby booking request was accepted. Start checkout to confirm the time.", "Booking request accepted");
    res.json({ success: true, data: { booking: await populateBooking(Booking.findById(booking._id)) } });
  })
);

router.post(
  "/:bookingId/reject",
  requireAuth,
  requireRole("provider"),
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.bookingId), 400, "Invalid booking ID", "INVALID_BOOKING_ID");
    const provider = await ProviderProfile.findOne({ user: req.user.id });
    ensure(provider, 404, "Provider profile not found", "PROVIDER_PROFILE_REQUIRED");
    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.bookingId, provider: provider._id, status: "requested" },
      { $set: { status: "rejected" } },
      { new: true }
    );
    ensure(booking, 409, "Booking cannot be rejected in its current state", "BOOKING_STATE_CONFLICT");
    await recordAudit({ actorId: req.user.id, action: "booking.rejected", resourceType: "booking", resourceId: booking._id, req });
    await notifyBookingCustomer(booking, "Your Nearby booking request was declined by the provider.", "Booking request declined");
    res.json({ success: true, data: { booking: await populateBooking(Booking.findById(booking._id)) } });
  })
);

router.post(
  "/:bookingId/checkout",
  requireAuth,
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.bookingId), 400, "Invalid booking ID", "INVALID_BOOKING_ID");
    const { createCheckout } = require("../payments/service");
    const checkout = await createCheckout({ bookingId: req.params.bookingId, customerId: req.user.id, req });
    res.status(201).json({ success: true, data: checkout });
  })
);

router.post(
  "/:bookingId/complete",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.bookingId), 400, "Invalid booking ID", "INVALID_BOOKING_ID");
    const booking = await Booking.findById(req.params.bookingId);
    ensure(booking, 404, "Booking not found", "BOOKING_NOT_FOUND");
    ensure(await actorCanAccess(booking, req.user) && req.user.role !== "admin", 403, "Only a customer or provider in this booking can mark it complete", "FORBIDDEN");
    ensure(booking.status === "confirmed", 409, "Only a confirmed booking can be marked complete", "BOOKING_STATE_CONFLICT");
    const openDispute = await require("../disputes/dispute.model").exists({ booking: booking._id, status: "open" });
    ensure(!openDispute, 409, "An open dispute must be resolved before completion", "DISPUTE_OPEN");
    const settings = await MarketplaceSettings.findOne({ key: "marketplace" }).lean();
    ensure(Number.isInteger(settings?.completionReviewHours), 503, "Completion review period is not configured", "MARKETPLACE_NOT_CONFIGURED");
    const now = new Date();
    const reviewDeadlineAt = new Date(now.getTime() + settings.completionReviewHours * 3_600_000);
    const completionPendingBooking = await Booking.findOneAndUpdate(
      { _id: booking._id, status: "confirmed" },
      { $set: {
        status: "completion_pending",
        completionMarkedAt: now,
        completionMarkedBy: req.user.id,
        reviewDeadlineAt,
      } },
      { new: true },
    );
    ensure(completionPendingBooking, 409, "Only a confirmed booking can be marked complete", "BOOKING_STATE_CONFLICT");
    await setReservationState(booking._id, "confirmed", null);
    await recordAudit({ actorId: req.user.id, action: "booking.completion_marked", resourceType: "booking", resourceId: booking._id, metadata: { reviewDeadlineAt }, req });
    res.json({ success: true, data: { booking: await populateBooking(Booking.findById(booking._id)), reviewDeadlineAt } });
  })
);

router.post(
  "/:bookingId/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.bookingId), 400, "Invalid booking ID", "INVALID_BOOKING_ID");
    const { cancelBooking } = require("../payments/service");
    const booking = await cancelBooking({ bookingId: req.params.bookingId, user: req.user, reason: req.body?.reason, req });
    res.json({ success: true, data: { booking: await populateBooking(Booking.findById(booking._id)) } });
  })
);

async function notifyBookingCustomer(booking, text, subject) {
  const customer = await User.findById(booking.customer).select("name email");
  if (customer?.email) {
    await sendEmail({ to: customer.email, subject, text: `Hello ${customer.name || ""}, ${text}` })
      .catch((error) => console.error("Booking notification email failed:", error.message));
  }
}

module.exports = router;
