const mongoose = require("mongoose");

const cancellationSchema = new mongoose.Schema(
  {
    customerEarlyWindowHours: { type: Number, default: null, min: 0, max: 8760 },
    customerEarlyRefundBps: { type: Number, default: null, min: 0, max: 10000 },
    customerLateRefundBps: { type: Number, default: null, min: 0, max: 10000 },
    providerCancelRefundBps: { type: Number, default: null, min: 0, max: 10000 },
  },
  { _id: false }
);

const marketplaceSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "marketplace", unique: true },
    commissionBps: { type: Number, default: null, min: 0, max: 5000 },
    checkoutTimeoutMinutes: { type: Number, default: null, min: 1, max: 120 },
    completionReviewHours: { type: Number, default: null, min: 1, max: 720 },
    cancellationPolicy: { type: cancellationSchema, default: () => ({}) },
    razorpayRouteEnabled: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.MarketplaceSettings || mongoose.model("MarketplaceSettings", marketplaceSettingsSchema);
