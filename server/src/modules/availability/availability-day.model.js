const mongoose = require("mongoose");

const reservationSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    state: { type: String, enum: ["held", "confirmed", "completed", "expired", "cancelled"], required: true },
    expiresAt: { type: Date, default: null },
  },
  { _id: false }
);

const availabilityDaySchema = new mongoose.Schema(
  {
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "ProviderProfile", required: true },
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    reservations: { type: [reservationSchema], default: [] },
  },
  { timestamps: true }
);

availabilityDaySchema.index({ provider: 1, dateKey: 1 }, { unique: true });
availabilityDaySchema.index({ "reservations.booking": 1 });
module.exports = mongoose.models.AvailabilityDay || mongoose.model("AvailabilityDay", availabilityDaySchema);
