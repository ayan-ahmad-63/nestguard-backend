const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const Student = require("../students/studentmodel");
const Gate = require("../gates/gatemodel");
const EntryLog = require("../entryLogs/entrylogmodel");
const Alert = require("../alerts/alertmodel");

let activePort = null;

/**
 * Initializes the hardware serial bridge for Arduino / ESP32 optical fingerprint readers (R307/AS608/FPM10A)
 * @param {import("socket.io").Server} io
 */
function initSerialBridge(io) {
  const portName = process.env.SERIAL_PORT || "COM3";
  const baudRate = Number(process.env.SERIAL_BAUD_RATE) || 57600;

  SerialPort.list()
    .then((ports) => {
      const match = ports.find((p) => p.path.toUpperCase() === portName.toUpperCase());

      if (!match && ports.length === 0) {
        console.log(`[Hardware Bridge] No serial device detected on ${portName}. Ready for simulated scans.`);
        return;
      }

      const targetPath = match ? match.path : ports[0].path;
      console.log(`[Hardware Bridge] Connecting to fingerprint reader on ${targetPath} @ ${baudRate} baud...`);

      activePort = new SerialPort({
        path: targetPath,
        baudRate,
        autoOpen: true,
      });

      const parser = activePort.pipe(new ReadlineParser({ delimiter: "\r\n" }));

      activePort.on("open", () => {
        console.log(`[Hardware Bridge] ✓ Serial port ${targetPath} open. Listening for fingerprint scans...`);
      });

      activePort.on("error", (err) => {
        console.warn(`[Hardware Bridge] Serial warning:`, err.message);
      });

      parser.on("data", async (line) => {
        const text = line.trim();
        console.log(`[Hardware Bridge] Raw serial received: "${text}"`);
        await processHardwareScan(text, io);
      });
    })
    .catch((err) => {
      console.warn("[Hardware Bridge] Could not enumerate ports:", err.message);
    });
}

/**
 * Parses raw serial output and logs access event
 * Supports formats:
 *   - "FP-001" or "FP-002"
 *   - "ID #1" or "ID: 1" or "ID #2"
 *   - "MATCH:1" or "FP:1"
 *   - Plain integer "1", "2", "3"
 */
async function processHardwareScan(rawText, io) {
  try {
    let fingerprintId = null;

    // Pattern 1: Direct "FP-xxx"
    const fpMatch = rawText.match(/FP-\d+/i);
    if (fpMatch) {
      fingerprintId = fpMatch[0].toUpperCase();
    }

    // Pattern 2: "ID #1" or "ID: 1" or "Found ID #1" or "ID 1"
    const idMatch = rawText.match(/ID\s*[:#]?\s*(\d+)/i);
    if (!fingerprintId && idMatch) {
      const num = parseInt(idMatch[1], 10);
      fingerprintId = `FP-${String(num).padStart(3, "0")}`;
    }

    // Pattern 3: Pure number e.g. "1" or "2"
    if (!fingerprintId && /^\d+$/.test(rawText)) {
      const num = parseInt(rawText, 10);
      fingerprintId = `FP-${String(num).padStart(3, "0")}`;
    }

    if (!fingerprintId) {
      console.log(`[Hardware Bridge] Ignoring non-fingerprint telemetry line: "${rawText}"`);
      return;
    }

    console.log(`[Hardware Bridge] Fingerprint identified: ${fingerprintId}`);

    // Resolve student
    const student = await Student.findOne({ fingerprintId });
    const gate = (await Gate.findOne({ name: "Main Gate" })) || (await Gate.findOne({}));

    const now = new Date();
    const isUnregistered = !student;
    const status = isUnregistered ? "critical" : "safe";
    const anomalyScore = isUnregistered ? -1.0 : 0.0;

    const snapshot = student
      ? { name: student.name, initials: student.initials || "ST", rollNo: student.rollNo }
      : { name: "Unknown Resident", initials: "??", rollNo: "UNREG" };

    const rawLabel = isUnregistered
      ? "Unknown biometric pattern — No match in registry"
      : "Hardware authenticated ingress";

    const log = await EntryLog.create({
      studentId: student ? student._id : null,
      studentSnapshot: snapshot,
      gateId: gate ? gate._id : null,
      gateName: gate ? gate.name : "Main Gate",
      direction: "entry",
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
      gate: gate ? gate.name : "Main Gate",
      dir: "entry",
      method: "Fingerprint",
      time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      status,
      confidence: isUnregistered ? 0 : 99.2,
    };

    if (io) {
      io.emit("scan_event", { log: logPayload });
    }

    if (isUnregistered) {
      const alertDoc = await Alert.create({
        title: "Unauthorised access attempt",
        detail: "Biometric pattern placed on scanner with no match in institutional registry.",
        severity: "critical",
        gate: gate ? gate.name : "Main Gate",
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

    console.log(`[Hardware Bridge] ✓ Live scan emitted: ${snapshot.name} (${status.toUpperCase()})`);
  } catch (err) {
    console.error("[Hardware Bridge] Error processing scan:", err.message);
  }
}

module.exports = { initSerialBridge };
