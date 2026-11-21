const express = require("express");
const router = express.Router();
const { getAlerts, acknowledgeAlert, acknowledgeAll } = require("./alertcontroller");

// GET  /api/v1/alerts
router.get("/", getAlerts);

// PATCH /api/v1/alerts/acknowledge-all
router.patch("/acknowledge-all", acknowledgeAll);

// PATCH /api/v1/alerts/:id/acknowledge
router.patch("/:id/acknowledge", acknowledgeAlert);

module.exports = router;
