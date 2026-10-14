function priceToPaise(price) {
  if (typeof price === "number") {
    if (!Number.isFinite(price) || price <= 0) return null;
    price = String(price);
  }
  if (typeof price !== "string") return null;

  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(price.trim());
  if (!match) return null;

  const rupees = BigInt(match[1]);
  const paiseDigits = (match[2] || "").padEnd(2, "0");
  const paise = rupees * 100n + BigInt(paiseDigits || "0");
  if (paise < 1n || paise > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(paise);
}

function paiseToPrice(pricePaise) {
  if (!Number.isSafeInteger(pricePaise) || pricePaise < 1) return null;
  return Number((pricePaise / 100).toFixed(2));
}

module.exports = { paiseToPrice, priceToPaise };
