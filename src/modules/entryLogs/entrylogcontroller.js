const EntryLog = require("./entrylogmodel");
const Alert = require("../alerts/alertmodel");
const Student = require("../students/studentmodel");
const Gate = require("../gates/gatemodel");
const { sendSuccessResponse } = require("../../shared/responses/success");
const { sendErrorResponse } = require("../../shared/responses/error");

// ── Rule-based anomaly engine ──────────────────────────────────────────────
// Phase-II: replace with per-student ML baseline (Isolation Forest / LSTM).
// For now we use deterministic rules that evaluators can observe and verify.
function evaluateRules(student, direction, timestamp) {
  const hour = new Date(timestamp).getHours();
  const rules = [];
  let status = "safe";
  let anomalyScore = 0;

  // Rule 1 — curfew (22:00–06:00)
  if (hour >= 22 || hour < 6) {
    if (direction === "exit") {
      rules.push("Curfew-hour exit attempt");
      status = "critical";
      anomalyScore = -1.0;
    } else {
      rules.push("Late-night entry");
      status = "attention";
      anomalyScore = -0.5;
    }
  }

  // Rule 2 — no biometric enrolment
  if (student && !student.isEnrolled) {
    rules.push("Student not biometrically enrolled");
    if (status === "safe") { status = "attention"; anomalyScore = -0.3; }
  }

  return { status, anomalyScore, ruleLabels: rules };
}

// ── POST /api/v1/entry-logs/scan ───────────────────────────────────────────
async function handleScan(req, res) {
  const {
    fingerprintId,     // from hardware gateway
    studentId,         // optional direct ObjectId (Postman / simulated mode)
    gateId,
    gateName: bodyGateName,
    method = "Fingerprint",
    direction = "entry",
  } = req.body;

  if (!gateId) {
    return sendErrorResponse(res, "gateId is required", [], 400);
  }

  const now = new Date();

  // ── 1. Resolve gate ──
  let gate = await Gate.findById(gateId);
  if (!gate) {
    return sendErrorResponse(res, "Gate not found", [], 404);
  }

  // ── 2. Resolve student (optional) ──
  let student = null;
  if (studentId) {
    student = await Student.findById(studentId);
  } else if (fingerprintId) {
    student = await Student.findOne({ fingerprintId });
  }

  const snapshot = student
    ? { name: student.name, initials: student.initials || student.name.slice(0, 2).toUpperCase(), rollNo: student.rollNo }
    : { name: "Unknown Person", initials: "??", rollNo: "UNREG" };

  // ── 3. Anomaly evaluation ──
  const { status: ruleStatus, anomalyScore: ruleScore, ruleLabels } = evaluateRules(student, direction, now);

  // Unknown biometric always overrides to critical
  let status = ruleStatus;
  let anomalyScore = ruleScore;
  if (!student) {
    ruleLabels.push("No biometric match in database");
    status = "critical";
    anomalyScore = -1.0;
  }

  const rawLabel = ruleLabels.length ? ruleLabels.join(" | ") : "Normal access";

  // ── 4. Create EntryLog ──
  const log = await EntryLog.create({
    studentId: student ? student._id : null,
    studentSnapshot: snapshot,
    gateId: gate._id,
    gateName: gate.name,
    direction,
    method: student ? method : "None",
    timestamp: now,
    status,
    anomalyScore,
    raw: rawLabel,
  });

  // ── 5. Build frontend-ready payload ──
  // Confidence: (1 + anomalyScore) * 100, clamped 0–100
  const confidence = student
    ? Math.min(100, Math.max(0, Math.round((1 + anomalyScore) * 100 * 10) / 10))
    : 0;

  const logPayload = {
    id: log._id.toString(),
    initials: snapshot.initials,
    name: snapshot.name,
    rollNo: snapshot.rollNo,
    gate: gate.name,
    dir: direction,
    method: log.method,
    time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    status,
    confidence,
  };

  // ── 6. Emit via Socket.IO ──
  const io = req.app.get("io");
  if (io) {
    io.emit("scan_event", { log: logPayload });
  }

  // ── 7. Create Alert for critical/attention events ──
  let alertPayload = null;
  if (status === "critical" || status === "attention") {
    const alertDoc = await Alert.create({
      title: status === "critical"
        ? "Unauthorised access attempt"
        : ruleLabels[0] || "Security attention",
      detail: rawLabel,
      severity: status === "critical" ? "critical" : "attention",
      gate: gate.name,
      user: snapshot.name,
      entryLogRef: log._id,
    });

    alertPayload = {
      id: alertDoc._id.toString(),
      sev: alertDoc.severity,
      time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      title: alertDoc.title,
      detail: alertDoc.detail,
      gate: alertDoc.gate,
      user: alertDoc.user,
      acknowledged: false,
    };

    if (io) {
      io.emit("alert_event", { alert: alertPayload });
    }
  }

  return sendSuccessResponse(
    res,
    "Scan processed",
    { log: logPayload, alert: alertPayload },
    null,
    201
  );
}

// ── GET /api/v1/entry-logs?page=1&limit=20&gate=&status= ──────────────────
async function getLogs(req, res) {
  const { page = 1, limit = 50, gate, status } = req.query;
  const filter = {};
  if (gate) filter.gateName = { $regex: gate, $options: "i" };
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [logs, total] = await Promise.all([
    EntryLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(Number(limit)).lean(),
    EntryLog.countDocuments(filter),
  ]);

  const formatted = logs.map((l) => ({
    id: l._id.toString(),
    initials: l.studentSnapshot?.initials || "??",
    name: l.studentSnapshot?.name || "Unknown",
    rollNo: l.studentSnapshot?.rollNo || "UNREG",
    gate: l.gateName,
    dir: l.direction,
    method: l.method,
    time: new Date(l.timestamp).toLocaleString("en-IN"),
    status: l.status,
    confidence: l.studentId
      ? Math.min(100, Math.max(0, Math.round((1 + l.anomalyScore) * 100 * 10) / 10))
      : 0,
  }));

  return sendSuccessResponse(res, "Logs fetched", formatted, { total, page: Number(page), limit: Number(limit) }, 200);
}

module.exports = { handleScan, getLogs };
