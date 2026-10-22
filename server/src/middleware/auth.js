const jwt = require("jsonwebtoken");
const User = require("../modules/users/user.model");
const { sendError } = require("../utils/http");

function jwtSecret() {
  return process.env.JWT_SECRET;
}

async function requireAuth(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return sendError(res, 401, "UNAUTHENTICATED", "A bearer access token is required.");
  }

  const secret = jwtSecret();
  if (!secret || secret.length < 32) {
    return sendError(res, 503, "AUTH_NOT_CONFIGURED", "Authentication is not configured on this server.");
  }

  let claims;
  try {
    claims = jwt.verify(match[1], secret, { algorithms: ["HS256"] });
  } catch (_error) {
    return sendError(res, 401, "INVALID_TOKEN", "The access token is invalid or expired.");
  }

  if (!claims || typeof claims.sub !== "string" || !/^[a-f0-9]{24}$/i.test(claims.sub)
    || !["customer", "provider", "admin"].includes(claims.role)) {
    return sendError(res, 401, "INVALID_TOKEN", "The access token is invalid or expired.");
  }

  try {
    const user = await User.findById(claims.sub).select("name email phone countryCode role isActive tokenVersion").lean();
    const tokenVersion = Number.isSafeInteger(user?.tokenVersion) ? user.tokenVersion : 0;
    if (!user || !user.isActive || user.role !== claims.role) {
      return sendError(res, 401, "ACCOUNT_UNAVAILABLE", "This account is unavailable.");
    }
    if ((claims.ver ?? 0) !== tokenVersion) {
      return sendError(res, 401, "INVALID_TOKEN", "The access token is invalid or expired.");
    }

    req.user = { id: String(user._id), role: user.role, email: user.email };
    return next();
  } catch (error) {
    console.error("Authentication lookup failed:", error.message);
    return sendError(res, 500, "AUTH_LOOKUP_FAILED", "Unable to validate the account.");
  }
}

function requireRole(roleOrRoles) {
  const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
  return (req, res, next) => {
    if (!req.user) return sendError(res, 401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!roles.includes(req.user.role)) return sendError(res, 403, "FORBIDDEN", "You do not have access to this action.");
    return next();
  };
}

module.exports = { requireAuth, requireRole };
