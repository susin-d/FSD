const express = require("express");
const { requireAuth, requireRole } = require("../../middleware/auth");
const ProviderProfile = require("../providers/provider.model");
const Availability = require("./availability.model");
const AvailabilityDay = require("./availability-day.model");
const { asyncHandler, ensure } = require("../../utils/lifecycle");
const { dateAndTimeToDate, isDateKey, getBusyIntervals } = require("./service");

const router = express.Router();

router.put(
  "/me",
  requireAuth,
  requireRole("provider"),
  asyncHandler(async (req, res) => {
    const profile = await ProviderProfile.findOne({ user: req.user.id });
    ensure(profile, 404, "Create a provider profile before setting availability", "PROVIDER_PROFILE_REQUIRED");
    const { date } = req.body || {};
    ensure(isDateKey(date), 400, "date must be a valid YYYY-MM-DD date", "INVALID_DATE");
    ensure(Array.isArray(req.body.slots) && req.body.slots.length <= 48, 400, "slots must be an array with at most 48 entries", "INVALID_SLOTS");

    const slots = req.body.slots.map((slot) => {
      ensure(/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime || "") && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.endTime || ""), 400, "Slot times must use 24-hour HH:mm format", "INVALID_SLOT_TIME");
      const startsAt = dateAndTimeToDate(date, slot.startTime);
      const endsAt = dateAndTimeToDate(date, slot.endTime);
      ensure(endsAt > startsAt, 400, "Slot endTime must be later than startTime", "INVALID_SLOT_RANGE");
      ensure(endsAt.getTime() - startsAt.getTime() <= 16 * 60 * 60 * 1000, 400, "A slot cannot exceed 16 hours", "INVALID_SLOT_RANGE");
      return { date, startTime: slot.startTime, endTime: slot.endTime, startsAt, endsAt };
    });

    slots.sort((a, b) => a.startsAt - b.startsAt);
    for (let index = 1; index < slots.length; index += 1) {
      ensure(slots[index - 1].endsAt <= slots[index].startsAt, 400, "Availability slots cannot overlap", "OVERLAPPING_AVAILABILITY");
    }

    const existing = await Availability.findOne({ provider: profile._id });
    const otherDates = (existing?.slots || []).filter((slot) => slot.date !== date);
    const currentDay = await AvailabilityDay.findOne({ provider: profile._id, dateKey: date }).lean();
    const now = new Date();
    const activeReservations = (currentDay?.reservations || []).filter((reservation) =>
      reservation.state === "confirmed" || (reservation.state === "held" && reservation.expiresAt && new Date(reservation.expiresAt) > now)
    );
    for (const reservation of activeReservations) {
      ensure(slots.some((slot) => slot.startsAt <= new Date(reservation.startsAt) && slot.endsAt >= new Date(reservation.endsAt)), 409, "Availability cannot remove a time window that is currently held or booked", "ACTIVE_BOOKING_IN_SLOT");
    }

    const availability = await Availability.findOneAndUpdate(
      { provider: profile._id },
      { $set: { slots: [...otherDates, ...slots].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)) } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: { availability: { date, slots: availability.slots.filter((slot) => slot.date === date).map((slot) => ({ startTime: slot.startTime, endTime: slot.endTime })) } } });
  })
);

router.get(
  "/:providerId",
  asyncHandler(async (req, res) => {
    ensure(/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || ""), 400, "date is required as YYYY-MM-DD", "INVALID_DATE");
    ensure(isDateKey(req.query.date), 400, "date must be a valid YYYY-MM-DD date", "INVALID_DATE");
    const profile = await ProviderProfile.findById(req.params.providerId);
    ensure(profile && profile.verificationStatus === "verified", 404, "Verified provider not found", "PROVIDER_NOT_FOUND");
    if (req.query.pincode) {
      ensure(/^\d{6}$/.test(req.query.pincode), 400, "pincode must contain six digits", "INVALID_PINCODE");
      ensure(profile.servicePincodes.includes(req.query.pincode), 404, "Provider does not serve this pincode", "PINCODE_NOT_SERVED");
    }

    const availability = await Availability.findOne({ provider: profile._id, "slots.date": req.query.date }).lean();
    if (!availability) return res.json({ success: true, data: { providerId: String(profile._id), date: req.query.date, slots: [] } });
    const busy = await getBusyIntervals(profile._id, req.query.date);
    const slots = availability.slots
      .filter((slot) => slot.date === req.query.date)
      .map((slot) => ({
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        available: !busy.some((interval) => interval.startsAt < slot.endsAt && interval.endsAt > slot.startsAt),
      }));
    res.json({ success: true, data: { providerId: String(profile._id), date: req.query.date, slots } });
  })
);

module.exports = router;
