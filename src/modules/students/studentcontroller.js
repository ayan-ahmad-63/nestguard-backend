const Student = require("./studentmodel");
const { sendSuccessResponse } = require("../../shared/responses/success");
const { sendErrorResponse } = require("../../shared/responses/error");

/**
 * Generate 2-3 letter initials from full name
 */
function getInitials(name) {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Find next available fingerprint ID respective to the user's name (e.g. FP-AM-01, FP-ZK-01)
 */
async function getNextFingerprintId(name) {
  let code = "USR";
  if (name && typeof name === "string") {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      code = parts[0].substring(0, 3).toUpperCase();
    } else {
      code = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
  }

  const prefix = `FP-${code}`;
  const regex = new RegExp(`^${prefix}-\\d+$`);
  const existing = await Student.find({ fingerprintId: regex }).select("fingerprintId");
  let maxNum = 0;
  for (const s of existing) {
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

/**
 * GET /api/v1/students
 * List all registered students and permanent workers
 */
const listStudents = async (req, res) => {
  const { personType, enrolled } = req.query;
  const filter = {};
  if (personType) filter.personType = personType.toUpperCase();
  if (enrolled !== undefined) filter.isEnrolled = enrolled === "true";

  const students = await Student.find(filter)
    .sort({ createdAt: -1 })
    .lean();
  return sendSuccessResponse(res, "Residents retrieved successfully", {
    students,
    count: students.length,
  }, null, 200);
};

/**
 * POST /api/v1/students/enroll
 * Enroll a new student or permanent worker with biometric details
 */
const enrollStudent = async (req, res) => {
  const {
    name,
    rollNo,
    personType = "STUDENT",
    roomNo = "Unassigned",
    department = "General",
    guardianEmail,
    guardianPhone,
    guardianName,
    fingerprintId,
    template,
  } = req.body;

  if (!name || !rollNo) {
    return sendErrorResponse(res, "Name and Roll No / Worker ID are required", [], 400);
  }

  // Check if rollNo already exists
  let student = await Student.findOne({ rollNo: rollNo.trim().toUpperCase() });
  const initials = getInitials(name);
  const fpId = fingerprintId ? fingerprintId.trim() : (await getNextFingerprintId(name));

  const validTypes = ["STUDENT", "WORKER", "STAFF"];
  const pType = validTypes.includes(personType?.toUpperCase()) ? personType.toUpperCase() : "STUDENT";

  if (student) {
    // Purge old fingerprint ID from any other records if ID changed
    const oldFpId = student.fingerprintId;
    if (oldFpId && oldFpId !== fpId) {
      await Promise.all([
        Student.updateMany(
          { fingerprintId: oldFpId, _id: { $ne: student._id } },
          { $unset: { fingerprintId: 1, fingerprintTemplate: 1 }, $set: { isEnrolled: false } }
        ),
        Admin.updateMany(
          { fingerprintId: oldFpId },
          { $unset: { fingerprintId: 1, fingerprintTemplate: 1 } }
        ),
      ]);
    }

    // Update existing resident's enrollment details
    student.name = name.trim();
    student.initials = initials;
    student.personType = pType;
    student.roomNo = roomNo;
    student.department = department;
    student.fingerprintId = fpId;
    if (template) student.fingerprintTemplate = template;
    student.isEnrolled = true;
    if (guardianEmail || guardianPhone || guardianName) {
      student.guardianContact = {
        name: guardianName || student.guardianContact?.name || "",
        phone: guardianPhone || student.guardianContact?.phone || "",
        email: guardianEmail || student.guardianContact?.email || "",
      };
    }
    await student.save();

    if (pType === "STAFF") {
      try {
        const Admin = require("../admins/adminmodel");
        const rolePrefix = student.rollNo.toLowerCase().startsWith("adm")
          ? "admin"
          : student.rollNo.toLowerCase().startsWith("wrd")
          ? "warden"
          : student.rollNo.toLowerCase().startsWith("sec")
          ? "security"
          : null;

        await Admin.updateOne(
          {
            $or: [
              { name: student.name },
              ...(rolePrefix ? [{ role: rolePrefix }] : []),
            ],
          },
          {
            $set: {
              name: student.name,
              fingerprintId: fpId,
              ...(template ? { fingerprintTemplate: template } : {}),
            },
          }
        );
        const { clearStaffProfilesCache } = require("../auth/authcontroller");
        if (typeof clearStaffProfilesCache === "function") {
          clearStaffProfilesCache();
        }
      } catch (e) {
        console.warn("Could not sync Admin on staff enrollment:", e.message);
      }
    }

    return sendSuccessResponse(res, `Updated enrollment for ${student.name} (${student.rollNo})`, {
      student,
    }, null, 200);
  }

  // Create new resident enrollment
  student = await Student.create({
    name: name.trim(),
    rollNo: rollNo.trim().toUpperCase(),
    initials,
    personType: pType,
    roomNo,
    department,
    fingerprintId: fpId,
    fingerprintTemplate: template || "",
    isEnrolled: true,
    status: "OUTSIDE",
    guardianContact: {
      name: guardianName || "",
      phone: guardianPhone || "",
      email: guardianEmail || "",
    },
  });

  return sendSuccessResponse(res, `Successfully enrolled ${student.name} (${student.rollNo}) with ID ${fpId}`, {
    student,
  }, null, 201);
};

/**
 * GET /api/v1/students/:id
 */
const getStudentById = async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) {
    return sendErrorResponse(res, "Resident not found", [], 404);
  }
  return sendSuccessResponse(res, "Resident retrieved successfully", { student }, null, 200);
};

/**
 * PUT /api/v1/students/:id
 * Update any enrolled student, worker, or staff record
 */
const updateStudent = async (req, res) => {
  const { id } = req.params;
  const {
    name,
    rollNo,
    personType,
    roomNo,
    department,
    fingerprintId,
    fingerprintTemplate,
    guardianName,
    guardianPhone,
    guardianEmail,
    guardianContact,
  } = req.body;

  const student = await Student.findById(id);
  if (!student) {
    return sendErrorResponse(res, "Resident not found", [], 404);
  }

  if (name) {
    student.name = name.trim();
    student.initials = getInitials(name);
  }
  if (rollNo) student.rollNo = rollNo.trim().toUpperCase();
  if (personType) student.personType = personType.toUpperCase();
  if (roomNo !== undefined) student.roomNo = roomNo.trim();
  if (department !== undefined) student.department = department.trim();

  // Handle fingerprint ID or template update
  const oldFpId = student.fingerprintId;
  let newFpId = fingerprintId ? fingerprintId.trim() : null;
  if (fingerprintTemplate && !fingerprintId) {
    newFpId = await getNextFingerprintId(student.name);
  }

  if (newFpId && oldFpId && newFpId !== oldFpId) {
    console.log(`[Student Controller] Purging previously assigned fingerprint '${oldFpId}' from database for ${student.name}...`);
    await Promise.all([
      Student.updateMany(
        { fingerprintId: oldFpId, _id: { $ne: student._id } },
        { $unset: { fingerprintId: 1, fingerprintTemplate: 1 }, $set: { isEnrolled: false } }
      ),
      Admin.updateMany(
        { fingerprintId: oldFpId },
        { $unset: { fingerprintId: 1, fingerprintTemplate: 1 } }
      ),
    ]);
  }

  if (newFpId) student.fingerprintId = newFpId;
  if (fingerprintTemplate) {
    student.fingerprintTemplate = fingerprintTemplate;
    student.isEnrolled = true;
  }

  const gName = guardianName || guardianContact?.name;
  const gPhone = guardianPhone || guardianContact?.phone;
  const gEmail = guardianEmail || guardianContact?.email;

  if (gName !== undefined || gPhone !== undefined || gEmail !== undefined) {
    student.guardianContact = {
      name: gName !== undefined ? gName : student.guardianContact?.name || "",
      phone: gPhone !== undefined ? gPhone : student.guardianContact?.phone || "",
      email: gEmail !== undefined ? gEmail : student.guardianContact?.email || "",
    };
  }

  await student.save();

  // If this student is STAFF, also synchronize the Admin collection
  if (student.personType === "STAFF") {
    try {
      const Admin = require("../admins/adminmodel");
      const rolePrefix = student.rollNo.toLowerCase().startsWith("adm")
        ? "admin"
        : student.rollNo.toLowerCase().startsWith("wrd")
        ? "warden"
        : student.rollNo.toLowerCase().startsWith("sec")
        ? "security"
        : null;

      await Admin.updateOne(
        {
          $or: [
            { name: student.name },
            ...(rolePrefix ? [{ role: rolePrefix }] : []),
          ],
        },
        {
          $set: {
            ...(name ? { name: name.trim() } : {}),
            fingerprintId: student.fingerprintId,
            ...(student.fingerprintTemplate ? { fingerprintTemplate: student.fingerprintTemplate } : {}),
          },
        }
      );
      const { clearStaffProfilesCache } = require("../auth/authcontroller");
      if (typeof clearStaffProfilesCache === "function") {
        clearStaffProfilesCache();
      }
      console.log(`[Student Controller] Synchronized Admin credentials with staff update (${student.name} -> ${student.fingerprintId})`);
    } catch (e) {
      console.warn("Could not sync Admin record with staff student update:", e.message);
    }
  }

  return sendSuccessResponse(res, `Updated details for ${student.name}`, { student }, null, 200);
};

/**
 * DELETE /api/v1/students/:id
 */
const deleteStudent = async (req, res) => {
  const student = await Student.findByIdAndDelete(req.params.id);
  if (!student) {
    return sendErrorResponse(res, "Resident not found", [], 404);
  }

  // Purge any associated fingerprint records so no lingering ID remains
  if (student.fingerprintId) {
    try {
      const Admin = require("../admins/adminmodel");
      await Admin.updateMany(
        { fingerprintId: student.fingerprintId },
        { $unset: { fingerprintId: 1, fingerprintTemplate: 1 } }
      );
      const { clearStaffProfilesCache } = require("../auth/authcontroller");
      if (typeof clearStaffProfilesCache === "function") {
        clearStaffProfilesCache();
      }
    } catch {}
  }

  return sendSuccessResponse(res, `Resident ${student.name} deleted successfully`, null, null, 200);
};

module.exports = {
  listStudents,
  enrollStudent,
  getStudentById,
  updateStudent,
  deleteStudent,
};
