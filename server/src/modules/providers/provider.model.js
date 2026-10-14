const mongoose = require("mongoose");

const pincodeArrayValidator = {
  validator(value) {
    return Array.isArray(value)
      && value.length >= 1
      && value.length <= 100
      && value.every((item) => /^\d{6}$/.test(item))
      && new Set(value).size === value.length;
  },
  message: "Service pincodes must be unique six-digit Indian pincodes.",
};

const providerProfileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  businessName: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  bio: { type: String, trim: true, maxlength: 2000, default: "" },
  categories: {
    type: [{ type: String, trim: true, minlength: 1, maxlength: 80 }],
    required: true,
    validate: {
      validator(value) { return Array.isArray(value) && value.length > 0 && value.length <= 30; },
      message: "Add at least one service category.",
    },
  },
  servicePincodes: { type: [String], required: true, validate: pincodeArrayValidator },
  verificationStatus: {
    type: String,
    enum: ["pending", "in_review", "verified", "rejected"],
    required: true,
    default: "pending",
    index: true,
  },
  kycProvider: { type: String, trim: true, maxlength: 80, default: null },
  kycReference: { type: String, trim: true, maxlength: 255, default: null, select: false },
  razorpayAccountId: { type: String, trim: true, maxlength: 100, default: null, select: false },
}, { timestamps: true, versionKey: false });

providerProfileSchema.index({ verificationStatus: 1, servicePincodes: 1 });

module.exports = mongoose.models.ProviderProfile || mongoose.model("ProviderProfile", providerProfileSchema);
