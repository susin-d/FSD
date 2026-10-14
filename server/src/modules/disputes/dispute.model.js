const mongoose = require("mongoose");

const disputeSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, unique: true, index: true },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, required: true, trim: true, maxlength: 3000 },
    status: { type: String, enum: ["open", "resolved"], default: "open", index: true },
    previousBookingStatus: { type: String, required: true },
    resolution: {
      outcome: { type: String, enum: ["provider_favor", "customer_refund", "partial_refund"], default: undefined },
      refundBps: { type: Number, min: 0, max: 10000, default: null },
      notes: { type: String, trim: true, maxlength: 3000, default: "" },
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      resolvedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Dispute || mongoose.model("Dispute", disputeSchema);
