const mongoose = require("mongoose");

const webhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    event: { type: String, required: true },
    status: { type: String, enum: ["processing", "processed", "failed"], default: "processing", index: true },
    leaseUntil: { type: Date, default: null },
    attempts: { type: Number, default: 1 },
    error: { type: String, maxlength: 1000, default: "" },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.PaymentWebhookEvent || mongoose.model("PaymentWebhookEvent", webhookEventSchema);
