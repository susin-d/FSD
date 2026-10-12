const express = require("express");
const dotenv = require("dotenv");
const connectdb = require("./config/db");
const mongoose = require("mongoose");

dotenv.config();

const port = process.env.PORT || 3000;
const db_url = process.env.MONGODB_URI;

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).json({
    name: "Nearby API",
    message: "Welcome to Nearby API",
    version: "1.0.0",
    status: "running",
  });
});

app.get("/health", async (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  let dbPing = false;

  if (dbConnected) {
    try {
      await mongoose.connection.db.admin().ping();
      dbPing = true;
    } catch (err) {
      dbPing = false;
    }
  }

  const healthy = dbConnected && dbPing;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "unhealthy",
    database: healthy ? "connected" : "disconnected",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

connectdb(db_url);

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});