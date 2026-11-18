/**
 * NestGuard — Biometric Resident & Worker Enrollment CLI
 * ════════════════════════════════════════════════════════
 * Enrolls a fresh Student Resident or Permanent Hostel Worker:
 *  - Enters name, roll number / SAP ID, room, department, guardian contact.
 *  - Interacts with ZKTeco Live20R optical sensor (or auto-generates biometric key).
 *  - Saves the record into MongoDB Atlas with status "OUTSIDE".
 *
 * Usage:
 *   node src/scripts/enroll.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const readline = require("readline");
const mongoose = require("mongoose");
const Student = require("../modules/students/studentmodel");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/nestguard";

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function prompt(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function getInitials(name) {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function getNextFingerprintId() {
  const all = await Student.find({ fingerprintId: /^FP-\d+$/ }).select("fingerprintId");
  let maxNum = 0;
  for (const s of all) {
    if (s.fingerprintId) {
      const match = s.fingerprintId.match(/^FP-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }
  const nextNum = maxNum + 1;
  return `FP-${String(nextNum).padStart(3, "0")}`;
}

async function main() {
  console.log("\n==================================================");
  console.log("   NestGuard — Biometric Enrollment (Phase 1)");
  console.log("==================================================\n");

  await mongoose.connect(MONGO_URI);
  console.log("✓ Connected to MongoDB Atlas.\n");

  const rl = createInterface();

  try {
    console.log("Select Category:");
    console.log("  [1] Student Resident");
    console.log("  [2] Permanent Hostel Worker (Mess, Cleaning, Staff)");
    const catChoice = await prompt(rl, "Choose (1 or 2) [default 1]: ");
    const personType = catChoice === "2" ? "WORKER" : "STUDENT";

    const name = await prompt(rl, `Full Name (e.g. Ahmad Mujtaba): `);
    if (!name) {
      console.log("[ERROR] Name cannot be empty.");
      return;
    }

    const rollNo = await prompt(
      rl,
      personType === "WORKER" ? "Worker ID / Staff Code (e.g. WRK-101): " : "SAP ID / Roll Number (e.g. 70145462): "
    );
    if (!rollNo) {
      console.log("[ERROR] ID/Roll number cannot be empty.");
      return;
    }

    const roomNo = await prompt(
      rl,
      personType === "WORKER" ? "Assigned Section (e.g. Mess Hall, Block B): " : "Hostel Room No (e.g. Room 302, Block A): "
    );

    const department = await prompt(
      rl,
      personType === "WORKER" ? "Designation / Trade (e.g. Cook, Electrician): " : "Degree / Department (e.g. BSCS): "
    );

    let guardianName = "";
    let guardianPhone = "";
    let guardianEmail = "";

    if (personType === "STUDENT") {
      console.log("\nParent / Guardian Details (Used for instant visitor alerts):");
      guardianName = await prompt(rl, "Guardian Name (optional): ");
      guardianPhone = await prompt(rl, "Guardian Phone (optional): ");
      guardianEmail = await prompt(rl, "Guardian Email (optional): ");
    }

    // Biometric ID Generation
    const nextFpId = await getNextFingerprintId();
    console.log(`\nAssigned Biometric Slot: ${nextFpId}`);

    const existing = await Student.findOne({ rollNo: rollNo.toUpperCase() });
    if (existing) {
      console.log(`\nNotice: A record with ID ${rollNo.toUpperCase()} already exists.`);
      const overwrite = await prompt(rl, "Update existing record? (y/n): ");
      if (overwrite.toLowerCase() !== "y") {
        console.log("Enrollment cancelled.");
        return;
      }
    }

    const initials = getInitials(name);

    const resident = await Student.findOneAndUpdate(
      { rollNo: rollNo.toUpperCase() },
      {
        name,
        rollNo: rollNo.toUpperCase(),
        initials,
        personType,
        roomNo: roomNo || "Unassigned",
        department: department || "General",
        fingerprintId: nextFpId,
        isEnrolled: true,
        status: "OUTSIDE",
        guardianContact: {
          name: guardianName || "",
          phone: guardianPhone || "",
          email: guardianEmail || "",
        },
      },
      { upsert: true, returnDocument: "after" }
    );

    console.log("\n==================================================");
    console.log("   ✓ RESIDENT ENROLLED SUCCESSFULLY");
    console.log("==================================================");
    console.log(`   Name:           ${resident.name}`);
    console.log(`   ID / Roll No:   ${resident.rollNo}`);
    console.log(`   Category:       ${resident.personType}`);
    console.log(`   Initials:       ${resident.initials}`);
    console.log(`   Room / Section: ${resident.roomNo}`);
    console.log(`   Biometric ID:   ${resident.fingerprintId}`);
    console.log(`   Status:         ${resident.status} (Ready for gate entry)`);
    if (guardianEmail) {
      console.log(`   Guardian Alert: ${guardianEmail}`);
    }
    console.log("==================================================\n");
    console.log("When this resident scans their finger on the Live20R scanner,");
    console.log("NestGuard will identify them and display their live log on the dashboard!\n");

  } finally {
    rl.close();
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Enrollment failed:", err.message);
  process.exit(1);
});
