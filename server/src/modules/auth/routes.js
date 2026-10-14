const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../users/user.model");
const { requireAuth } = require("../../middleware/auth");
const { createAccessToken } = require("./token");
const { handleRouteError, sendError, sendSuccess } = require("../../utils/http");
const { isEmail, isText, normalizeEmail, rejectUnknownFields } = require("../../utils/validation");

const router = express.Router();

router.post("/register", async (req, res) => {
  const unknownFieldError = rejectUnknownFields(req.body, ["name", "email", "password", "role"]);
  if (unknownFieldError) return sendError(res, 400, "VALIDATION_ERROR", unknownFieldError);

  const { name, email, password, role = "customer" } = req.body;
  if (!isText(name, { min: 1, max: 100 })) {
    return sendError(res, 400, "VALIDATION_ERROR", "Name must contain 1 to 100 characters.");
  }
  if (!isEmail(email)) return sendError(res, 400, "VALIDATION_ERROR", "Enter a valid email address.");
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return sendError(res, 400, "VALIDATION_ERROR", "Password must contain at least 8 characters and at most 72 UTF-8 bytes.");
  }
  if (!role || !["customer", "provider"].includes(role)) {
    return sendError(res, 403, "ROLE_NOT_ALLOWED", "Public registration is available for customer and provider accounts only.");
  }

  try {
    const normalizedEmail = normalizeEmail(email);
    const existing = await User.exists({ email: normalizedEmail });
    if (existing) return sendError(res, 409, "EMAIL_IN_USE", "An account already exists for this email address.");

    const passwordHash = await bcrypt.hash(password, 12);
    const user = new User({ name: name.trim(), email: normalizedEmail, passwordHash, role, isActive: true });
    const token = createAccessToken(user);
    await user.save();

    return sendSuccess(res, {
      token,
      user: { id: String(user._id), name: user.name, email: user.email, role: user.role },
    }, 201);
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post("/login", async (req, res) => {
  const unknownFieldError = rejectUnknownFields(req.body, ["email", "password"]);
  if (unknownFieldError) return sendError(res, 400, "VALIDATION_ERROR", unknownFieldError);
  const { email, password } = req.body;
  if (!isEmail(email) || typeof password !== "string" || password.length === 0 || Buffer.byteLength(password, "utf8") > 72) {
    return sendError(res, 400, "VALIDATION_ERROR", "Enter a valid email and password.");
  }

  try {
    const user = await User.findOne({ email: normalizeEmail(email) }).select("+passwordHash");
    if (!user || !user.isActive) return sendError(res, 401, "INVALID_CREDENTIALS", "Email or password is incorrect.");

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) return sendError(res, 401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    const token = createAccessToken(user);

    return sendSuccess(res, {
      token,
      user: { id: String(user._id), name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("name email role createdAt").lean();
    if (!user) return sendError(res, 404, "USER_NOT_FOUND", "The account could not be found.");
    return sendSuccess(res, {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

module.exports = router;
