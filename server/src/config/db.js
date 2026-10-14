const mongoose = require("mongoose");
const dns = require("node:dns");
const net = require("node:net");

function configureDnsResolvers() {
  const configured = process.env.MONGODB_DNS_SERVERS;
  if (!configured) return;

  const servers = configured.split(",").map((server) => server.trim());
  if (!servers.length || servers.some((server) => !net.isIP(server))) {
    throw new Error("MONGODB_DNS_SERVERS must contain comma-separated IP addresses.");
  }

  dns.setServers(servers);
}

async function connectdb(dbUrl) {
  if (!dbUrl) {
    throw new Error("MONGO_URI is required to start the API.");
  }

  configureDnsResolvers();
  await mongoose.connect(dbUrl, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });

  return mongoose.connection;
}

module.exports = connectdb;
