const jwt = require("jsonwebtoken");

function createAccessToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    const error = new Error("JWT_SECRET must be configured with at least 32 characters.");
    error.status = 503;
    error.code = "AUTH_NOT_CONFIGURED";
    throw error;
  }

  return jwt.sign(
    { role: user.role, email: user.email, ver: Number.isSafeInteger(user.tokenVersion) ? user.tokenVersion : 0 },
    secret,
    { algorithm: "HS256", subject: String(user._id), expiresIn: process.env.JWT_EXPIRES_IN || "1d" },
  );
}

module.exports = { createAccessToken };
