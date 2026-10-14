const express = require("express");
const { requireAuth } = require("../../middleware/auth");
const Booking = require("../bookings/booking.model");
const ProviderProfile = require("../providers/provider.model");
const Message = require("./message.model");
const User = require("../users/user.model");
const { asyncHandler, ensure, isObjectId, sendEmail } = require("../../utils/lifecycle");

const router = express.Router();
let messageIo = null;
const MESSAGE_STATUSES = ["accepted", "awaiting_payment", "confirmed", "completion_pending", "completed", "disputed"];

async function canParticipate(booking, user) {
  if (String(booking.customer) === String(user.id)) return true;
  const profile = await ProviderProfile.findOne({ user: user.id }).select("_id");
  return Boolean(profile && String(profile._id) === String(booking.provider));
}

async function createMessage(bookingId, senderId, rawText) {
  ensure(isObjectId(bookingId), 400, "Invalid booking ID", "INVALID_BOOKING_ID");
  const text = typeof rawText === "string" ? rawText.trim() : "";
  ensure(text.length > 0 && text.length <= 4000, 400, "Message must be between 1 and 4000 characters", "INVALID_MESSAGE");
  const booking = await Booking.findById(bookingId);
  ensure(booking, 404, "Booking not found", "BOOKING_NOT_FOUND");
  ensure(MESSAGE_STATUSES.includes(booking.status), 409, "Messaging opens after a provider accepts the booking", "MESSAGING_NOT_AVAILABLE");
  ensure(await canParticipate(booking, { id: senderId }), 403, "Only booking participants can access this conversation", "FORBIDDEN");
  const message = await Message.create({ booking: booking._id, sender: senderId, text });
  const populated = await Message.findById(message._id).populate("sender", "name role").lean();
  return { booking, message: populated };
}

async function notifyRecipient(booking, senderId, text) {
  let recipientId = booking.customer;
  if (String(booking.customer) === String(senderId)) {
    const provider = await ProviderProfile.findById(booking.provider).select("user");
    recipientId = provider?.user;
  }
  const recipient = recipientId ? await User.findById(recipientId).select("name email") : null;
  if (recipient?.email) {
    await sendEmail({
      to: recipient.email,
      subject: "New message about your Nearby booking",
      text: `Hello ${recipient.name || ""}, you have a new booking message: ${text.slice(0, 500)}`,
    }).catch((error) => console.error("Message notification email failed:", error.message));
  }
}

router.get(
  "/:bookingId",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.bookingId), 400, "Invalid booking ID", "INVALID_BOOKING_ID");
    const booking = await Booking.findById(req.params.bookingId);
    ensure(booking, 404, "Booking not found", "BOOKING_NOT_FOUND");
    ensure(MESSAGE_STATUSES.includes(booking.status), 409, "Messaging opens after a provider accepts the booking", "MESSAGING_NOT_AVAILABLE");
    ensure(await canParticipate(booking, req.user), 403, "Only booking participants can access this conversation", "FORBIDDEN");
    const before = req.query.before && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
    const filter = { booking: booking._id, ...(before ? { createdAt: { $lt: before } } : {}) };
    const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(100).populate("sender", "name role").lean();
    await Message.updateMany({ booking: booking._id, sender: { $ne: req.user.id }, readAt: null }, { $set: { readAt: new Date() } });
    res.json({ success: true, data: { messages: messages.reverse() } });
  })
);

router.post(
  "/:bookingId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { booking, message } = await createMessage(req.params.bookingId, req.user.id, req.body?.text);
    messageIo?.to(`booking:${String(booking._id)}`).emit("message:new", message);
    await notifyRecipient(booking, req.user.id, message.text);
    res.status(201).json({ success: true, data: { message } });
  })
);

function attachMessageSocket(io) {
  if (!io) throw new TypeError("Socket.IO server instance is required");
  const jwt = require("jsonwebtoken");
  messageIo = io;
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      ensure(typeof token === "string" && token.length > 0, 401, "Socket authentication is required", "UNAUTHORIZED");
      const claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
      const userId = claims.sub || claims.id || claims.userId;
      ensure(isObjectId(userId), 401, "Socket token is invalid", "UNAUTHORIZED");
      const user = await User.findById(userId).select("role email isActive");
      ensure(user && user.isActive !== false && user.role === claims.role, 401, "Socket account is inactive", "UNAUTHORIZED");
      socket.user = { id: String(user._id), role: user.role, email: user.email };
      return next();
    } catch (error) {
      const authError = new Error(error.status ? error.message : "Socket authentication failed");
      authError.data = { code: error.code || "UNAUTHORIZED" };
      return next(authError);
    }
  });

  io.on("connection", (socket) => {
    socket.on("booking:join", async (payload, acknowledge = () => {}) => {
      try {
        const bookingId = payload?.bookingId;
        ensure(isObjectId(bookingId), 400, "Invalid booking ID", "INVALID_BOOKING_ID");
        const booking = await Booking.findById(bookingId);
        ensure(booking, 404, "Booking not found", "BOOKING_NOT_FOUND");
        ensure(MESSAGE_STATUSES.includes(booking.status), 409, "Messaging opens after a provider accepts the booking", "MESSAGING_NOT_AVAILABLE");
        ensure(await canParticipate(booking, socket.user), 403, "Only booking participants can join this conversation", "FORBIDDEN");
        await socket.join(`booking:${String(booking._id)}`);
        acknowledge({ success: true });
      } catch (error) {
        acknowledge({ success: false, error: { code: error.code || "FORBIDDEN", message: error.message } });
      }
    });

    socket.on("message:send", async (payload, acknowledge = () => {}) => {
      try {
        const { booking, message } = await createMessage(payload?.bookingId, socket.user.id, payload?.text);
        io.to(`booking:${String(booking._id)}`).emit("message:new", message);
        await notifyRecipient(booking, socket.user.id, message.text);
        acknowledge({ success: true, data: { message } });
      } catch (error) {
        acknowledge({ success: false, error: { code: error.code || "MESSAGE_FAILED", message: error.message } });
      }
    });
  });
}

module.exports = router;
module.exports.attachMessageSocket = attachMessageSocket;
