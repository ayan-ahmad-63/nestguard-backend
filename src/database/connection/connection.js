const dns = require("dns");
// Fix for querySrv ECONNREFUSED when using MongoDB Atlas SRV URIs on local networks/ISPs
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            maxPoolSize: 25,
            minPoolSize: 5,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        const safeUri = (process.env.MONGO_URI || "").replace(/:([^@]+)@/, ":****@");
        console.log("Connected to MongoDB:", safeUri);
    } catch (error) {
        console.error("Error connecting to MongoDB:", error.message);
        process.exit(1);
    }
};

module.exports = connectDB;
