const express = require("express");
const { requireAuth, requireRole } = require("../../middleware/auth");
const Booking = require("../bookings/booking.model");
const Review = require("./review.model");
const { asyncHandler, ensure, isObjectId, recordAudit } = require("../../utils/lifecycle");

const router = express.Router();

router.post(
  "/",
  requireAuth,
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const { bookingId, rating, comment = "" } = req.body || {};
    ensure(isObjectId(bookingId), 400, "bookingId must be a valid booking ID", "INVALID_BOOKING_ID");
    ensure(Number.isInteger(rating) && rating >= 1 && rating <= 5, 400, "rating must be an integer from 1 to 5", "INVALID_RATING");
    ensure(typeof comment === "string" && comment.length <= 2000, 400, "comment cannot exceed 2000 characters", "INVALID_COMMENT");
    const booking = await Booking.findOne({ _id: bookingId, customer: req.user.id });
    ensure(booking, 404, "Booking not found", "BOOKING_NOT_FOUND");
    ensure(booking.status === "completed", 409, "Only completed bookings can be reviewed", "BOOKING_NOT_COMPLETED");
    ensure(!await Review.exists({ booking: booking._id }), 409, "This booking already has a review", "REVIEW_ALREADY_EXISTS");
    const review = await Review.create({
      booking: booking._id,
      customer: booking.customer,
      provider: booking.provider,
      service: booking.service,
      rating,
      comment: comment.trim(),
    });
    await recordAudit({ actorId: req.user.id, action: "review.created", resourceType: "review", resourceId: review._id, metadata: { bookingId: String(booking._id) }, req });
    res.status(201).json({ success: true, data: { review: await Review.findById(review._id).populate("customer", "name").lean() } });
  })
);

router.get(
  "/service/:serviceId",
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.serviceId), 400, "Invalid service ID", "INVALID_SERVICE_ID");
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const [reviews, total] = await Promise.all([
      Review.find({ service: req.params.serviceId }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("customer", "name").lean(),
      Review.countDocuments({ service: req.params.serviceId }),
    ]);
    res.json({ success: true, data: { reviews, page, limit, total } });
  })
);

module.exports = router;
