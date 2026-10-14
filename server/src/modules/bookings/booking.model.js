const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "ProviderProfile", required: true, index: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true, index: true },
    scheduledAt: { type: Date, required: true, index: true },
    servicePincode: { type: String, required: true, match: /^\d{6}$/ },
    serviceAddress: { type: String, required: true, trim: true, maxlength: 500 },
    notes: { type: String, trim: true, maxlength: 2000, default: "" },
    status: {
      type: String,
      enum: ["requested", "accepted", "checkout_expired", "awaiting_payment", "confirmed", "completion_pending", "completed", "rejected", "cancelled", "disputed"],
      default: "requested",
      index: true,
    },
    pricePaise: { type: Number, required: true, min: 1 },
    durationMinutes: { type: Number, required: true, min: 1 },
    slotHoldExpiresAt: { type: Date, default: null, index: true },
    completionMarkedAt: { type: Date, default: null },
    completionMarkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewDeadlineAt: { type: Date, default: null, index: true },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true }
);

bookingSchema.index({ customer: 1, createdAt: -1 });
bookingSchema.index({ provider: 1, scheduledAt: 1, status: 1 });
bookingSchema.virtual("review", {
  ref: "Review",
  localField: "_id",
  foreignField: "booking",
  justOne: true,
});
module.exports = mongoose.models.Booking || mongoose.model("Booking", bookingSchema);
