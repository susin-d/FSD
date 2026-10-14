const mongoose = require("mongoose");

class LifecycleError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "LifecycleError";
    this.status = status;
    this.code = code;
  }
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error("Lifecycle request failed:", err.message);
  return res.status(status).json({
    error: status >= 500 ? "An unexpected server error occurred" : err.message,
    code: err.code || (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR"),
  });
}

function ensure(condition, status, message, code) {
  if (!condition) throw new LifecycleError(status, message, code);
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function sendEmail({ to, subject, text }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.EMAIL_FROM;
  if (!host || !user || !pass || !from) {
    return { sent: false, reason: "smtp_not_configured" };
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (_err) {
    console.error("SMTP is configured but nodemailer is not installed");
    return { sent: false, reason: "smtp_adapter_unavailable" };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });
  await transporter.sendMail({ from, to, subject, text });
  return { sent: true };
}

async function recordAudit({ actorId, action, resourceType, resourceId, metadata, req, idempotencyKey }) {
  const AuditLog = require("../modules/admin/audit-log.model");
  try {
    await AuditLog.create({
      actor: actorId || null,
      action,
      resourceType,
      resourceId: resourceId ? String(resourceId) : undefined,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      metadata: metadata || {},
      ip: req?.ip,
      userAgent: req?.get?.("user-agent"),
    });
  } catch (error) {
    if (!idempotencyKey || error.code !== 11000) throw error;
  }
}

function localDateAndMinute(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function weekdayForDateKey(dateKey) {
  return new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
}

async function startLifecycleWorker() {
  let running = false;
  const tick = async () => {
    if (running || mongoose.connection.readyState !== 1) return;
    running = true;
    try {
      await expireCheckoutHolds();
      await completeMatureJobs();
      await require("../modules/payments/service").reconcilePendingRefunds();
    } catch (error) {
      console.error("Booking lifecycle worker failed:", error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, 30_000);
  timer.unref?.();
  void tick();
  return timer;
}

async function expireCheckoutHolds() {
  const Booking = require("../modules/bookings/booking.model");
  const Payment = require("../modules/payments/payment.model");
  const AvailabilityDay = require("../modules/availability/availability-day.model");
  const now = new Date();
  const expired = await Booking.find({
    status: { $in: ["accepted", "awaiting_payment"] },
    slotHoldExpiresAt: { $lte: now },
  }).select("_id provider scheduledAt");

  for (const booking of expired) {
    const changed = await Booking.findOneAndUpdate(
      { _id: booking._id, status: { $in: ["accepted", "awaiting_payment"] }, slotHoldExpiresAt: { $lte: now } },
      { $set: { status: "checkout_expired", slotHoldExpiresAt: null } },
      { new: true }
    );
    if (!changed) continue;
    await Payment.updateOne(
      { booking: booking._id, status: { $in: ["creating", "created"] }, orderCreationReconciliationRequired: { $ne: true } },
      { $set: { status: "expired" } }
    );
    await AvailabilityDay.updateMany(
      { "reservations.booking": booking._id },
      { $set: { "reservations.$[reservation].state": "expired" } },
      { arrayFilters: [{ "reservation.booking": booking._id, "reservation.state": "held" }] }
    );
  }
}

async function completeMatureJobs() {
  const Booking = require("../modules/bookings/booking.model");
  const Dispute = require("../modules/disputes/dispute.model");
  const AvailabilityDay = require("../modules/availability/availability-day.model");
  const Payment = require("../modules/payments/payment.model");
  const now = new Date();
  const candidates = await Booking.find({
    status: "completion_pending",
    reviewDeadlineAt: { $lte: now },
  }).select("_id");

  for (const candidate of candidates) {
    const dispute = await Dispute.exists({ booking: candidate._id, status: "open" });
    if (dispute) continue;
    const booking = await Booking.findOneAndUpdate(
      { _id: candidate._id, status: "completion_pending", reviewDeadlineAt: { $lte: now } },
      { $set: { status: "completed", completedAt: now } },
      { new: true }
    );
    if (!booking) continue;
    await AvailabilityDay.updateMany(
      { "reservations.booking": booking._id },
      { $set: { "reservations.$[reservation].state": "completed" } },
      { arrayFilters: [{ "reservation.booking": booking._id }] }
    );
    const payment = await Payment.findOne({ booking: booking._id, status: { $in: ["paid", "partially_refunded"] } });
    if (payment) {
      try {
        const { releaseHeldTransfer } = require("../modules/payments/service");
        await releaseHeldTransfer(payment, booking);
      } catch (error) {
        console.error(`Could not release transfer for booking ${booking._id}:`, error.message);
      }
    }
  }
}

module.exports = {
  LifecycleError,
  asyncHandler,
  errorHandler,
  ensure,
  isObjectId,
  escapeHtml,
  sendEmail,
  recordAudit,
  localDateAndMinute,
  weekdayForDateKey,
  startLifecycleWorker,
  expireCheckoutHolds,
  completeMatureJobs,
};
