const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const mongoose = require("mongoose");
const { biometricLoginService } = require("../modules/auth/authservice");
const { findAdminByFingerprintId } = require("../modules/auth/authrepository");

const MONGO_URI = process.env.MONGO_URI;

async function test() {
  console.log("Connecting to MongoDB Atlas...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected!\n");

  const roles = [
    { role: "admin", fp: "FP-ADM-01" },
    { role: "warden", fp: "FP-WRD-01" },
    { role: "security", fp: "FP-SEC-01" },
  ];

  for (const item of roles) {
    console.log(`[TEST] Testing biometric lookup for ${item.role} (${item.fp})...`);
    const direct = await findAdminByFingerprintId(item.fp);
    if (!direct) {
      throw new Error(`Failed to find admin by fingerprintId: ${item.fp}`);
    }
    console.log(`       ✓ Found in Admin collection: ${direct.name} (${direct.email}, role: ${direct.role})`);

    const authRes = await biometricLoginService(item.fp, item.role);
    console.log(`       ✓ Biometric Login JWT generated: ${authRes.token.substring(0, 25)}...`);
    console.log(`       ✓ User object:`, authRes.user);
    console.log();
  }

  console.log("All 3 staff biometric authentications (Admin, Warden, Security) verified successfully!");
  await mongoose.disconnect();
}

test().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
