const jwt = require("jsonwebtoken");
const {
  findAdminByEmail,
  findAdminById,
  findAdminByFingerprintId,
  findAdminByRole,
} = require("./authrepository");

/**
 * Validate credentials and return a signed JWT + user object.
 * Throws an error with status 401 on invalid credentials.
 */
async function loginService(email, password) {
  const admin = await findAdminByEmail(email);
  if (!admin) {
    const err = new Error("Invalid email or password");
    err.status = 401;
    throw err;
  }

  const passwordMatch = await admin.comparePassword(password);
  if (!passwordMatch) {
    const err = new Error("Invalid email or password");
    err.status = 401;
    throw err;
  }

  const payload = {
    id: admin._id.toString(),
    email: admin.email,
    role: admin.role,
    name: admin.name,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

  return { token, user: { id: payload.id, email: payload.email, role: payload.role, name: payload.name } };
}

/**
 * Return current user data from req.user (already decoded by authMiddleware).
 */
async function getMeService(userId) {
  const user = await findAdminById(userId);
  if (!user) {
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }
  return user;
}

/**
 * Biometric authentication service for staff (Admin, Warden, Security).
 * Authenticates via registered fingerprintId (e.g. FP-ADM-01, FP-WRD-01, FP-SEC-01)
 * or designated role preset.
 */
async function biometricLoginService(fingerprintId, role) {
  let admin = null;

  if (fingerprintId) {
    admin = await findAdminByFingerprintId(fingerprintId);
  }

  // Fallback to role lookup ONLY in development / explicit demo mode
  if (!admin && role) {
    if (process.env.ALLOW_DEV_ROLE_BYPASS === "true" || process.env.NODE_ENV !== "production") {
      console.warn(`[SECURITY WARNING] Biometric role bypass used for: ${role}`);
      admin = await findAdminByRole(role);
    } else {
      const err = new Error("Valid biometric fingerprint credential required for authentication");
      err.status = 401;
      throw err;
    }
  }

  if (!admin) {
    const err = new Error("Biometric template not recognized for authorized staff");
    err.status = 401;
    throw err;
  }

  const payload = {
    id: admin._id.toString(),
    email: admin.email,
    role: admin.role,
    name: admin.name,
    fingerprintId: admin.fingerprintId || "",
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

  return {
    token,
    user: {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      name: payload.name,
      fingerprintId: payload.fingerprintId,
    },
  };
}

module.exports = { loginService, getMeService, biometricLoginService };
