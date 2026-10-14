const Availability = require("./availability.model");
const AvailabilityDay = require("./availability-day.model");
const { localDateAndMinute } = require("../../utils/lifecycle");

const INDIA_OFFSET = "+05:30";

function dateAndTimeToDate(date, time) {
  return new Date(`${date}T${time}:00${INDIA_OFFSET}`);
}

function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function getProviderWindow(providerId, startsAt, endsAt) {
  const startLocal = localDateAndMinute(startsAt, "Asia/Kolkata");
  const endLocal = localDateAndMinute(new Date(endsAt.getTime() - 1), "Asia/Kolkata");
  if (startLocal.dateKey !== endLocal.dateKey) return null;
  const availability = await Availability.findOne({
    provider: providerId,
    slots: { $elemMatch: { date: startLocal.dateKey, startsAt: { $lte: startsAt }, endsAt: { $gte: endsAt } } },
  }).lean();
  if (!availability) return null;
  const slot = availability.slots.find((candidate) =>
    candidate.date === startLocal.dateKey &&
    new Date(candidate.startsAt) <= startsAt &&
    new Date(candidate.endsAt) >= endsAt
  );
  return slot || null;
}

async function reserveSlot({ providerId, bookingId, startsAt, endsAt, expiresAt }) {
  const local = localDateAndMinute(startsAt, "Asia/Kolkata");
  const endLocal = localDateAndMinute(new Date(endsAt.getTime() - 1), "Asia/Kolkata");
  if (local.dateKey !== endLocal.dateKey) return false;

  try {
    await AvailabilityDay.updateOne(
      { provider: providerId, dateKey: local.dateKey },
      { $setOnInsert: { provider: providerId, dateKey: local.dateKey, reservations: [] } },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  const now = new Date();
  const noOtherOverlap = {
    provider: providerId,
    dateKey: local.dateKey,
    reservations: {
      $not: {
        $elemMatch: {
          booking: { $ne: bookingId },
          startsAt: { $lt: endsAt },
          endsAt: { $gt: startsAt },
          $or: [
            { state: { $in: ["confirmed", "completed"] } },
            { state: "held", expiresAt: { $gt: now } },
          ],
        },
      },
    },
  };

  const existing = await AvailabilityDay.findOne({
    provider: providerId,
    dateKey: local.dateKey,
    "reservations.booking": bookingId,
  }).lean();
  const ownReservation = existing?.reservations?.find((item) => String(item.booking) === String(bookingId));
  if (ownReservation) {
    const updated = await AvailabilityDay.updateOne(
      { ...noOtherOverlap, "reservations.booking": bookingId },
      {
        $set: {
          "reservations.$[reservation].startsAt": startsAt,
          "reservations.$[reservation].endsAt": endsAt,
          "reservations.$[reservation].state": "held",
          "reservations.$[reservation].expiresAt": expiresAt,
        },
      },
      { arrayFilters: [{ "reservation.booking": bookingId }] }
    );
    return updated.modifiedCount === 1;
  }

  const result = await AvailabilityDay.updateOne(
    noOtherOverlap,
    { $push: { reservations: { booking: bookingId, startsAt, endsAt, state: "held", expiresAt } } }
  );
  return result.modifiedCount === 1;
}

async function setReservationState(bookingId, state, expiresAt = null) {
  await AvailabilityDay.updateMany(
    { "reservations.booking": bookingId },
    {
      $set: {
        "reservations.$[reservation].state": state,
        "reservations.$[reservation].expiresAt": expiresAt,
      },
    },
    { arrayFilters: [{ "reservation.booking": bookingId }] }
  );
}

async function getBusyIntervals(providerId, dateKey) {
  const now = new Date();
  const day = await AvailabilityDay.findOne({ provider: providerId, dateKey }).lean();
  return (day?.reservations || [])
    .filter((reservation) =>
      ["confirmed", "completed"].includes(reservation.state) ||
      (reservation.state === "held" && reservation.expiresAt && new Date(reservation.expiresAt) > now)
    )
    .map(({ startsAt, endsAt }) => ({ startsAt: new Date(startsAt), endsAt: new Date(endsAt) }));
}

module.exports = {
  INDIA_OFFSET,
  dateAndTimeToDate,
  isDateKey,
  getProviderWindow,
  reserveSlot,
  setReservationState,
  getBusyIntervals,
};
