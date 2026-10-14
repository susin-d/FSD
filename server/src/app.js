const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");
const mongoose = require("mongoose");

const authRoutes = require("./modules/auth/routes");
const userRoutes = require("./modules/users/routes");
const providerRoutes = require("./modules/providers/routes");
const serviceRoutes = require("./modules/services/routes");
const bookingRoutes = require("./modules/bookings/routes");
const availabilityRoutes = require("./modules/availability/routes");
const paymentRoutes = require("./modules/payments/routes");
const reviewRoutes = require("./modules/reviews/routes");
const messageRoutes = require("./modules/messaging/routes");
const disputeRoutes = require("./modules/disputes/routes");
const adminRoutes = require("./modules/admin/routes");
const settingsRoutes = require("./modules/settings/routes");

const API_PREFIX = "/api/v1";

function allowedOrigins() {
  const configured = process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || "http://localhost:5173";
  return configured.split(",").map((origin) => origin.trim()).filter(Boolean);
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins().includes(origin)) return callback(null, true);
    return callback(Object.assign(new Error("Origin is not allowed by CORS."), {
      statusCode: 403,
      code: "CORS_ORIGIN_DENIED",
    }));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Razorpay-Signature"],
};

const app = express();
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(helmet());
app.use(cors(corsOptions));

// Razorpay signatures are calculated from the exact request bytes.
app.use(`${API_PREFIX}/payments/webhook`, express.raw({ type: "application/json", limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Too many authentication attempts. Try again later." } },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly." } },
});
app.use(API_PREFIX, apiLimiter);
app.use(`${API_PREFIX}/auth/login`, authLimiter);
app.use(`${API_PREFIX}/auth/register`, authLimiter);

app.get("/", (_req, res) => {
  res.json({ name: "Nearby API", version: "1.0.0", status: "running" });
});

app.get("/health", async (_req, res) => {
  const connected = mongoose.connection.readyState === 1;
  let database = "disconnected";
  if (connected) {
    try {
      await mongoose.connection.db.admin().ping();
      database = "connected";
    } catch {
      database = "unhealthy";
    }
  }
  const healthy = database === "connected";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "unhealthy",
    database,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/users`, userRoutes);
app.use(`${API_PREFIX}/providers`, providerRoutes);
app.use(`${API_PREFIX}/services`, serviceRoutes);
app.use(`${API_PREFIX}/bookings`, bookingRoutes);
app.use(`${API_PREFIX}/availability`, availabilityRoutes);
app.use(`${API_PREFIX}/payments`, paymentRoutes);
app.use(`${API_PREFIX}/reviews`, reviewRoutes);
app.use(`${API_PREFIX}/messages`, messageRoutes);
app.use(`${API_PREFIX}/disputes`, disputeRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/settings`, settingsRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route not found." } });
});

app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  const status = Number.isInteger(err.statusCode)
    ? err.statusCode
    : Number.isInteger(err.status)
      ? err.status
      : 500;
  const code = err.code || (status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
  const message = status === 500 && process.env.NODE_ENV === "production"
    ? "An unexpected error occurred."
    : err.message || "An unexpected error occurred.";
  if (status >= 500) console.error("Request failed:", err);
  res.status(status).json({ success: false, error: { code, message } });
});

module.exports = { app, allowedOrigins };
