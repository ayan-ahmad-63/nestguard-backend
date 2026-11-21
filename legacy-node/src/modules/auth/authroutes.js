const express = require("express");
const router = express.Router();
const { login, biometricLogin, getMe, logout, getStaffProfiles } = require("./authcontroller");
const authMiddleware = require("../../middleware/authmiddleware");

// GET /api/v1/auth/staff-profiles — public for login screen
router.get("/staff-profiles", getStaffProfiles);

// POST /api/v1/auth/login
router.post("/login", login);

// POST /api/v1/auth/biometric-login
router.post("/biometric-login", biometricLogin);

// GET /api/v1/auth/me  — protected
router.get("/me", authMiddleware, getMe);

// POST /api/v1/auth/logout — allow clearing cookie regardless of token status
router.post("/logout", logout);

module.exports = router;
