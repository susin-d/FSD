const express = require("express");
const mongoose = require("mongoose");
const Service = require("./service.model");
const { paiseToPrice, priceToPaise } = require("./pricing");
const ProviderProfile = require("../providers/provider.model");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { handleRouteError, sendError, sendSuccess } = require("../../utils/http");
const { escapeRegex, isText, rejectUnknownFields, validatePincodes } = require("../../utils/validation");

const router = express.Router();
const providerOnly = [requireAuth, requireRole("provider")];
const serviceFields = ["title", "description", "category", "price", "pricePaise", "durationMinutes", "servicePincodes", "isActive"];

function serviceInputError(body, { partial = false } = {}) {
  const unknownFieldError = rejectUnknownFields(body, serviceFields);
  if (unknownFieldError) return unknownFieldError;

  if (!partial || body.title !== undefined) {
    if (!isText(body.title, { min: 3, max: 120 })) return "Title must contain 3 to 120 characters.";
  }
  if (!partial || body.description !== undefined) {
    if (!isText(body.description, { min: 10, max: 4000 })) return "Description must contain 10 to 4,000 characters.";
  }
  if (!partial || body.category !== undefined) {
    if (!isText(body.category, { min: 1, max: 80 })) return "Category must contain 1 to 80 characters.";
  }
  if (body.price !== undefined && body.pricePaise !== undefined) {
    return "Provide price in INR or pricePaise, not both.";
  }
  if (!partial || body.price !== undefined || body.pricePaise !== undefined) {
    if (body.price !== undefined) {
      if (priceToPaise(body.price) === null) return "Price must be a positive INR amount with at most two decimal places.";
    } else if (!Number.isSafeInteger(body.pricePaise) || body.pricePaise < 1) {
      return "Price must be a positive integer amount in paise.";
    }
  }
  if (!partial || body.durationMinutes !== undefined) {
    if (!Number.isInteger(body.durationMinutes) || body.durationMinutes < 1 || body.durationMinutes > 1440) {
      return "Duration must be a whole number from 1 to 1,440 minutes.";
    }
  }
  if (!partial || body.servicePincodes !== undefined) {
    if (!validatePincodes(body.servicePincodes, { min: 1, max: 100 })) return "Add unique six-digit service pincodes.";
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") return "isActive must be true or false.";
  if (partial && Object.keys(body).length === 0) return "Provide at least one field to update.";
  return null;
}

function providerMatchesCategory(profile, category) {
  return profile.categories.some((item) => item.toLowerCase() === category.trim().toLowerCase());
}

function isSubset(values, allowedValues) {
  const allowed = new Set(allowedValues);
  return values.every((value) => allowed.has(value));
}

function publicService(service) {
  const profile = service.provider;
  const user = profile && profile.user && typeof profile.user === "object" ? profile.user : null;
  return {
    id: String(service._id),
    title: service.title,
    description: service.description,
    category: service.category,
    price: paiseToPrice(service.pricePaise),
    pricePaise: service.pricePaise,
    durationMinutes: service.durationMinutes,
    servicePincodes: service.servicePincodes,
    provider: profile ? {
      id: String(profile._id),
      name: user ? user.name : undefined,
      businessName: profile.businessName,
      bio: profile.bio,
      categories: profile.categories,
    } : null,
    createdAt: service.createdAt,
  };
}

function ownerService(service) {
  return {
    id: String(service._id),
    title: service.title,
    description: service.description,
    category: service.category,
    price: paiseToPrice(service.pricePaise),
    pricePaise: service.pricePaise,
    durationMinutes: service.durationMinutes,
    servicePincodes: service.servicePincodes,
    isActive: service.isActive,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

async function findVisibleService(id) {
  return Service.findOne({ _id: id, isActive: true })
    .populate({
      path: "provider",
      match: { verificationStatus: "verified" },
      select: "businessName bio categories user",
      populate: { path: "user", select: "name" },
    })
    .lean();
}

router.get("/mine", ...providerOnly, async (req, res) => {
  try {
    const profile = await ProviderProfile.findOne({ user: req.user.id }).select("_id").lean();
    if (!profile) return sendError(res, 404, "PROFILE_NOT_FOUND", "Create a provider profile first.");
    const items = await Service.find({ provider: profile._id }).sort({ createdAt: -1 }).lean();
    return sendSuccess(res, { items: items.map(ownerService) });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.get("/", async (req, res) => {
  const allowedQuery = ["category", "pincode", "q", "page", "limit"];
  const unsupported = Object.keys(req.query).find((key) => !allowedQuery.includes(key));
  if (unsupported) return sendError(res, 400, "VALIDATION_ERROR", `Unsupported search parameter: ${unsupported}.`);

  const { category, pincode, q } = req.query;
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (category !== undefined && !isText(category, { min: 1, max: 80 })) return sendError(res, 400, "VALIDATION_ERROR", "Category must contain 1 to 80 characters.");
  if (pincode !== undefined && (typeof pincode !== "string" || !/^\d{6}$/.test(pincode))) {
    return sendError(res, 400, "VALIDATION_ERROR", "Search uses one exact six-digit pincode.");
  }
  if (q !== undefined && !isText(q, { min: 1, max: 100 })) return sendError(res, 400, "VALIDATION_ERROR", "Search text must contain 1 to 100 characters.");
  if (!Number.isInteger(page) || page < 1 || page > 100000) return sendError(res, 400, "VALIDATION_ERROR", "Page must be a positive integer.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return sendError(res, 400, "VALIDATION_ERROR", "Limit must be from 1 to 100.");

  try {
    const providerFilter = { verificationStatus: "verified" };
    if (pincode !== undefined) providerFilter.servicePincodes = pincode;
    const verifiedProfiles = await ProviderProfile.find(providerFilter).select("_id").lean();
    const filter = { isActive: true, provider: { $in: verifiedProfiles.map((profile) => profile._id) } };
    if (category !== undefined) filter.category = new RegExp(`^${escapeRegex(category.trim())}$`, "i");
    if (pincode !== undefined) filter.servicePincodes = pincode;
    if (q !== undefined) {
      const escaped = escapeRegex(q.trim());
      filter.$or = [
        { title: new RegExp(escaped, "i") },
        { description: new RegExp(escaped, "i") },
      ];
    }

    const [services, total] = await Promise.all([
      Service.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({
          path: "provider",
          match: { verificationStatus: "verified" },
          select: "businessName bio categories user",
          populate: { path: "user", select: "name" },
        })
        .lean(),
      Service.countDocuments(filter),
    ]);
    const items = services.filter((service) => service.provider).map(publicService);
    return sendSuccess(res, { items, total, page, limit });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 404, "SERVICE_NOT_FOUND", "Service not found.");
  try {
    const service = await findVisibleService(req.params.id);
    if (!service || !service.provider) return sendError(res, 404, "SERVICE_NOT_FOUND", "Service not found.");
    return sendSuccess(res, publicService(service));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post("/", ...providerOnly, async (req, res) => {
  const inputError = serviceInputError(req.body);
  if (inputError) return sendError(res, 400, "VALIDATION_ERROR", inputError);

  try {
    const profile = await ProviderProfile.findOne({ user: req.user.id });
    if (!profile) return sendError(res, 409, "PROFILE_REQUIRED", "Create your provider profile before publishing services.");
    if (profile.verificationStatus !== "verified") return sendError(res, 403, "PROVIDER_UNVERIFIED", "Provider verification is required before publishing services.");
    if (!providerMatchesCategory(profile, req.body.category)) {
      return sendError(res, 400, "CATEGORY_NOT_IN_PROFILE", "Choose a category listed on your provider profile.");
    }
    if (!isSubset(req.body.servicePincodes, profile.servicePincodes)) {
      return sendError(res, 400, "PINCODE_OUTSIDE_SERVICE_AREA", "Service pincodes must be part of your provider service area.");
    }

    const service = await Service.create({
      provider: profile._id,
      title: req.body.title.trim(),
      description: req.body.description.trim(),
      category: req.body.category.trim(),
      pricePaise: req.body.price !== undefined ? priceToPaise(req.body.price) : req.body.pricePaise,
      durationMinutes: req.body.durationMinutes,
      servicePincodes: req.body.servicePincodes,
      isActive: true,
    });
    return sendSuccess(res, ownerService(service), 201);
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.patch("/:id", ...providerOnly, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 404, "SERVICE_NOT_FOUND", "Service not found.");
  const inputError = serviceInputError(req.body, { partial: true });
  if (inputError) return sendError(res, 400, "VALIDATION_ERROR", inputError);

  try {
    const profile = await ProviderProfile.findOne({ user: req.user.id });
    if (!profile) return sendError(res, 404, "PROFILE_NOT_FOUND", "Provider profile not found.");
    const service = await Service.findOne({ _id: req.params.id, provider: profile._id });
    if (!service) return sendError(res, 404, "SERVICE_NOT_FOUND", "Service not found.");

    if (req.body.isActive === true && profile.verificationStatus !== "verified") {
      return sendError(res, 403, "PROVIDER_UNVERIFIED", "Provider verification is required before publishing services.");
    }

    const nextCategory = req.body.category === undefined ? service.category : req.body.category.trim();
    const nextPincodes = req.body.servicePincodes === undefined ? service.servicePincodes : req.body.servicePincodes;
    if (!providerMatchesCategory(profile, nextCategory)) {
      return sendError(res, 400, "CATEGORY_NOT_IN_PROFILE", "Choose a category listed on your provider profile.");
    }
    if (!isSubset(nextPincodes, profile.servicePincodes)) {
      return sendError(res, 400, "PINCODE_OUTSIDE_SERVICE_AREA", "Service pincodes must be part of your provider service area.");
    }

    for (const key of ["title", "description", "category", "durationMinutes", "servicePincodes", "isActive"]) {
      if (req.body[key] !== undefined) service[key] = typeof req.body[key] === "string" ? req.body[key].trim() : req.body[key];
    }
    if (req.body.price !== undefined) service.pricePaise = priceToPaise(req.body.price);
    if (req.body.pricePaise !== undefined) service.pricePaise = req.body.pricePaise;
    await service.save();
    return sendSuccess(res, ownerService(service));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.delete("/:id", ...providerOnly, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 404, "SERVICE_NOT_FOUND", "Service not found.");
  try {
    const profile = await ProviderProfile.findOne({ user: req.user.id }).select("_id").lean();
    if (!profile) return sendError(res, 404, "PROFILE_NOT_FOUND", "Provider profile not found.");
    const service = await Service.findOneAndUpdate(
      { _id: req.params.id, provider: profile._id },
      { $set: { isActive: false } },
      { new: true },
    ).lean();
    if (!service) return sendError(res, 404, "SERVICE_NOT_FOUND", "Service not found.");
    return sendSuccess(res, { id: String(service._id), isActive: false });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

module.exports = router;
