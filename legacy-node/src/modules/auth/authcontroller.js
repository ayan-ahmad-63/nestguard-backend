const { loginService, getMeService, biometricLoginService } = require("./authservice");
const { loginSchema } = require("./authvalidation");
const { sendSuccessResponse } = require("../../shared/responses/success");
const { sendErrorResponse } = require("../../shared/responses/error");

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

async function login(req, res) {
  // Zod validation (v4 uses .issues, not .errors)
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.issues.map((e) => e.message);
    return sendErrorResponse(res, "Validation failed", errors, 422);
  }

  const { email, password } = result.data;
  const { token, user } = await loginService(email, password);

  // Set httpOnly cookie alongside the JSON response so both
  // the cookie-auth and Authorization-header paths work
  res.cookie("ng_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
  });

  return sendSuccessResponse(res, "Login successful", { token, user }, null, 200);
}

async function biometricLogin(req, res) {
  const { fingerprintId, role } = req.body || {};

  if (!fingerprintId && !role) {
    return sendErrorResponse(res, "Fingerprint identifier or staff role is required", [], 400);
  }

  const { token, user } = await biometricLoginService(fingerprintId, role);

  res.cookie("ng_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
  });

  return sendSuccessResponse(
    res,
    `Biometric authentication verified (${user.role.toUpperCase()})`,
    { token, user },
    null,
    200
  );
}

async function getMe(req, res) {
  const user = await getMeService(req.user.id);
  return sendSuccessResponse(res, "User fetched", user, null, 200);
}

async function logout(req, res) {
  res.clearCookie("ng_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  res.clearCookie("ng_token");
  return sendSuccessResponse(res, "Logged out successfully", null, null, 200);
}

let cachedStaff = null;
let staffCacheExpiry = 0;

async function getStaffProfiles(req, res) {
  try {
    const now = Date.now();
    if (cachedStaff && now < staffCacheExpiry) {
      return sendSuccessResponse(res, "Staff profiles retrieved", { staff: cachedStaff }, null, 200);
    }

    const Admin = require("../admins/adminmodel");
    const admins = await Admin.find({ isActive: true }).select("name role email fingerprintId").lean();
    cachedStaff = admins;
    staffCacheExpiry = now + 60000;

    return sendSuccessResponse(res, "Staff profiles retrieved", { staff: admins }, null, 200);
  } catch (err) {
    return sendErrorResponse(res, "Failed to retrieve staff profiles", [err.message], 500);
  }
}

function clearStaffProfilesCache() {
  cachedStaff = null;
  staffCacheExpiry = 0;
}

module.exports = { login, biometricLogin, getMe, logout, getStaffProfiles, clearStaffProfilesCache };
