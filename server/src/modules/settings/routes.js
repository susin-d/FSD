const express = require("express");
const { requireAuth, requireRole } = require("../../middleware/auth");
const MarketplaceSettings = require("./marketplace-settings.model");
const { asyncHandler, ensure, recordAudit } = require("../../utils/lifecycle");

const router = express.Router();
const CANCELLATION_FIELDS = [
  "customerEarlyWindowHours",
  "customerEarlyRefundBps",
  "customerLateRefundBps",
  "providerCancelRefundBps",
];

async function getSettings() {
  let settings = await MarketplaceSettings.findOne({ key: "marketplace" });
  if (!settings) {
    try {
      settings = await MarketplaceSettings.create({ key: "marketplace" });
    } catch (error) {
      if (error.code !== 11000) throw error;
      settings = await MarketplaceSettings.findOne({ key: "marketplace" });
    }
  }
  return settings;
}

function normalize(settings) {
  return {
    commissionBps: settings.commissionBps,
    checkoutTimeoutMinutes: settings.checkoutTimeoutMinutes,
    completionReviewHours: settings.completionReviewHours,
    cancellationPolicy: {
      customerEarlyWindowHours: settings.cancellationPolicy?.customerEarlyWindowHours ?? null,
      customerEarlyRefundBps: settings.cancellationPolicy?.customerEarlyRefundBps ?? null,
      customerLateRefundBps: settings.cancellationPolicy?.customerLateRefundBps ?? null,
      providerCancelRefundBps: settings.cancellationPolicy?.providerCancelRefundBps ?? null,
    },
    razorpayRouteEnabled: settings.razorpayRouteEnabled === true,
    updatedAt: settings.updatedAt,
  };
}

router.get(
  "/public",
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    res.json({ success: true, data: { settings: normalize(settings), checkoutEnabled: isCheckoutConfigured(settings) } });
  })
);

router.get(
  "/admin",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    res.json({ success: true, data: { settings: normalize(settings) } });
  })
);

router.patch(
  "/admin",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const allowed = new Set(["commissionBps", "checkoutTimeoutMinutes", "completionReviewHours", "cancellationPolicy", "razorpayRouteEnabled"]);
    ensure(Object.keys(body).length > 0 && Object.keys(body).every((key) => allowed.has(key)), 400, "Settings update contains unsupported fields", "INVALID_SETTINGS");
    const settings = await getSettings();

    if (Object.hasOwn(body, "commissionBps")) {
      ensure(body.commissionBps === null || (Number.isInteger(body.commissionBps) && body.commissionBps >= 0 && body.commissionBps <= 5000), 400, "commissionBps must be 0 to 5000, or null to clear", "INVALID_COMMISSION");
      settings.commissionBps = body.commissionBps;
    }
    if (Object.hasOwn(body, "checkoutTimeoutMinutes")) {
      ensure(body.checkoutTimeoutMinutes === null || (Number.isInteger(body.checkoutTimeoutMinutes) && body.checkoutTimeoutMinutes >= 1 && body.checkoutTimeoutMinutes <= 120), 400, "checkoutTimeoutMinutes must be 1 to 120, or null to clear", "INVALID_CHECKOUT_TIMEOUT");
      settings.checkoutTimeoutMinutes = body.checkoutTimeoutMinutes;
    }
    if (Object.hasOwn(body, "completionReviewHours")) {
      ensure(body.completionReviewHours === null || (Number.isInteger(body.completionReviewHours) && body.completionReviewHours >= 1 && body.completionReviewHours <= 720), 400, "completionReviewHours must be 1 to 720, or null to clear", "INVALID_REVIEW_PERIOD");
      settings.completionReviewHours = body.completionReviewHours;
    }
    if (Object.hasOwn(body, "cancellationPolicy")) {
      const patch = body.cancellationPolicy;
      ensure(patch && typeof patch === "object" && !Array.isArray(patch), 400, "cancellationPolicy must be an object", "INVALID_CANCELLATION_POLICY");
      ensure(Object.keys(patch).every((key) => CANCELLATION_FIELDS.includes(key)), 400, "cancellationPolicy contains unsupported fields", "INVALID_CANCELLATION_POLICY");
      for (const field of Object.keys(patch)) {
        const value = patch[field];
        const isBps = field.endsWith("RefundBps");
        const max = isBps ? 10_000 : 8760;
        ensure(value === null || (Number.isInteger(value) && value >= 0 && value <= max), 400, `${field} is outside the allowed range`, "INVALID_CANCELLATION_POLICY");
        settings.cancellationPolicy[field] = value;
      }
    }
    if (Object.hasOwn(body, "razorpayRouteEnabled")) {
      ensure(typeof body.razorpayRouteEnabled === "boolean", 400, "razorpayRouteEnabled must be a boolean", "INVALID_ROUTE_SETTING");
      if (body.razorpayRouteEnabled) {
        ensure(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET, 503, "Razorpay keys and webhook secret must be configured before enabling Route", "PAYMENTS_NOT_CONFIGURED");
      }
      settings.razorpayRouteEnabled = body.razorpayRouteEnabled;
    }

    settings.updatedBy = req.user.id;
    await settings.save();
    await recordAudit({ actorId: req.user.id, action: "marketplace.settings_updated", resourceType: "settings", resourceId: settings._id, metadata: { keys: Object.keys(body) }, req });
    res.json({ success: true, data: { settings: normalize(settings), checkoutEnabled: isCheckoutConfigured(settings) } });
  })
);

function isCheckoutConfigured(settings) {
  const policy = settings.cancellationPolicy || {};
  return Number.isInteger(settings.commissionBps) &&
    Number.isInteger(settings.checkoutTimeoutMinutes) &&
    Number.isInteger(settings.completionReviewHours) &&
    CANCELLATION_FIELDS.every((field) => Number.isInteger(policy[field])) &&
    settings.razorpayRouteEnabled === true &&
    Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET);
}

module.exports = router;
