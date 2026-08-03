require("dotenv").config();

const app = require("./app");
const connectDB = require("./database/connection/connection");

const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        await connectDB();
        app.listen(PORT, () => {
            console.log(`NestGuard Backend API running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Error starting server:", error.message);
        process.exit(1);
    }
};

startServer();