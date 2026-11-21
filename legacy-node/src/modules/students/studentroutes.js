const express = require("express");
const router = express.Router();
const studentController = require("./studentcontroller");
const authMiddleware = require("../../middleware/authmiddleware");
const { requireRole } = require("../../middleware/rolemiddleware");

// Read access (used by frontend and local hardware biometric cache sync)
router.get("/", studentController.listStudents);
router.get("/:id", studentController.getStudentById);

// Protected mutation routes (Admin and Warden only)
router.post("/enroll", authMiddleware, requireRole("admin", "warden"), studentController.enrollStudent);
router.put("/:id", authMiddleware, requireRole("admin", "warden"), studentController.updateStudent);
router.delete("/:id", authMiddleware, requireRole("admin", "warden"), studentController.deleteStudent);

module.exports = router;
