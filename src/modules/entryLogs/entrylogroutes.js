const express = require("express");
const router = express.Router();
const { handleScan, getLogs } = require("./entrylogcontroller");

// POST /api/v1/entry-logs/scan
// Triggered by hardware gateway (Arduino/ZKTeco) or simulated Postman call
router.post("/scan", handleScan);

// GET /api/v1/entry-logs?page=1&limit=50&gate=Main Gate&status=safe
router.get("/", getLogs);

module.exports = router;
