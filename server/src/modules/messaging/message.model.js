const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, required: true, trim: true, maxlength: 4000 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ booking: 1, createdAt: 1 });
module.exports = mongoose.models.Message || mongoose.model("Message", messageSchema);
