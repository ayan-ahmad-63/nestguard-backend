/**
 * NestGuard — JWT Token Generator Utility
 * ═══════════════════════════════════════
 * Usage:
 *   node src/scripts/gen-token.js [admin|warden|security]
 *
 * Examples:
 *   node src/scripts/gen-token.js admin
 *   node src/scripts/gen-token.js warden
 *   node src/scripts/gen-token.js security
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const JWT_SECRET = process.env.JWT_SECRET || "your_super_secret_jwt_key_change_this";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

const USERS = {
  admin: {
    id: "65f1a2b3c4d5e6f7a8b9c0d1",
    email: "admin@nestguard.in",
    role: "admin",
    name: "Admin",
  },
  warden: {
    id: "65f1a2b3c4d5e6f7a8b9c0d2",
    email: "warden@nestguard.in",
    role: "warden",
    name: "Warden",
  },
  security: {
    id: "65f1a2b3c4d5e6f7a8b9c0d3",
    email: "security@nestguard.in",
    role: "security",
    name: "Security",
  },
};

const requestedRole = (process.argv[2] || "admin").toLowerCase();

if (requestedRole === "secret") {
  const newSecret = crypto.randomBytes(32).toString("hex");
  console.log("\n==================================================");
  console.log("   Generated High-Entropy JWT Secret (32 bytes)");
  console.log("==================================================");
  console.log(`\nJWT_SECRET=${newSecret}\n`);
  console.log("Copy and paste this into both backend/.env and frontend/.env.local\n");
  process.exit(0);
}

const user = USERS[requestedRole] || {
  id: "65f1a2b3c4d5e6f7a8b9c0d9",
  email: `${requestedRole}@nestguard.in`,
  role: requestedRole,
  name: requestedRole.toUpperCase(),
};

const token = jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

console.log("\n==================================================");
console.log(`   NestGuard JWT Token · Role: ${user.role.toUpperCase()}`);
console.log("==================================================");
console.log("\nUser Payload:");
console.log(JSON.stringify(user, null, 2));
console.log("\nSigned JWT Token:");
console.log(token);
console.log("\nHow to use in cURL / Postman:");
console.log(`Authorization: Bearer ${token}`);
console.log("\n==================================================\n");
