const express = require("express");
const mongoose = require("mongoose");
const ProviderProfile = require("./provider.model");
const User = require("../users/user.model");
const { getKycAdapter } = require("./kyc-adapter");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { handleRouteError, sendError, sendSuccess } = require("../../utils/http");
const { isText, rejectUnknownFields, validatePincodes, validateStringArray } = require("../../utils/validation");

const router = express.Router();
const providerOnly = [requireAuth, requireRole("provider")];

function profileInputError(body) {
  const unknownFieldError = rejectUnknownFields(body, ["businessName", "bio", "categories", "servicePincodes"]);
  if (unknownFieldError) return unknownFieldError;
  if (!isText(body.businessName, { min: 1, max: 120 })) return "Business name must contain 1 to 120 characters.";
  if (body.bio !== undefined && !isText(body.bio, { min: 0, max: 2000 })) return "Bio must be 2,000 characters or fewer.";
  if (!validateStringArray(body.categories, { min: 1, max: 30, itemMax: 80 })) return "Add between 1 and 30 valid service categories.";
  if (!validatePincodes(body.servicePincodes, { min: 1, max: 100 })) return "Add unique six-digit service pincodes.";
  return null;
}

function publicProfile(profile) {
  const user = profile.user && typeof profile.user === "object" ? profile.user : null;
  return {
    id: String(profile._id),
    name: user ? user.name : undefined,
    businessName: profile.businessName,
    bio: profile.bio,
    categories: profile.categories,
    servicePincodes: profile.servicePincodes,
    verificationStatus: profile.verificationStatus,
    createdAt: profile.createdAt,
  };
}

router.get("/me", ...providerOnly, async (req, res) => {
  try {
    const profile = await ProviderProfile.findOne({ user: req.user.id }).lean();
    if (!profile) return sendError(res, 404, "PROFILE_NOT_FOUND", "Create a provider profile first.");
    return sendSuccess(res, profile);
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post("/me", ...providerOnly, async (req, res) => {
  const inputError = profileInputError(req.body);
  if (inputError) return sendError(res, 400, "VALIDATION_ERROR", inputError);

  try {
    const alreadyExists = await ProviderProfile.exists({ user: req.user.id });
    const profile = await ProviderProfile.findOneAndUpdate(
      { user: req.user.id },
      {
        $set: {
          businessName: req.body.businessName.trim(),
          bio: req.body.bio === undefined ? "" : req.body.bio.trim(),
          categories: req.body.categories.map((item) => item.trim()),
          servicePincodes: req.body.servicePincodes,
        },
        $setOnInsert: { user: req.user.id, verificationStatus: "pending" },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    return sendSuccess(res, {
      id: String(profile._id),
      user: String(profile.user),
      businessName: profile.businessName,
      bio: profile.bio,
      categories: profile.categories,
      servicePincodes: profile.servicePincodes,
      verificationStatus: profile.verificationStatus,
    }, alreadyExists ? 200 : 201);
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post("/me/verification", ...providerOnly, async (req, res) => {
  const verificationRequest = req.body === undefined ? {} : req.body;
  const unknownFieldError = rejectUnknownFields(verificationRequest, []);
  if (unknownFieldError) {
    return sendError(res, 400, "VALIDATION_ERROR", "KYC documents must be submitted directly to the verification provider.");
  }

  try {
    const profile = await ProviderProfile.findOne({ user: req.user.id });
    if (!profile) return sendError(res, 404, "PROFILE_NOT_FOUND", "Create a provider profile before starting verification.");

    if (profile.verificationStatus === "verified") {
      return sendSuccess(res, { status: profile.verificationStatus, provider: profile.kycProvider || null });
    }
    if (profile.kycReference && ["pending", "in_review"].includes(profile.verificationStatus)) {
      return sendSuccess(res, { status: profile.verificationStatus, provider: profile.kycProvider || null });
    }

    const adapter = getKycAdapter();
    const session = await adapter.startVerification({ userId: req.user.id, profileId: String(profile._id) });
    if (!session || !session.reference || !["pending", "in_review"].includes(session.status)) {
      return sendError(res, 502, "KYC_PROVIDER_ERROR", "The verification provider returned an invalid response.");
    }

    profile.kycProvider = session.provider;
    profile.kycReference = session.reference;
    profile.verificationStatus = session.status;
    await profile.save();

    return sendSuccess(res, {
      status: profile.verificationStatus,
      provider: profile.kycProvider,
      redirectUrl: session.redirectUrl || null,
      message: session.provider === "development_stub"
        ? "Development verification is a stub and cannot mark this profile as verified."
        : undefined,
    }, 202);
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.get("/me/verification", ...providerOnly, async (req, res) => {
  try {
    const profile = await ProviderProfile.findOne({ user: req.user.id }).select("verificationStatus kycProvider").lean();
    if (!profile) return sendError(res, 404, "PROFILE_NOT_FOUND", "Create a provider profile first.");
    return sendSuccess(res, { status: profile.verificationStatus, provider: profile.kycProvider || null });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 404, "PROVIDER_NOT_FOUND", "Provider profile not found.");
  try {
    const profile = await ProviderProfile.findOne({ _id: req.params.id, verificationStatus: "verified" })
      .populate({ path: "user", select: "name" })
      .lean();
    if (!profile) return sendError(res, 404, "PROVIDER_NOT_FOUND", "Provider profile not found.");
    return sendSuccess(res, publicProfile(profile));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

module.exports = router;
