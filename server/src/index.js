require("dotenv").config();

const http = require("node:http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const connectdb = require("./config/db");
const { app, allowedOrigins } = require("./app");
const { attachMessageSocket } = require("./modules/messaging/socket");
const { startLifecycleWorker } = require("./utils/lifecycle");

const port = Number(process.env.PORT || 4000);

async function startServer() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  // MONGO_URI is canonical; keep the old key as a local migration fallback.
  await connectdb(process.env.MONGO_URI || process.env.MONGODB_URI);

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: allowedOrigins(),
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization"],
    },
  });
  attachMessageSocket(io);
  const lifecycleTimer = await startLifecycleWorker();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.removeListener("error", reject);
      console.log(`Nearby API listening on port ${port}`);
      resolve();
    });
  });

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    console.log(`${signal} received; shutting down Nearby API.`);
    clearInterval(lifecycleTimer);
    const hardExit = setTimeout(() => process.exit(1), 10000).unref();
    io.close(async () => {
      clearTimeout(hardExit);
      await mongoose.disconnect();
      process.exit(0);
    });
  }
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  return { server, io };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Nearby API failed to start:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { startServer };
