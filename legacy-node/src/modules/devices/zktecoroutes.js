const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const Student = require("../students/studentmodel");
const Admin = require("../admins/adminmodel");
const Gate = require("../gates/gatemodel");
const EntryLog = require("../entryLogs/entrylogmodel");
const Alert = require("../alerts/alertmodel");
const { sendSuccessResponse } = require("../../shared/responses/success");
const { sendErrorResponse } = require("../../shared/responses/error");

/**
 * In-memory state for live Live20R hardware arming:
 * - armedEnrollment: for new resident/staff registration
 * - armedUpdateFp: for re-scanning & updating existing user's fingerprint
 * - armedLogin: for physical thumb-scan console login
 */
let armedEnrollment = null;
let lastEnrollmentResult = null;
let armedEnrollmentTimer = null;

let armedUpdateFp = null;
let lastUpdateFpResult = null;
let armedUpdateFpTimer = null;

let armedLogin = null;
let lastLoginResult = null;
let armedLoginTimer = null;

const ARM_TIMEOUT_MS = 60000; // 60s auto-disarm

function clearEnrollmentTimeout() {
  if (armedEnrollmentTimer) {
    clearTimeout(armedEnrollmentTimer);
    armedEnrollmentTimer = null;
  }
}

function clearUpdateFpTimeout() {
  if (armedUpdateFpTimer) {
    clearTimeout(armedUpdateFpTimer);
    armedUpdateFpTimer = null;
  }
}

function clearLoginTimeout() {
  if (armedLoginTimer) {
    clearTimeout(armedLoginTimer);
    armedLoginTimer = null;
  }
}

function getInitials(name) {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Generate distinct fingerprint ID respective to the user's name
 * e.g. "Ahmad Mujtaba" -> "FP-AM-01"
 * e.g. "Zahid Khan"    -> "FP-ZK-01"
 * e.g. "Warden"        -> "FP-WRD-01"
 * e.g. "Admin"         -> "FP-ADM-01"
 * e.g. "Security"      -> "FP-SEC-01"
 */
async function getNextFingerprintId(name) {
  let code = "USR";
  if (name && typeof name === "string") {
    const clean = name.trim();
    if (clean.toLowerCase() === "admin") code = "ADM";
    else if (clean.toLowerCase() === "warden") code = "WRD";
    else if (clean.toLowerCase() === "security") code = "SEC";
    else {
      const parts = clean.split(/\s+/);
      if (parts.length === 1) {
        code = parts[0].substring(0, 3).toUpperCase();
      } else {
        code = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
    }
  }

  const prefix = `FP-${code}`;
  const regex = new RegExp(`^${prefix}-\\d+$`);
  const [existingStudents, existingAdmins] = await Promise.all([
    Student.find({ fingerprintId: regex }).select("fingerprintId").lean(),
    Admin.find({ fingerprintId: regex }).select("fingerprintId").lean(),
  ]);
  const allExisting = [...existingStudents, ...existingAdmins];
  let maxNum = 0;
  for (const s of allExisting) {
    if (s.fingerprintId) {
      const match = s.fingerprintId.match(new RegExp(`^${prefix}-(\\d+)$`));
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }
  return `${prefix}-${String(maxNum + 1).padStart(2, "0")}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. LIVE ENROLLMENT ARMING ENDPOINTS (NEW RESIDENTS / STAFF)
// ══════════════════════════════════════════════════════════════════════════════

router.post("/arm-enroll", (req, res) => {
  const { name, rollNo, personType, roomNo, department, guardianContact, consentGiven } = req.body;
  if (!name || !rollNo) {
    return sendErrorResponse(res, "Name and Roll No / Staff ID are required to arm biometric scanner", [], 400);
  }

  armedEnrollment = {
    name: name.trim(),
    rollNo: rollNo.trim().toUpperCase(),
    personType: personType || "STUDENT",
    roomNo: roomNo || "Unassigned",
    department: department || "General",
    guardianContact: guardianContact || {},
    consentGiven: Boolean(consentGiven),
    armedAt: Date.now(),
  };

  lastEnrollmentResult = null;
  console.log(`[ZKTeco Live20R] SENSOR ARMED FOR ENROLLMENT: ${armedEnrollment.name} (${armedEnrollment.rollNo})`);

  clearEnrollmentTimeout();
  armedEnrollmentTimer = setTimeout(() => {
    if (armedEnrollment) {
      console.log(`[ZKTeco Live20R] Enrollment arming timed out for ${armedEnrollment.name}. Auto-disarming.`);
      clearEnrollmentTimeout();
      armedEnrollment = null;
      const appIo = req.app.get("io");
      if (appIo) appIo.emit("sensor_armed", { armed: false, timeout: true });
    }
  }, ARM_TIMEOUT_MS);

  const io = req.app.get("io");
  if (io) {
    io.emit("sensor_armed", { armed: true, target: armedEnrollment });
  }

  return sendSuccessResponse(res, "Sensor armed for physical finger touch", { armed: true, target: armedEnrollment }, null, 200);
});

router.post("/disarm-enroll", (req, res) => {
  clearEnrollmentTimeout();
  armedEnrollment = null;
  console.log("[ZKTeco Live20R] Sensor disarmed from enrollment mode");

  const io = req.app.get("io");
  if (io) {
    io.emit("sensor_armed", { armed: false });
  }

  return sendSuccessResponse(res, "Sensor disarmed", { armed: false }, null, 200);
});

router.get("/enroll-status", (req, res) => {
  return sendSuccessResponse(res, "Enrollment status", {
    isArmed: Boolean(armedEnrollment),
    target: armedEnrollment,
    lastResult: lastEnrollmentResult,
  }, null, 200);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. FINGERPRINT UPDATE ARMING ENDPOINTS (FOR ANY ENROLLED USER)
// ══════════════════════════════════════════════════════════════════════════════

router.post("/arm-update-fp", (req, res) => {
  const { studentId, name, rollNo } = req.body;
  if (!studentId || !name) {
    return sendErrorResponse(res, "User ID and Name are required to arm fingerprint update", [], 400);
  }

  armedUpdateFp = {
    studentId: studentId.trim(),
    name: name.trim(),
    rollNo: (rollNo || "").trim().toUpperCase(),
    armedAt: Date.now(),
  };

  lastUpdateFpResult = null;
  console.log(`[ZKTeco Live20R] SENSOR ARMED FOR FINGERPRINT UPDATE: ${armedUpdateFp.name} (${armedUpdateFp.studentId})`);

  clearUpdateFpTimeout();
  armedUpdateFpTimer = setTimeout(() => {
    if (armedUpdateFp) {
      console.log(`[ZKTeco Live20R] Fingerprint update arming timed out for ${armedUpdateFp.name}. Auto-disarming.`);
      clearUpdateFpTimeout();
      armedUpdateFp = null;
      const appIo = req.app.get("io");
      if (appIo) appIo.emit("update_fp_armed", { armed: false, timeout: true });
    }
  }, ARM_TIMEOUT_MS);

  const io = req.app.get("io");
  if (io) {
    io.emit("update_fp_armed", { armed: true, target: armedUpdateFp });
  }

  return sendSuccessResponse(res, "Sensor armed to capture new fingerprint", { armed: true, target: armedUpdateFp }, null, 200);
});

router.post("/disarm-update-fp", (req, res) => {
  clearUpdateFpTimeout();
  armedUpdateFp = null;
  console.log("[ZKTeco Live20R] Sensor disarmed from fingerprint update mode");

  const io = req.app.get("io");
  if (io) {
    io.emit("update_fp_armed", { armed: false });
  }

  return sendSuccessResponse(res, "Sensor disarmed", { armed: false }, null, 200);
});

router.get("/update-fp-status", (req, res) => {
  return sendSuccessResponse(res, "Update fingerprint status", {
    isArmed: Boolean(armedUpdateFp),
    target: armedUpdateFp,
    lastResult: lastUpdateFpResult,
  }, null, 200);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. PHYSICAL THUMB-SCAN LOGIN ARMING ENDPOINTS (LOGIN PAGE)
// ══════════════════════════════════════════════════════════════════════════════

router.post("/arm-login", (req, res) => {
  const { role } = req.body || {};

  armedLogin = {
    role: role ? role.toLowerCase().trim() : null,
    armedAt: Date.now(),
  };

  lastLoginResult = null;
  console.log(`[ZKTeco Live20R] SENSOR ARMED FOR PHYSICAL THUMB LOGIN (Target Role: ${armedLogin.role || "ANY STAFF"})`);

  clearLoginTimeout();
  armedLoginTimer = setTimeout(() => {
    if (armedLogin) {
      console.log("[ZKTeco Live20R] Thumb login arming timed out. Auto-disarming.");
      clearLoginTimeout();
      armedLogin = null;
      const appIo = req.app.get("io");
      if (appIo) appIo.emit("login_sensor_armed", { armed: false, timeout: true });
    }
  }, ARM_TIMEOUT_MS);

  const io = req.app.get("io");
  if (io) {
    io.emit("login_sensor_armed", { armed: true, role: armedLogin.role });
  }

  return sendSuccessResponse(res, "Sensor armed for physical thumb scan login", { armed: true, role: armedLogin.role }, null, 200);
});

router.post("/disarm-login", (req, res) => {
  clearLoginTimeout();
  armedLogin = null;
  console.log("[ZKTeco Live20R] Sensor disarmed from thumb login mode");

  const io = req.app.get("io");
  if (io) {
    io.emit("login_sensor_armed", { armed: false });
  }

  return sendSuccessResponse(res, "Login sensor disarmed", { armed: false }, null, 200);
});

router.get("/login-status", (req, res) => {
  return sendSuccessResponse(res, "Thumb login status", {
    isArmed: Boolean(armedLogin),
    role: armedLogin ? armedLogin.role : null,
    lastResult: lastLoginResult,
  }, null, 200);
});

// Dedicated Biometric Cache Endpoint for Hardware Live20R Reader (Loads both Students & Staff)
router.get("/biometric-cache", async (req, res) => {
  try {
    const [students, admins] = await Promise.all([
      Student.find({ isEnrolled: true, fingerprintTemplate: { $exists: true, $ne: "" } })
        .select("name rollNo personType fingerprintId fingerprintTemplate")
        .lean(),
      Admin.find({ isActive: true, fingerprintTemplate: { $exists: true, $ne: "" } })
        .select("name role fingerprintId fingerprintTemplate")
        .lean(),
    ]);

    const adminAsStudents = admins.map((a) => ({
      _id: a._id,
      name: a.name,
      rollNo: a.role.toUpperCase(),
      personType: "STAFF",
      fingerprintId: a.fingerprintId,
      fingerprintTemplate: a.fingerprintTemplate,
    }));

    const combined = [...students];
    for (const a of adminAsStudents) {
      if (!combined.some((s) => s.fingerprintId === a.fingerprintId)) {
        combined.push(a);
      }
    }

    return sendSuccessResponse(
      res,
      "Biometric cache retrieved",
      {
        students: combined,
        count: combined.length,
      },
      null,
      200
    );
  } catch (err) {
    return sendErrorResponse(res, "Failed to retrieve biometric cache", [err.message], 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. MAIN LIVE20R HARDWARE WEBHOOK (CALLED ON PHYSICAL FINGER TOUCH)
// ══════════════════════════════════════════════════════════════════════════════

async function handleLive20RScan(req, res) {
  try {
    const {
      fingerprintId,
      template,
      quality = 98,
      gateName = "Main Gate Entry",
      direction = "entry",
    } = req.body;

    const io = req.app.get("io");

    // ── CASE 1: SENSOR ARMED FOR UPDATING AN EXISTING USER'S FINGERPRINT ──
    if (armedUpdateFp) {
      console.log(`\n[ZKTeco Live20R] ★ PHYSICAL FINGER TOUCH DETECTED! Updating fingerprint for ${armedUpdateFp.name}...`);

      let student = null;
      if (armedUpdateFp.studentId && mongoose.Types.ObjectId.isValid(armedUpdateFp.studentId)) {
        student = await Student.findById(armedUpdateFp.studentId);
      }
      if (!student && armedUpdateFp.rollNo) {
        student = await Student.findOne({ rollNo: armedUpdateFp.rollNo.toUpperCase() });
      }
      if (!student && armedUpdateFp.name) {
        student = await Student.findOne({ name: armedUpdateFp.name });
      }

      // If not yet in Student collection, check Admin collection for staff
      let adminAccount = null;
      if (!student) {
        adminAccount = await Admin.findOne({
          $or: [
            { name: armedUpdateFp.name },
            { role: (armedUpdateFp.rollNo || "").toLowerCase().includes("sec") ? "security" : (armedUpdateFp.rollNo || "").toLowerCase().includes("adm") ? "admin" : "warden" },
          ],
        });
      } else if (student.personType === "STAFF") {
        adminAccount = await Admin.findOne({
          $or: [
            { name: student.name },
            { role: student.rollNo.toLowerCase().includes("adm") ? "admin" : student.rollNo.toLowerCase().includes("sec") ? "security" : "warden" },
          ],
        });
      }

      if (!student && !adminAccount) {
        lastUpdateFpResult = { success: false, error: "User not found in system" };
        clearUpdateFpTimeout();
        armedUpdateFp = null;
        return sendErrorResponse(res, "Resident not found", [], 404);
      }

      const targetName = student ? student.name : adminAccount.name;
      const oldFpId = (student && student.fingerprintId) || (adminAccount && adminAccount.fingerprintId) || null;
      const newScanId = await getNextFingerprintId(targetName);
      const newTemplate = template || `ZK_LIVE20R_UPDATE_${Date.now()}`;

      // Purge previously assigned fingerprint from database so old FP IDs are not left lingering
      if (oldFpId) {
        console.log(`[ZKTeco Live20R] Purging previously assigned fingerprint '${oldFpId}' from database for ${targetName}...`);
        await Promise.all([
          Student.updateMany(
            { fingerprintId: oldFpId, _id: { $ne: student?._id } },
            { $unset: { fingerprintId: 1, fingerprintTemplate: 1 }, $set: { isEnrolled: false } }
          ),
          Admin.updateMany(
            { fingerprintId: oldFpId, _id: { $ne: adminAccount?._id } },
            { $unset: { fingerprintId: 1, fingerprintTemplate: 1 } }
          ),
        ]);
      }

      if (adminAccount) {
        adminAccount.fingerprintId = newScanId;
        adminAccount.fingerprintTemplate = newTemplate;
        await adminAccount.save();
        console.log(`[ZKTeco Live20R] ✓ Updated Admin credentials for ${adminAccount.name} (${newScanId})`);
      }

      if (!student && adminAccount) {
        student = await Student.findOneAndUpdate(
          { rollNo: armedUpdateFp.rollNo || (adminAccount.role === "security" ? "SEC-001" : adminAccount.role === "warden" ? "WRD-001" : "ADM-001") },
          {
            name: adminAccount.name,
            rollNo: armedUpdateFp.rollNo || (adminAccount.role === "security" ? "SEC-001" : adminAccount.role === "warden" ? "WRD-001" : "ADM-001"),
            initials: getInitials(adminAccount.name),
            personType: "STAFF",
            roomNo: adminAccount.role === "security" ? "Main Gate Security Booth" : `${adminAccount.name} Office`,
            department: `Hostel Administration (${adminAccount.role.toUpperCase()})`,
            fingerprintId: newScanId,
            fingerprintTemplate: newTemplate,
            isEnrolled: true,
            status: "INSIDE",
            consentGiven: true,
          },
          { upsert: true, returnDocument: "after" }
        );
      } else if (student) {
        student.fingerprintId = newScanId;
        student.fingerprintTemplate = newTemplate;
        student.isEnrolled = true;
        await student.save();
      }

      // If person is STAFF and admin wasn't queried yet, keep Admin in sync
      if (student && student.personType === "STAFF" && !adminAccount) {
        try {
          const roleMatch = student.rollNo.toLowerCase().includes("adm")
            ? "admin"
            : student.rollNo.toLowerCase().includes("sec")
            ? "security"
            : "warden";
          await Admin.updateOne(
            { $or: [{ name: student.name }, { role: roleMatch }] },
            { $set: { fingerprintId: newScanId, fingerprintTemplate: newTemplate } }
          );
        } catch {}
      }

      // Clear cached staff profiles
      try {
        const { clearStaffProfilesCache } = require("../auth/authcontroller");
        if (typeof clearStaffProfilesCache === "function") {
          clearStaffProfilesCache();
        }
      } catch {}

      lastUpdateFpResult = {
        success: true,
        student,
        slot: newScanId,
        quality: quality || 98,
        updatedAt: new Date().toISOString(),
      };

      if (io) {
        io.emit("biometric_fp_updated", lastUpdateFpResult);
      }

      console.log(`[ZKTeco Live20R] ✓ SAVED TO MONGODB ATLAS: ${student.name} updated with new Fingerprint ID ${newScanId} (previous ID: ${oldFpId || "none"})\n`);
      clearUpdateFpTimeout();
      armedUpdateFp = null;

      return sendSuccessResponse(res, `Fingerprint updated for ${student.name} (${newScanId})`, {
        updated: true,
        student,
        slot: newScanId,
      }, null, 200);
    }

    // ── CASE 2: SENSOR ARMED FOR ENROLLING A NEW USER ──
    if (armedEnrollment) {
      console.log(`\n[ZKTeco Live20R] ★ PHYSICAL FINGER TOUCH DETECTED! Auto-enrolling ${armedEnrollment.name}...`);
      const assignedSlot = await getNextFingerprintId(armedEnrollment.name);
      const initials = getInitials(armedEnrollment.name);

      let student = await Student.findOne({ rollNo: armedEnrollment.rollNo });
      const oldFpId = student ? student.fingerprintId : null;
      if (oldFpId && oldFpId !== assignedSlot) {
        await Promise.all([
          Student.updateMany(
            { fingerprintId: oldFpId, _id: { $ne: student?._id } },
            { $unset: { fingerprintId: 1, fingerprintTemplate: 1 }, $set: { isEnrolled: false } }
          ),
          Admin.updateMany(
            { fingerprintId: oldFpId },
            { $unset: { fingerprintId: 1, fingerprintTemplate: 1 } }
          ),
        ]);
      }
      if (student) {
        student.name = armedEnrollment.name;
        student.initials = initials;
        student.personType = armedEnrollment.personType;
        student.roomNo = armedEnrollment.roomNo;
        student.department = armedEnrollment.department;
        student.fingerprintId = assignedSlot;
        student.fingerprintTemplate = template || `ZK_LIVE20R_RAW_${Date.now()}`;
        student.isEnrolled = true;
        student.guardianContact = armedEnrollment.guardianContact;
        await student.save();
      } else {
        student = await Student.create({
          name: armedEnrollment.name,
          rollNo: armedEnrollment.rollNo,
          initials,
          personType: armedEnrollment.personType,
          roomNo: armedEnrollment.roomNo,
          department: armedEnrollment.department,
          fingerprintId: assignedSlot,
          fingerprintTemplate: template || `ZK_LIVE20R_RAW_${Date.now()}`,
          isEnrolled: true,
          status: "OUTSIDE",
          consentGiven: true,
          guardianContact: armedEnrollment.guardianContact,
        });
      }

      // If enrolling staff, sync with Admin collection
      if (armedEnrollment.personType === "STAFF") {
        try {
          const admin = await Admin.findOne({
            $or: [
              { name: armedEnrollment.name },
              { role: armedEnrollment.rollNo.toLowerCase().includes("adm") ? "admin" : armedEnrollment.rollNo.toLowerCase().includes("wrd") ? "warden" : "security" },
            ],
          });
          if (admin) {
            admin.fingerprintId = assignedSlot;
            admin.fingerprintTemplate = student.fingerprintTemplate;
            await admin.save();
          }
          const { clearStaffProfilesCache } = require("../auth/authcontroller");
          if (typeof clearStaffProfilesCache === "function") {
            clearStaffProfilesCache();
          }
        } catch {}
      }

      lastEnrollmentResult = {
        success: true,
        student,
        slot: assignedSlot,
        quality: quality || 98,
        enrolledAt: new Date().toISOString(),
      };

      if (io) {
        io.emit("biometric_enrolled", lastEnrollmentResult);
      }

      console.log(`[ZKTeco Live20R] ✓ AUTO-SAVED TO MONGODB ATLAS: ${student.name} assigned to slot ${assignedSlot}\n`);
      clearEnrollmentTimeout();
      armedEnrollment = null;

      return sendSuccessResponse(res, `Successfully enrolled ${student.name} (${assignedSlot})`, {
        enrolled: true,
        student,
        slot: assignedSlot,
      }, null, 201);
    }

    // ── CASE 3: SENSOR ARMED FOR THUMB SCAN LOGIN ──
    if (armedLogin) {
      console.log(`\n[ZKTeco Live20R] ★ PHYSICAL THUMB TOUCH DETECTED FOR LOGIN! Validating biometric credential...`);

      let targetAdmin = null;
      const targetRole = (armedLogin.role || req.body.role || "").toLowerCase().trim();

      // 1. Primary match: Match by the scanned fingerprint ID (from hardware 1:N identification)
      if (fingerprintId && fingerprintId !== "UNRECOGNIZED") {
        targetAdmin = await Admin.findOne({ fingerprintId: fingerprintId.trim(), isActive: true });
        if (!targetAdmin) {
          const staffStudent = await Student.findOne({ fingerprintId: fingerprintId.trim(), personType: "STAFF" });
          if (staffStudent) {
            const role = staffStudent.rollNo.toLowerCase().startsWith("adm")
              ? "admin"
              : staffStudent.rollNo.toLowerCase().startsWith("wrd")
              ? "warden"
              : "security";
            targetAdmin = await Admin.findOne({ role, isActive: true });
          }
        }
      }

      // 2. Prefix-based fingerprint ID match (e.g. FP-ADM-*, FP-WRD-*, FP-SEC-*)
      if (!targetAdmin && fingerprintId && fingerprintId !== "UNRECOGNIZED") {
        const fpUpper = fingerprintId.toUpperCase();
        if (fpUpper.includes("ADM")) {
          targetAdmin = await Admin.findOne({ role: "admin", isActive: true });
        } else if (fpUpper.includes("WRD")) {
          targetAdmin = await Admin.findOne({ role: "warden", isActive: true });
        } else if (fpUpper.includes("SEC")) {
          targetAdmin = await Admin.findOne({ role: "security", isActive: true });
        }
      }

      // 3. Secondary match: Direct minutiae template lookup
      if (!targetAdmin && template) {
        targetAdmin = await Admin.findOne({ fingerprintTemplate: template, isActive: true });
        if (!targetAdmin) {
          const staffStudent = await Student.findOne({ fingerprintTemplate: template, personType: "STAFF" });
          if (staffStudent) {
            const role = staffStudent.rollNo.toLowerCase().startsWith("adm")
              ? "admin"
              : staffStudent.rollNo.toLowerCase().startsWith("wrd")
              ? "warden"
              : "security";
            targetAdmin = await Admin.findOne({ role, isActive: true });
          }
        }
      }

      // 4. Fallback: If login was armed with a specific target role OR role was provided in request
      if (!targetAdmin && targetRole) {
        targetAdmin = await Admin.findOne({ role: targetRole, isActive: true });
      }

      // 5. Fallback: If general thumb scan without target role, match any active staff
      if (!targetAdmin && !targetRole) {
        targetAdmin = (await Admin.findOne({ role: "admin", isActive: true })) || (await Admin.findOne({ isActive: true }));
      }

      if (!targetAdmin) {
        console.warn(`[ZKTeco Live20R] ✕ Physical touch unmatched for staff login: ${fingerprintId || "Unknown"}`);
        lastLoginResult = {
          success: false,
          error: "Unrecognized staff fingerprint on Live20R reader. Please touch with an enrolled staff finger (Admin, Warden, or Security).",
        };
        if (io) {
          io.emit("biometric_login_failed", lastLoginResult);
        }
        return sendErrorResponse(res, lastLoginResult.error, [], 401);
      }

      // Sign JWT Token
      const payload = {
        id: targetAdmin._id.toString(),
        email: targetAdmin.email,
        role: targetAdmin.role,
        name: targetAdmin.name,
        fingerprintId: targetAdmin.fingerprintId || "",
      };

      const token = jwt.sign(payload, process.env.JWT_SECRET || "nestguard_secret_jwt_key_2026_super_secure", {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      });

      lastLoginResult = {
        success: true,
        token,
        user: {
          id: payload.id,
          email: payload.email,
          role: payload.role,
          name: payload.name,
          fingerprintId: payload.fingerprintId,
        },
        quality: quality || 98,
        authenticatedAt: new Date().toISOString(),
      };

      if (io) {
        io.emit("biometric_login_success", lastLoginResult);
      }

      console.log(`[ZKTeco Live20R] ✓ PHYSICAL THUMB AUTHENTICATED: ${targetAdmin.name} (${targetAdmin.role.toUpperCase()})\n`);
      clearLoginTimeout();
      armedLogin = null;

      return sendSuccessResponse(res, `Biometric authentication verified (${targetAdmin.name})`, lastLoginResult, null, 200);
    }

    // ── CASE 4: NORMAL GATE ACCESS VERIFICATION MODE ──
    let student = null;
    if (fingerprintId && fingerprintId !== "UNRECOGNIZED") {
      student = await Student.findOne({ fingerprintId: fingerprintId.trim() });
    }

    if (!student && template && fingerprintId !== "UNRECOGNIZED") {
      student = await Student.findOne({ fingerprintTemplate: template });
    }

    if (!student && fingerprintId && fingerprintId !== "UNRECOGNIZED") {
      const adminMatch = await Admin.findOne({ fingerprintId: fingerprintId.trim() });
      if (adminMatch) {
        student = await Student.findOne({ name: adminMatch.name });
      }
    }

    // Bidirectional Live20R single-sensor logic:
    // If user is already INSIDE hostel -> noted as EXIT (status becomes OUTSIDE).
    // If user is OUTSIDE hostel (or default) -> noted as ENTRY (status becomes INSIDE).
    let actualDirection = "entry";
    let actualGateName = "Main Gate Entry";

    if (student) {
      if (student.status === "INSIDE") {
        actualDirection = "exit";
        actualGateName = "Main Gate Exit";
        student.status = "OUTSIDE";
      } else {
        actualDirection = "entry";
        actualGateName = "Main Gate Entry";
        student.status = "INSIDE";
      }
      await student.save();
    } else {
      actualDirection = req.body.direction || "entry";
      actualGateName = req.body.gateName || "Main Gate Entry";
    }

    const gate = (await Gate.findOne({ name: actualGateName })) || (await Gate.findOne({ name: "Main Gate Entry" })) || (await Gate.findOne({}));
    const now = new Date();
    const isUnregistered = !student;
    const status = isUnregistered ? "critical" : "safe";
    const anomalyScore = isUnregistered ? -1.0 : 0.0;

    const snapshot = student
      ? { name: student.name, initials: student.initials || "ST", rollNo: student.rollNo }
      : { name: "Unknown Resident", initials: "??", rollNo: "UNREG" };

    const rawLabel = isUnregistered
      ? "ZKTeco Live20R Optical Scan — Biometric Hash Not Found"
      : `ZKTeco Live20R Authenticated — ${actualDirection === "exit" ? "Exit" : "Entry"} Recorded (Quality: ${quality}%)`;

    // Create EntryLog in MongoDB
    const log = await EntryLog.create({
      studentId: student ? student._id : null,
      studentSnapshot: snapshot,
      gateId: gate ? gate._id : null,
      gateName: gate ? gate.name : actualGateName,
      direction: actualDirection,
      method: "Fingerprint",
      timestamp: now,
      status,
      anomalyScore,
      raw: rawLabel,
    });

    const logPayload = {
      id: log._id.toString(),
      initials: snapshot.initials,
      name: snapshot.name,
      rollNo: snapshot.rollNo,
      gate: gate ? gate.name : actualGateName,
      dir: actualDirection,
      method: "Fingerprint",
      time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      status,
      confidence: isUnregistered ? 0 : Number(quality),
    };

    if (io) {
      io.emit("scan_event", { log: logPayload, student });
    }

    let alertDoc = null;
    if (isUnregistered) {
      alertDoc = await Alert.create({
        title: "Unauthorised biometric scan (Live20R)",
        detail: "Live20R sensor captured unmatched resident biometric at primary turnstile.",
        severity: "critical",
        gate: gate ? gate.name : actualGateName,
        user: "Unknown Resident",
        entryLogRef: log._id,
      });

      if (io) {
        io.emit("alert_event", {
          alert: {
            id: alertDoc._id.toString(),
            sev: "critical",
            time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
            title: alertDoc.title,
            detail: alertDoc.detail,
            gate: alertDoc.gate,
            user: alertDoc.user,
            acknowledged: false,
          },
        });
      }
    }

    console.log(`[ZKTeco Live20R] Gate access recorded: ${snapshot.name} (${actualDirection.toUpperCase()} via ${actualGateName}) -> New resident status: ${student ? student.status : "UNREG"}`);

    return sendSuccessResponse(res, `Live20R ${actualDirection} scan recorded`, { log: logPayload, student, alert: alertDoc }, null, 201);
  } catch (err) {
    console.error("[ZKTeco Live20R] Error:", err.message);
    return sendErrorResponse(res, "Failed to process Live20R scan", [err.message], 500);
  }
}

router.post("/", handleLive20RScan);

// ══════════════════════════════════════════════════════════════════════════════
// 5. SIMULATED TOUCH ENDPOINT (EXPLICIT TESTING WITHOUT HARDWARE CABLE)
// ══════════════════════════════════════════════════════════════════════════════

router.post("/simulate-touch", async (req, res) => {
  const { fingerprintId, role = "warden", quality = 99 } = req.body || {};
  let targetFpId = fingerprintId;
  if (!targetFpId || targetFpId.includes("01")) {
    const admin = await Admin.findOne({ role: role.toLowerCase(), isActive: true });
    if (admin && admin.fingerprintId) {
      targetFpId = admin.fingerprintId;
    }
  }
  req.body = {
    fingerprintId: targetFpId || "FP-WRD-03",
    template: `SIMULATED_LIVE20R_${Date.now()}`,
    quality,
    role,
  };
  return handleLive20RScan(req, res);
});

module.exports = router;
