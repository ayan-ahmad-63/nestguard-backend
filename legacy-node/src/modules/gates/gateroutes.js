const express = require("express");
const router = express.Router();
const { getGates } = require("./gatecontroller");

// GET /api/v1/gates
router.get("/", getGates);

module.exports = router;
