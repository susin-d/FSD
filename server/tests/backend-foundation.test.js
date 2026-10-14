const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const authRoutes = require("../src/modules/auth/routes");
const serviceRoutes = require("../src/modules/services/routes");

const User = require("../src/modules/users/user.model");
const ProviderProfile = require("../src/modules/providers/provider.model");
const Service = require("../src/modules/services/service.model");
const { disabledAdapter, developmentAdapter, getKycAdapter } = require("../src/modules/providers/kyc-adapter");
const { requireAuth, requireRole } = require("../src/middleware/auth");
const { paiseToPrice, priceToPaise } = require("../src/modules/services/pricing");
const { escapeRegex, validatePincodes, validateStringArray } = require("../src/utils/validation");

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

async function withTestApi(run) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/services", serviceRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("marketplace models expose the shared references and keep private payment/KYC references unselected", () => {
  assert.equal(User.modelName, "User");
  assert.equal(ProviderProfile.modelName, "ProviderProfile");
  assert.equal(Service.modelName, "Service");
  assert.equal(ProviderProfile.schema.path("user").options.ref, "User");
  assert.equal(ProviderProfile.schema.path("razorpayAccountId").options.select, false);
  assert.equal(ProviderProfile.schema.path("kycReference").options.select, false);
  assert.equal(Service.schema.path("provider").options.ref, "ProviderProfile");
  assert.equal(User.schema.path("passwordHash").options.select, false);
});

test("service-area validation accepts only unique six-digit pincodes", () => {
  assert.equal(validatePincodes(["110001", "400001"]), true);
  assert.equal(validatePincodes(["110001", "110001"]), false);
  assert.equal(validatePincodes(["11001"]), false);
  assert.equal(validateStringArray(["Plumbing", "Electrical"]), true);
  assert.equal(escapeRegex("Home (repair)+"), "Home \\(repair\\)\\+");
});

test("service prices convert INR decimals to paise without accepting fractional paise", () => {
  assert.equal(priceToPaise(125), 12500);
  assert.equal(priceToPaise(12.5), 1250);
  assert.equal(priceToPaise("0.01"), 1);
  assert.equal(priceToPaise("1.005"), null);
  assert.equal(priceToPaise(0), null);
  assert.equal(paiseToPrice(1250), 12.5);
});

test("development KYC adapter stays pending and never returns document data", async () => {
  const result = await developmentAdapter.startVerification({
    userId: "user-id",
    profileId: "profile-id",
    documents: [{ name: "identity.pdf", contents: "private" }],
  });
  assert.equal(result.provider, "development_stub");
  assert.equal(result.status, "pending");
  assert.equal(result.redirectUrl, null);
  assert.equal(Object.hasOwn(result, "documents"), false);

  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(getKycAdapter(), disabledAdapter);
    await assert.rejects(disabledAdapter.startVerification(), { code: "KYC_UNAVAILABLE", status: 503 });
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});

test("auth middleware reports structured unauthorized and forbidden responses", async () => {
  const unauthenticatedResponse = responseRecorder();
  await requireAuth({ get: () => undefined }, unauthenticatedResponse, () => {
    assert.fail("Authentication should reject requests without a bearer token.");
  });
  assert.equal(unauthenticatedResponse.statusCode, 401);
  assert.equal(unauthenticatedResponse.payload.success, false);
  assert.equal(unauthenticatedResponse.payload.error.code, "UNAUTHENTICATED");

  const forbiddenResponse = responseRecorder();
  requireRole(["provider"])({ user: { role: "customer" } }, forbiddenResponse, () => {
    assert.fail("Role middleware should reject customers on provider routes.");
  });
  assert.equal(forbiddenResponse.statusCode, 403);
  assert.equal(forbiddenResponse.payload.error.code, "FORBIDDEN");
});

test("public registration rejects admin role and discovery rejects coordinate search", async () => {
  await withTestApi(async (baseUrl) => {
    const registrationResponse = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Admin Account", email: "admin@example.com", password: "safe-password", role: "admin" }),
    });
    const registrationBody = await registrationResponse.json();
    assert.equal(registrationResponse.status, 403);
    assert.equal(registrationBody.success, false);
    assert.equal(registrationBody.error.code, "ROLE_NOT_ALLOWED");

    const discoveryResponse = await fetch(`${baseUrl}/services?latitude=12.97&longitude=77.59`);
    const discoveryBody = await discoveryResponse.json();
    assert.equal(discoveryResponse.status, 400);
    assert.equal(discoveryBody.success, false);
    assert.equal(discoveryBody.error.code, "VALIDATION_ERROR");
  });
});
