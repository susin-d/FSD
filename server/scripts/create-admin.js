require("dotenv").config();

const bcrypt = require("bcryptjs");
const connectdb = require("../src/config/db");
const User = require("../src/modules/users/user.model");

async function createAdmin() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD in the server environment.");
  }
  if (password.length < 12) {
    throw new Error("The bootstrap admin password must be at least 12 characters.");
  }

  await connectdb(process.env.MONGO_URI || process.env.MONGODB_URI);
  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== "admin") {
      throw new Error("That email already belongs to a non-admin account; no role was changed.");
    }
    console.log("An admin account already exists for that email.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({ name: "Nearby Administrator", email, passwordHash, role: "admin", isActive: true });
  console.log("Admin account created. The password was not printed or stored in the repository.");
}

createAdmin()
  .catch((error) => {
    console.error("Admin provisioning failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    const mongoose = require("mongoose");
    await mongoose.disconnect().catch(() => {});
  });
