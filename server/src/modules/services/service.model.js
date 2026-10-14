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

const serviceSchema = new mongoose.Schema({
  provider: { type: mongoose.Schema.Types.ObjectId, ref: "ProviderProfile", required: true, index: true },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
  description: { type: String, required: true, trim: true, minlength: 10, maxlength: 4000 },
  category: { type: String, required: true, trim: true, minlength: 1, maxlength: 80, index: true },
  pricePaise: { type: Number, required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
  durationMinutes: { type: Number, required: true, min: 1, max: 1440 },
  servicePincodes: { type: [String], required: true, validate: pincodeArrayValidator },
  isActive: { type: Boolean, required: true, default: true, index: true },
}, { timestamps: true, versionKey: false });

serviceSchema.index({ isActive: 1, servicePincodes: 1, category: 1, createdAt: -1 });
serviceSchema.index({ provider: 1, isActive: 1 });

module.exports = mongoose.models.Service || mongoose.model("Service", serviceSchema);
