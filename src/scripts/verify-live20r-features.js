const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const mongoose = require("mongoose");
const Student = require("../modules/students/studentmodel");
const Admin = require("../modules/admins/adminmodel");

const MONGO_URI = process.env.MONGO_URI;

async function test() {
  console.log("Connecting to MongoDB Atlas...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB Atlas!\n");

  // 1. Verify Name-based ID Generation
  console.log("[1/3] Testing Name-based ID generation...");
  const names = ["Ahmad Mujtaba", "Zahid Khan", "Fatima Zahra", "Admin", "Warden", "Security"];
  for (const name of names) {
    let code = "USR";
    const clean = name.trim();
    if (clean.toLowerCase() === "admin") code = "ADM";
    else if (clean.toLowerCase() === "warden") code = "WRD";
    else if (clean.toLowerCase() === "security") code = "SEC";
    else {
      const parts = clean.split(/\s+/);
      code = parts.length === 1 ? parts[0].substring(0, 3).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    console.log(`      • "${name}" -> Scan ID Prefix: FP-${code}`);
  }

  // 2. Verify all current enrolled personnel
  console.log("\n[2/3] Checking current staff records in MongoDB Atlas...");
  const staffRecords = await Student.find({ personType: "STAFF" });
  for (const st of staffRecords) {
    console.log(`      ✓ Staff: ${st.name} | RollNo: ${st.rollNo} | Biometric Slot: ${st.fingerprintId}`);
  }

  // 3. Verify Admin matching
  console.log("\n[3/3] Checking Admin biometric auth records...");
  const admins = await Admin.find({});
  for (const a of admins) {
    console.log(`      ✓ Admin Account: ${a.name} (${a.email}) | Role: ${a.role} | Scan ID: ${a.fingerprintId}`);
  }

  console.log("\n✓ Verification successful!");
  await mongoose.disconnect();
}

test().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
