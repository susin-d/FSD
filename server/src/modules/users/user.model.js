const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  phone: { type: String, trim: true, match: /^\d{7,15}$/ },
  countryCode: { type: String, trim: true, match: /^\+\d{1,3}$/ },
  passwordHash: { type: String, required: true, select: false },
  tokenVersion: { type: Number, required: true, default: 0, min: 0 },
  passwordResetCodeHash: { type: String, select: false, default: undefined },
  passwordResetExpiresAt: { type: Date, select: false, default: undefined },
  passwordResetAttempts: { type: Number, select: false, default: 0, min: 0, max: 5 },
  role: { type: String, enum: ["customer", "provider", "admin"], required: true, default: "customer" },
  isActive: { type: Boolean, default: true, required: true },
}, { timestamps: true, versionKey: false });

userSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
