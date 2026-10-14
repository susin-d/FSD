const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    action: { type: String, required: true, trim: true, maxlength: 120 },
    resourceType: { type: String, required: true, trim: true, maxlength: 80 },
    resourceId: { type: String, trim: true, maxlength: 100 },
    idempotencyKey: { type: String, trim: true, maxlength: 200, default: undefined },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, maxlength: 100 },
    userAgent: { type: String, maxlength: 500 },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
module.exports = mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
