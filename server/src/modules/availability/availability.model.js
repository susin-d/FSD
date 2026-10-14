const mongoose = require("mongoose");

const slotSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
  },
  { _id: true }
);

const availabilitySchema = new mongoose.Schema(
  {
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "ProviderProfile", required: true, unique: true, index: true },
    slots: { type: [slotSchema], default: [] },
  },
  { timestamps: true }
);

availabilitySchema.index({ provider: 1, "slots.date": 1 });
module.exports = mongoose.models.Availability || mongoose.model("Availability", availabilitySchema);
