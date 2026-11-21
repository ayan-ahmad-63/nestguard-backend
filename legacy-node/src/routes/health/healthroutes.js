const express = require("express");
const { sendSuccessResponse } = require("../../shared/responses/success");
const router = express.Router();

router.get("/", (req, res) => {
    sendSuccessResponse(
        res,
        "NestGuard Backend API is healthy",
        {
            version: "1.0.0",
            uptime: process.uptime(),
            serverBootTime: global.SERVER_BOOT_TIME || Date.now(),
            timestamp: new Date().toISOString(),
        }
    );
});

module.exports = router;