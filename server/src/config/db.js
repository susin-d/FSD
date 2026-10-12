
const mongoose = require("mongoose");
const dns = require("node:dns");

// Configure DNS servers for MongoDB Atlas SRV resolution
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const connectdb = async (db_url) => {
    try {
        await mongoose.connect(db_url, {
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
        });

        console.log("MongoDB Connected Successfully");
        console.log("Database:", mongoose.connection.name);
    } catch (error) {
        console.error("MongoDB Connection Failed:", error.message);
        process.exit(1);
    }
};

module.exports = connectdb;
