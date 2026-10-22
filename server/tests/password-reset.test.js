const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../src/modules/users/user.model");
const { requireAuth } = require("../src/middleware/auth");
const { createAccessToken } = require("../src/modules/auth/token");
const authRoutes = require("../src/modules/auth/routes");
const {
  PASSWORD_RESET_MAX_ATTEMPTS,
  PASSWORD_RESET_REQUEST_MESSAGE,
  PASSWORD_RESET_TTL_MS,
  confirmPasswordReset,
  hashPasswordResetCode,
  isValidPassword,
  requestPasswordReset,
} = require("../src/modules/auth/password-reset");

const secret = "password-reset-tests-use-a-secret-over-thirty-two-characters";
const now = Date.parse("2030-01-01T00:00:00.000Z");
const userId = "64abcdef0123456789abcdef";

function makeUser(overrides = {}) {
  return {
    _id: userId,
    name: "Nearby Customer",
    email: "customer@example.com",
    isActive: true,
    role: "customer",
    passwordHash: "old-password-hash",
    tokenVersion: 0,
    passwordResetAttempts: 0,
    ...overrides,
  };
}

function queryResult(value) {
  return {
    select() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function compare(document, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = document[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      return Object.entries(expected).every(([operator, operand]) => {
        if (operator === "$gt") return new Date(actual).getTime() > new Date(operand).getTime();
        if (operator === "$lt") return Number(actual || 0) < Number(operand);
        if (operator === "$gte") return Number(actual || 0) >= Number(operand);
        return false;
      });
    }
    if (key === "_id") return String(actual) === String(expected);
    if (actual instanceof Date || expected instanceof Date) return new Date(actual).getTime() === new Date(expected).getTime();
    return actual === expected;
  });
}

function applyUpdate(document, update) {
  for (const [key, value] of Object.entries(update.$set || {})) document[key] = value;
  for (const [key, value] of Object.entries(update.$inc || {})) document[key] = Number(document[key] || 0) + value;
  for (const key of Object.keys(update.$unset || {})) delete document[key];
}

function inMemoryUserModel(document) {
  return {
    findOne(filter) { return queryResult(compare(document, filter) ? document : null); },
    async updateOne(filter, update) {
      if (!compare(document, filter)) return { matchedCount: 0 };
      applyUpdate(document, update);
      return { matchedCount: 1 };
    },
    findOneAndUpdate(filter, update) {
      if (!compare(document, filter)) return queryResult(null);
      applyUpdate(document, update);
      return queryResult(document);
    },
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test("password reset requests return an account-safe response and store only an expiring code digest", async () => {
  const user = makeUser();
  const sentEmails = [];
  const commonOptions = {
    UserModel: inMemoryUserModel(user),
    secret,
    now: () => now,
    generateCode: () => "042913",
    sendEmailFn: async (message) => { sentEmails.push(message); return { sent: true }; },
  };

  const existingAccountResponse = await requestPasswordReset(user.email, commonOptions);
  const missingAccountResponse = await requestPasswordReset("missing@example.com", {
    ...commonOptions,
    UserModel: inMemoryUserModel(makeUser({ email: "other@example.com" })),
  });

  assert.equal(existingAccountResponse, PASSWORD_RESET_REQUEST_MESSAGE);
  assert.equal(missingAccountResponse, PASSWORD_RESET_REQUEST_MESSAGE);
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].text, /042913/);
  assert.notEqual(user.passwordResetCodeHash, "042913");
  assert.equal(user.passwordResetCodeHash, hashPasswordResetCode("042913", secret));
  assert.equal(user.passwordResetExpiresAt.getTime(), now + PASSWORD_RESET_TTL_MS);
  assert.equal(user.passwordResetAttempts, 0);
});

test("expired reset codes cannot change the password", async () => {
  const user = makeUser();
  const UserModel = inMemoryUserModel(user);
  await requestPasswordReset(user.email, {
    UserModel,
    secret,
    now: () => now,
    generateCode: () => "042913",
    sendEmailFn: async () => ({ sent: true }),
  });

  const reset = await confirmPasswordReset({ email: user.email, code: "042913", password: "new-password" }, {
    UserModel,
    secret,
    now: () => now + PASSWORD_RESET_TTL_MS + 1,
  });

  assert.equal(reset, false);
  assert.equal(user.passwordHash, "old-password-hash");
});

test("five incorrect reset codes consume the attempt budget", async () => {
  const user = makeUser();
  const UserModel = inMemoryUserModel(user);
  await requestPasswordReset(user.email, {
    UserModel,
    secret,
    now: () => now,
    generateCode: () => "042913",
    sendEmailFn: async () => ({ sent: true }),
  });

  for (let attempt = 0; attempt < PASSWORD_RESET_MAX_ATTEMPTS; attempt += 1) {
    const reset = await confirmPasswordReset({ email: user.email, code: "999999", password: "new-password" }, {
      UserModel,
      secret,
      now: () => now,
    });
    assert.equal(reset, false);
  }

  assert.equal(user.passwordResetAttempts, undefined);
  assert.equal(user.passwordResetCodeHash, undefined);
  assert.equal(await confirmPasswordReset({ email: user.email, code: "042913", password: "new-password" }, {
    UserModel,
    secret,
    now: () => now,
  }), false);
});

test("valid reset consumes the code once, hashes the password, and revokes earlier access JWTs", async (t) => {
  const user = makeUser();
  const UserModel = inMemoryUserModel(user);
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  const previousFindById = User.findById;
  t.after(() => {
    User.findById = previousFindById;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  await requestPasswordReset(user.email, {
    UserModel,
    secret,
    now: () => now,
    generateCode: () => "042913",
    sendEmailFn: async () => ({ sent: true }),
  });
  const previousToken = createAccessToken(user);

  User.findById = () => ({
    select() { return this; },
    lean() { return Promise.resolve(user); },
  });
  const beforeReset = responseRecorder();
  let authenticated = false;
  await requireAuth({ get: () => `Bearer ${previousToken}` }, beforeReset, () => { authenticated = true; });
  assert.equal(authenticated, true);

  const changed = await confirmPasswordReset({ email: user.email, code: "042913", password: "new-password" }, {
    UserModel,
    secret,
    now: () => now,
  });
  assert.equal(changed, true);
  assert.equal(user.tokenVersion, 1);
  assert.equal(user.passwordResetCodeHash, undefined);
  assert.equal(await bcrypt.compare("new-password", user.passwordHash), true);

  const afterReset = responseRecorder();
  authenticated = false;
  await requireAuth({ get: () => `Bearer ${previousToken}` }, afterReset, () => { authenticated = true; });
  assert.equal(authenticated, false);
  assert.equal(afterReset.statusCode, 401);
  assert.equal(afterReset.payload.error.code, "INVALID_TOKEN");

  assert.equal(await confirmPasswordReset({ email: user.email, code: "042913", password: "another-password" }, {
    UserModel,
    secret,
    now: () => now,
  }), false);
});

test("reset passwords follow the existing character and UTF-8 byte limits", () => {
  assert.equal(isValidPassword("1234567"), false);
  assert.equal(isValidPassword("12345678"), true);
  assert.equal(isValidPassword("é".repeat(36)), true);
  assert.equal(isValidPassword("é".repeat(37)), false);
  assert.equal(isValidPassword("a".repeat(73)), false);
});

test("access JWT versions remain compatible before reset and change after reset", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    const token = createAccessToken(makeUser({ tokenVersion: 7 }));
    assert.equal(jwt.verify(token, secret).ver, 7);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("password reset API rejects codes that are not exactly six decimal digits", async () => {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/auth/password-reset/confirm`;
    for (const code of ["12345", "12345a", "1234567", "", 123456]) {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "customer@example.com", code, password: "new-password" }),
      });
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.error.code, "VALIDATION_ERROR");
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
