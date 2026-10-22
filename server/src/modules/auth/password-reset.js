const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const User = require("../users/user.model");
const { sendEmail } = require("../../utils/lifecycle");

const PASSWORD_RESET_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_REQUEST_MESSAGE = "If an account exists for this email, a reset code will be sent.";
const PASSWORD_RESET_FIELDS = {
  passwordResetCodeHash: 1,
  passwordResetExpiresAt: 1,
  passwordResetAttempts: 1,
};

function hasPasswordResetSecret(secret = process.env.JWT_SECRET) {
  return typeof secret === "string" && secret.length >= 32;
}

function hashPasswordResetCode(code, secret = process.env.JWT_SECRET) {
  if (!hasPasswordResetSecret(secret)) return null;
  return crypto.createHmac("sha256", secret).update(String(code)).digest("hex");
}

function createPasswordResetCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function isValidPassword(password) {
  return typeof password === "string"
    && password.length >= 8
    && Buffer.byteLength(password, "utf8") <= 72;
}

function querySelect(query, fields) {
  return query && typeof query.select === "function" ? query.select(fields) : query;
}

function matchesResetCode(inputCode, storedHash, secret) {
  if (typeof inputCode !== "string" || typeof storedHash !== "string" || !/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  const candidateHash = Buffer.from(hashPasswordResetCode(inputCode, secret), "hex");
  const expectedHash = Buffer.from(storedHash, "hex");
  return candidateHash.length === expectedHash.length && crypto.timingSafeEqual(candidateHash, expectedHash);
}

async function clearPasswordReset(UserModel, userId, codeHash) {
  await UserModel.updateOne(
    { _id: userId, passwordResetCodeHash: codeHash },
    { $unset: PASSWORD_RESET_FIELDS },
  );
}

async function requestPasswordReset(email, options = {}) {
  const {
    UserModel = User,
    sendEmailFn = sendEmail,
    secret = process.env.JWT_SECRET,
    now = Date.now,
    generateCode = createPasswordResetCode,
  } = options;

  if (!hasPasswordResetSecret(secret)) return PASSWORD_RESET_REQUEST_MESSAGE;

  const user = await querySelect(UserModel.findOne({ email, isActive: true }), "name email");
  if (!user) return PASSWORD_RESET_REQUEST_MESSAGE;

  const code = generateCode();
  const codeHash = hashPasswordResetCode(code, secret);
  const nowMs = typeof now === "function" ? now() : now;
  const expiresAt = new Date(nowMs + PASSWORD_RESET_TTL_MS);
  const result = await UserModel.updateOne(
    { _id: user._id, isActive: true },
    { $set: {
      passwordResetCodeHash: codeHash,
      passwordResetExpiresAt: expiresAt,
      passwordResetAttempts: 0,
    } },
  );
  if (result?.matchedCount === 0) return PASSWORD_RESET_REQUEST_MESSAGE;

  void (async () => {
    try {
      const delivery = await sendEmailFn({
        to: user.email,
        subject: "Your Nearby password reset code",
        text: `Hello ${user.name || ""},\n\nYour Nearby password reset code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
      });
      if (!delivery?.sent) await clearPasswordReset(UserModel, user._id, codeHash);
    } catch (_error) {
      await clearPasswordReset(UserModel, user._id, codeHash).catch(() => {});
      console.error("Password reset email delivery failed.");
    }
  })();

  return PASSWORD_RESET_REQUEST_MESSAGE;
}

async function confirmPasswordReset({ email, code, password }, options = {}) {
  const {
    UserModel = User,
    secret = process.env.JWT_SECRET,
    now = Date.now,
    hashPassword = (value) => bcrypt.hash(value, 12),
  } = options;
  if (!hasPasswordResetSecret(secret)) return false;

  const user = await querySelect(
    UserModel.findOne({ email, isActive: true }),
    Object.keys(PASSWORD_RESET_FIELDS).map((field) => `+${field}`).join(" "),
  );
  if (!user || !user.passwordResetCodeHash) return false;

  const nowMs = typeof now === "function" ? now() : now;
  const expiresAt = new Date(user.passwordResetExpiresAt).getTime();
  const currentHash = user.passwordResetCodeHash;
  const attempts = Number(user.passwordResetAttempts || 0);
  const activeCode = Number.isFinite(expiresAt)
    && expiresAt > nowMs
    && attempts < PASSWORD_RESET_MAX_ATTEMPTS;
  if (!activeCode || !matchesResetCode(code, currentHash, secret)) {
    if (activeCode) {
      const attempt = await querySelect(UserModel.findOneAndUpdate(
        {
          _id: user._id,
          isActive: true,
          passwordResetCodeHash: currentHash,
          passwordResetExpiresAt: { $gt: new Date(nowMs) },
          passwordResetAttempts: { $lt: PASSWORD_RESET_MAX_ATTEMPTS },
        },
        { $inc: { passwordResetAttempts: 1 } },
        { new: true },
      ), "+passwordResetAttempts");
      if (attempt && Number(attempt.passwordResetAttempts) >= PASSWORD_RESET_MAX_ATTEMPTS) {
        await clearPasswordReset(UserModel, user._id, currentHash);
      }
    }
    return false;
  }

  const passwordHash = await hashPassword(password);
  const updated = await UserModel.findOneAndUpdate(
    {
      _id: user._id,
      isActive: true,
      passwordResetCodeHash: currentHash,
      passwordResetExpiresAt: { $gt: new Date(nowMs) },
      passwordResetAttempts: { $lt: PASSWORD_RESET_MAX_ATTEMPTS },
    },
    {
      $set: { passwordHash },
      $inc: { tokenVersion: 1 },
      $unset: PASSWORD_RESET_FIELDS,
    },
    { new: true },
  );
  if (!updated) return false;
  try {
    require("../messaging/routes").disconnectUserSockets(user._id);
  } catch (_error) {
    console.error("Could not close existing password reset sessions.");
  }
  return true;
}

module.exports = {
  PASSWORD_RESET_TTL_MS,
  PASSWORD_RESET_MAX_ATTEMPTS,
  PASSWORD_RESET_REQUEST_MESSAGE,
  hashPasswordResetCode,
  createPasswordResetCode,
  isValidPassword,
  requestPasswordReset,
  confirmPasswordReset,
};
