const { randomUUID } = require("node:crypto");

/**
 * KYC adapter contract:
 *   startVerification({ userId, profileId }) ->
 *     { provider, reference, status, redirectUrl? }
 *
 * Identity documents must be collected and retained by the selected KYC vendor.
 * This API deliberately accepts no document payload and stores only vendor status
 * and an opaque reference. Replace this adapter when a vendor is selected.
 */
const disabledAdapter = {
  provider: "disabled",
  async startVerification() {
    const error = new Error("A production KYC provider has not been configured.");
    error.status = 503;
    error.code = "KYC_UNAVAILABLE";
    throw error;
  },
};

const developmentAdapter = {
  provider: "development_stub",
  async startVerification() {
    return {
      provider: this.provider,
      reference: `dev_${randomUUID()}`,
      status: "pending",
      redirectUrl: null,
    };
  },
};

function getKycAdapter() {
  const configuredProvider = (process.env.KYC_PROVIDER || "").trim().toLowerCase();
  if (process.env.NODE_ENV === "production") return disabledAdapter;
  if (!configuredProvider || configuredProvider === "development_stub" || configuredProvider === "mock") {
    return developmentAdapter;
  }
  return disabledAdapter;
}

module.exports = { disabledAdapter, developmentAdapter, getKycAdapter };
