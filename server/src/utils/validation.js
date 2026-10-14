const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PINCODE_PATTERN = /^\d{6}$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value, { min = 1, max = 200 } = {}) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

function isEmail(value) {
  return typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value.trim());
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function validateStringArray(value, { min = 1, max = 30, itemMax = 80 } = {}) {
  return Array.isArray(value)
    && value.length >= min
    && value.length <= max
    && value.every((item) => isText(item, { min: 1, max: itemMax }));
}

function validatePincodes(value, { min = 1, max = 100 } = {}) {
  return Array.isArray(value)
    && value.length >= min
    && value.length <= max
    && value.every((item) => typeof item === "string" && PINCODE_PATTERN.test(item))
    && new Set(value).size === value.length;
}

function rejectUnknownFields(body, allowedFields) {
  if (!isPlainObject(body)) return "Request body must be a JSON object.";
  const unknown = Object.keys(body).filter((key) => !allowedFields.includes(key));
  return unknown.length ? `Unsupported field: ${unknown[0]}.` : null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  PINCODE_PATTERN,
  escapeRegex,
  isEmail,
  isPlainObject,
  isText,
  normalizeEmail,
  rejectUnknownFields,
  validatePincodes,
  validateStringArray,
};
