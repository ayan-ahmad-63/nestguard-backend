const Admin = require("../admins/adminmodel");

/**
 * Find an admin by email, explicitly selecting the password field.
 */
async function findAdminByEmail(email) {
  return Admin.findOne({ email: email.toLowerCase().trim(), isActive: true }).select("+password");
}

/**
 * Find an admin by id (no password).
 */
async function findAdminById(id) {
  return Admin.findById(id).select("-password");
}

/**
 * Find an admin by fingerprint identifier.
 */
async function findAdminByFingerprintId(fingerprintId) {
  if (!fingerprintId) return null;
  return Admin.findOne({ fingerprintId: fingerprintId.trim(), isActive: true }).select("-password");
}

/**
 * Find an active admin by role ("admin", "warden", "security").
 */
async function findAdminByRole(role) {
  if (!role) return null;
  return Admin.findOne({ role: role.toLowerCase().trim(), isActive: true }).select("-password");
}

module.exports = {
  findAdminByEmail,
  findAdminById,
  findAdminByFingerprintId,
  findAdminByRole,
};
