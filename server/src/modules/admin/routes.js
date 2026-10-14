const express = require("express");
const { requireAuth, requireRole } = require("../../middleware/auth");
const User = require("../users/user.model");
const ProviderProfile = require("../providers/provider.model");
const Service = require("../services/service.model");
const Booking = require("../bookings/booking.model");
const Review = require("../reviews/review.model");
const Payment = require("../payments/payment.model");
const Dispute = require("../disputes/dispute.model");
const AuditLog = require("./audit-log.model");
const { asyncHandler, ensure, isObjectId, recordAudit, sendEmail } = require("../../utils/lifecycle");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

router.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const [users, customers, providers, services, bookings, activeBookings, completedBookings, reviews, payments, openDisputes, refundedPayments] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "customer" }),
      ProviderProfile.countDocuments(),
      Service.countDocuments({ isActive: true }),
      Booking.countDocuments(),
      Booking.countDocuments({ status: { $in: ["requested", "accepted", "awaiting_payment", "confirmed", "completion_pending"] } }),
      Booking.countDocuments({ status: "completed" }),
      Review.countDocuments(),
      Payment.countDocuments({ status: { $in: ["paid", "partially_refunded"] } }),
      Dispute.countDocuments({ status: "open" }),
      Payment.countDocuments({ status: "refunded" }),
    ]);
    res.json({ success: true, data: { users, customers, providers, services, bookings, activeBookings, completedBookings, reviews, payments, openDisputes, refundedPayments } });
  })
);

router.get(
  "/providers",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.status) filter.verificationStatus = req.query.status;
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const [providers, total] = await Promise.all([
      ProviderProfile.find(filter)
        .select("businessName bio categories servicePincodes verificationStatus kycProvider createdAt updatedAt user +kycReference +razorpayAccountId")
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate("user", "name email role isActive").lean(),
      ProviderProfile.countDocuments(filter),
    ]);
    const publicProviders = providers.map(({ razorpayAccountId, kycReference, ...provider }) => ({
      ...provider,
      razorpayAccountConfigured: Boolean(razorpayAccountId),
      hasKycReference: Boolean(kycReference),
    }));
    res.json({ success: true, data: { providers: publicProviders, page, limit, total } });
  })
);

router.patch(
  "/providers/:providerId/verification",
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.providerId), 400, "Invalid provider ID", "INVALID_PROVIDER_ID");
    const { status, reason = "" } = req.body || {};
    ensure(["verified", "rejected"].includes(status), 400, "status must be verified or rejected", "INVALID_VERIFICATION_STATUS");
    ensure(typeof reason === "string" && reason.length <= 500, 400, "reason cannot exceed 500 characters", "INVALID_VERIFICATION_REASON");
    if (status === "rejected") {
      ensure(reason.trim().length >= 10, 400, "A rejection reason of 10 to 500 characters is required", "INVALID_VERIFICATION_REASON");
    }

    const provider = await ProviderProfile.findById(req.params.providerId).select("verificationStatus kycProvider user +kycReference");
    ensure(provider, 404, "Provider not found", "PROVIDER_NOT_FOUND");
    ensure(provider.verificationStatus !== "verified", 409, "Provider is already verified", "PROVIDER_ALREADY_VERIFIED");
    ensure(provider.kycProvider && provider.kycReference, 409, "An existing external KYC provider reference is required before recording a review", "KYC_REFERENCE_REQUIRED");
    if (status === "verified") {
      const kycProvider = String(provider.kycProvider).trim().toLowerCase();
      ensure(!["development_stub", "disabled"].includes(kycProvider), 409, "A development or disabled KYC adapter cannot approve a provider", "KYC_VENDOR_NOT_LIVE");
    }

    provider.verificationStatus = status;
    await provider.save();
    await recordAudit({
      actorId: req.user.id,
      action: `provider.verification_${status}`,
      resourceType: "provider",
      resourceId: provider._id,
      metadata: { status, kycProvider: provider.kycProvider, reason: status === "rejected" ? reason.trim() : undefined },
      req,
    });
    try {
      const providerUser = await User.findById(provider.user).select("name email");
      if (providerUser?.email) {
        const approved = status === "verified";
        await sendEmail({
          to: providerUser.email,
          subject: approved ? "Nearby provider profile approved" : "Nearby provider profile review update",
          text: approved
            ? `Hello ${providerUser.name || ""}, your Nearby provider profile has been approved and your active listings can be shown to customers.`
            : `Hello ${providerUser.name || ""}, your Nearby provider profile was not approved. Reason: ${reason.trim()}`,
        });
      }
    } catch (error) {
      console.error("Provider verification notification email failed:", error.message);
    }
    res.json({ success: true, data: { providerId: String(provider._id), verificationStatus: provider.verificationStatus } });
  })
);

router.get(
  "/disputes",
  asyncHandler(async (req, res) => {
    const filter = { status: req.query.status === "resolved" ? "resolved" : "open" };
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const disputes = await Dispute.find(filter).sort({ createdAt: 1 }).limit(limit)
      .populate("openedBy", "name email")
      .populate({ path: "booking", select: "status scheduledAt servicePincode serviceAddress customer provider service", populate: [{ path: "customer", select: "name email" }, { path: "provider", select: "businessName" }, { path: "service", select: "title" }] })
      .lean();
    res.json({ success: true, data: { disputes } });
  })
);

router.get(
  "/audit",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.action) filter.action = String(req.query.action).slice(0, 120);
    if (req.query.resourceType) filter.resourceType = String(req.query.resourceType).slice(0, 80);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("actor", "name email role").lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ success: true, data: { audit: logs, page, limit, total } });
  })
);

router.patch(
  "/providers/:providerId/route-account",
  asyncHandler(async (req, res) => {
    ensure(isObjectId(req.params.providerId), 400, "Invalid provider ID", "INVALID_PROVIDER_ID");
    const accountId = req.body?.razorpayAccountId;
    ensure(accountId === null || (typeof accountId === "string" && /^acc_[A-Za-z0-9]+$/.test(accountId)), 400, "razorpayAccountId must be a Razorpay linked-account ID or null", "INVALID_ROUTE_ACCOUNT");
    const provider = await ProviderProfile.findById(req.params.providerId).select("+razorpayAccountId");
    ensure(provider, 404, "Provider not found", "PROVIDER_NOT_FOUND");
    if (accountId) {
      const alreadyAssigned = await ProviderProfile.findOne({ _id: { $ne: provider._id }, razorpayAccountId: accountId }).select("_id");
      ensure(!alreadyAssigned, 409, "This linked account is already assigned to another provider", "ROUTE_ACCOUNT_IN_USE");
    }
    const previousConfigured = Boolean(provider.razorpayAccountId);
    provider.razorpayAccountId = accountId;
    await provider.save();
    await recordAudit({ actorId: req.user.id, action: "provider.route_account_updated", resourceType: "provider", resourceId: provider._id, metadata: { configured: Boolean(accountId), previousConfigured }, req });
    res.json({ success: true, data: { providerId: String(provider._id), razorpayAccountConfigured: Boolean(accountId) } });
  })
);

module.exports = router;
