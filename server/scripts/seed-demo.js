require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../src/modules/users/user.model");
const ProviderProfile = require("../src/modules/providers/provider.model");
const Service = require("../src/modules/services/service.model");
const Availability = require("../src/modules/availability/availability.model");
const AvailabilityDay = require("../src/modules/availability/availability-day.model");
const Booking = require("../src/modules/bookings/booking.model");
const MarketplaceSettings = require("../src/modules/settings/marketplace-settings.model");
const Dispute = require("../src/modules/disputes/dispute.model");

const accounts = [
  { name: "Demo Customer", email: "demo.customer@example.test", role: "customer" },
  { name: "Demo Provider", email: "demo.provider@example.test", role: "provider" },
  { name: "Demo Admin", email: "demo.admin@example.test", role: "admin" },
];

const serviceDefinitions = [
  {
    title: "Demo deep home cleaning",
    description: "A demo-only two-hour home cleaning service for discovery, booking, and review flows.",
    category: "Cleaning",
    pricePaise: 149900,
    durationMinutes: 120,
  },
  {
    title: "Demo plumbing repair visit",
    description: "A demo-only plumbing visit for common tap, pipe, and drainage repairs.",
    category: "Plumbing",
    pricePaise: 89900,
    durationMinutes: 90,
  },
  {
    title: "Demo electrical safety check",
    description: "A demo-only inspection of common switches, wiring, and electrical fixtures.",
    category: "Electrical",
    pricePaise: 119900,
    durationMinutes: 90,
  },
];

function indiaTime(date, time) {
  return new Date(`${date}T${time}:00+05:30`);
}

function dateKeyInIndia(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateKey(dateKey, offsetDays) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function indiaDate(offsetDays, time, today = dateKeyInIndia()) {
  const date = shiftDateKey(today, offsetDays);
  return { date, at: indiaTime(date, time) };
}

async function seedDemo() {
  if (process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Set ALLOW_DEMO_SEED=true for this one-time demo seed.");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo seeding is disabled when NODE_ENV=production.");
  }
  const password = process.env.DEMO_PASSWORD;
  if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Set DEMO_PASSWORD to a 12 to 72 byte demo password in the process environment.");
  }
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is required.");

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const existingDocumentCounts = await Promise.all(
    collections.map(async ({ name }) => db.collection(name).countDocuments({})),
  );
  if (existingDocumentCounts.some((count) => count > 0)) {
    throw new Error("The configured database contains existing data. Demo seeding stopped without changing records.");
  }
  if (await User.exists({ email: { $in: accounts.map(({ email }) => email) } })) {
    throw new Error("A demo account already exists. Demo seeding stopped without overwriting it.");
  }

  await Promise.all([
    User.init(), ProviderProfile.init(), Service.init(), Availability.init(),
    AvailabilityDay.init(), Booking.init(), MarketplaceSettings.init(), Dispute.init(),
  ]);

  const passwordHash = await bcrypt.hash(password, 12);
  const users = await User.insertMany(accounts.map((account) => ({ ...account, passwordHash, isActive: true })));
  const [customer, providerUser, admin] = users;
  const provider = await ProviderProfile.create({
    user: providerUser._id,
    businessName: "DEMO ONLY Home Care",
    bio: "Seeded marketplace profile for testing Nearby. No KYC documents are stored.",
    categories: ["Cleaning", "Plumbing", "Electrical"],
    servicePincodes: ["560001", "560002"],
    verificationStatus: "verified",
    kycProvider: "demo_seed",
    kycReference: "demo-seed-no-documents",
  });
  const services = await Service.insertMany(serviceDefinitions.map((definition) => ({
    ...definition,
    provider: provider._id,
    servicePincodes: ["560001", "560002"],
    isActive: true,
  })));
  const service = services[0];
  const today = dateKeyInIndia();
  const availabilitySlots = Array.from({ length: 14 }, (_, index) => index + 1).flatMap((offsetDays) => {
    const date = shiftDateKey(today, offsetDays);
    return [
      { date, startTime: "10:00", endTime: "12:00", startsAt: indiaTime(date, "10:00"), endsAt: indiaTime(date, "12:00") },
      { date, startTime: "14:00", endTime: "17:00", startsAt: indiaTime(date, "14:00"), endsAt: indiaTime(date, "17:00") },
    ];
  });
  await Availability.create({
    provider: provider._id,
    slots: availabilitySlots,
  });
  await MarketplaceSettings.updateOne(
    { key: "marketplace" },
    { $setOnInsert: {
      key: "marketplace",
      commissionBps: 1200,
      checkoutTimeoutMinutes: 15,
      completionReviewHours: 48,
      cancellationPolicy: {
        customerEarlyWindowHours: 24,
        customerEarlyRefundBps: 9000,
        customerLateRefundBps: 5000,
        providerCancelRefundBps: 10000,
      },
      razorpayRouteEnabled: false,
      updatedBy: admin._id,
    } },
    { upsert: true },
  );

  const requestedTime = indiaDate(2, "10:00", today);
  const completedTime = indiaDate(-2, "10:00", today);
  const disputedTime = indiaDate(-1, "14:00", today);
  const requested = await Booking.create({
    customer: customer._id,
    provider: provider._id,
    service: service._id,
    scheduledAt: requestedTime.at,
    servicePincode: "560001",
    serviceAddress: "Demo address, Bengaluru",
    notes: "Demo-only request for testing provider acceptance and checkout.",
    status: "requested",
    pricePaise: service.pricePaise,
    durationMinutes: service.durationMinutes,
  });
  const completed = await Booking.create({
    customer: customer._id,
    provider: provider._id,
    service: service._id,
    scheduledAt: completedTime.at,
    servicePincode: "560001",
    serviceAddress: "Demo address, Bengaluru",
    notes: "Demo-only completed booking for testing reviews.",
    status: "completed",
    pricePaise: service.pricePaise,
    durationMinutes: service.durationMinutes,
    completedAt: indiaTime(completedTime.date, "12:00"),
  });
  const disputed = await Booking.create({
    customer: customer._id,
    provider: provider._id,
    service: service._id,
    scheduledAt: disputedTime.at,
    servicePincode: "560001",
    serviceAddress: "Demo address, Bengaluru",
    notes: "Demo-only booking for testing the admin dispute queue.",
    status: "disputed",
    pricePaise: service.pricePaise,
    durationMinutes: service.durationMinutes,
  });
  await AvailabilityDay.create({
    provider: provider._id,
    dateKey: disputedTime.date,
    reservations: [{
      booking: disputed._id,
      startsAt: disputed.scheduledAt,
      endsAt: indiaTime(disputedTime.date, "16:00"),
      state: "confirmed",
      expiresAt: null,
    }],
  });
  await Dispute.create({
    booking: disputed._id,
    openedBy: customer._id,
    reason: "Demo dispute for testing the admin review and resolution queue.",
    status: "open",
    previousBookingStatus: "confirmed",
  });

  return {
    accounts,
    providerProfileId: String(provider._id),
    serviceId: String(service._id),
    serviceIds: services.map((item) => String(item._id)),
    bookingIds: { requested: String(requested._id), completed: String(completed._id), disputed: String(disputed._id) },
  };
}

if (require.main === module) {
  seedDemo()
    .then((result) => console.log(JSON.stringify({ seeded: true, ...result })))
    .catch((error) => {
      console.error(`Demo seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => { await mongoose.disconnect().catch(() => {}); });
}

module.exports = { dateKeyInIndia, shiftDateKey, indiaDate, serviceDefinitions, seedDemo };
