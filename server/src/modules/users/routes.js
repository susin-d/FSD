const express = require("express");
const User = require("./user.model");
const { requireAuth } = require("../../middleware/auth");
const { handleRouteError, sendError, sendSuccess } = require("../../utils/http");
const { isText, rejectUnknownFields } = require("../../utils/validation");

const router = express.Router();

router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("name email phone countryCode role isActive createdAt").lean();
    if (!user || !user.isActive) {
      return sendError(res, 404, "USER_NOT_FOUND", "The account could not be found.");
    }

    return sendSuccess(res, {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      countryCode: user.countryCode || "+91",
      role: user.role,
      createdAt: user.createdAt,
    });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.patch("/me", requireAuth, async (req, res) => {
  const unknownFieldError = rejectUnknownFields(req.body, ["name", "phone", "countryCode"]);
  if (unknownFieldError) return sendError(res, 400, "VALIDATION_ERROR", unknownFieldError);
  if (Object.keys(req.body).length === 0) return sendError(res, 400, "VALIDATION_ERROR", "Provide at least one profile field to update.");
  if (req.body.name !== undefined && !isText(req.body.name, { min: 1, max: 100 })) {
    return sendError(res, 400, "VALIDATION_ERROR", "Name must contain 1 to 100 characters.");
  }

  const hasPhone = Object.prototype.hasOwnProperty.call(req.body, "phone");
  const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : req.body.phone;
  if (hasPhone && phone !== "" && (typeof phone !== "string" || !/^\d{7,15}$/.test(phone))) {
    return sendError(res, 400, "VALIDATION_ERROR", "Enter a valid phone number with 7 to 15 digits.");
  }
  if (req.body.countryCode !== undefined && !hasPhone) {
    return sendError(res, 400, "VALIDATION_ERROR", "A country code can only be updated with a phone number.");
  }
  if (hasPhone && phone !== "" && (typeof req.body.countryCode !== "string" || !/^\+\d{1,3}$/.test(req.body.countryCode))) {
    return sendError(res, 400, "VALIDATION_ERROR", "Choose a valid country code.");
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.isActive) return sendError(res, 404, "USER_NOT_FOUND", "The account could not be found.");

    if (req.body.name !== undefined) user.name = req.body.name.trim();
    if (hasPhone) {
      if (phone === "") {
        user.phone = undefined;
        user.countryCode = undefined;
      } else {
        user.phone = phone;
        user.countryCode = req.body.countryCode;
      }
    }

    await user.save();
    return sendSuccess(res, {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      countryCode: user.countryCode || "+91",
      role: user.role,
      createdAt: user.createdAt,
    });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

module.exports = router;
