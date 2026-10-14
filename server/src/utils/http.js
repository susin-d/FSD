function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function sendError(res, status, code, message) {
  return res.status(status).json({
    success: false,
    error: { code, message },
  });
}

function handleRouteError(res, error) {
  if (error && error.code === 11000) {
    return sendError(res, 409, "CONFLICT", "A record with these details already exists.");
  }

  if (error && error.name === "ValidationError") {
    const firstMessage = Object.values(error.errors || {})[0]?.message;
    return sendError(res, 400, "VALIDATION_ERROR", firstMessage || "The submitted data is invalid.");
  }

  if (error && error.name === "CastError") {
    return sendError(res, 400, "INVALID_ID", "The requested identifier is invalid.");
  }

  if (error && error.status && error.code) {
    return sendError(res, error.status, error.code, error.message);
  }

  console.error("Request failed:", error && error.message ? error.message : error);
  return sendError(res, 500, "INTERNAL_ERROR", "An unexpected error occurred.");
}

module.exports = { sendSuccess, sendError, handleRouteError };
