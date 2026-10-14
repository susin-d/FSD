const express = require("express");
const User = require("./user.model");
const { requireAuth } = require("../../middleware/auth");
const { handleRouteError, sendError, sendSuccess } = require("../../utils/http");

const router = express.Router();

router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("name email role isActive createdAt").lean();
    if (!user || !user.isActive) {
      return sendError(res, 404, "USER_NOT_FOUND", "The account could not be found.");
    }

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
