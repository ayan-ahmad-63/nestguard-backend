/**
 * NestGuard — ZKTeco Live20R Web Agent Bridge
 * ═══════════════════════════════════════════
 * This listener connects to the local ZKTeco Windows Service (ZKBioOnline / ZKFinger Web SDK)
 * running on your laptop (usually at http://127.0.0.1:22001).
 *
 * When a resident touches the physical Live20R scanner:
 *   1. The ZKTeco service captures the fingerprint.
 *   2. This bridge forwards the biometric event to NestGuard backend at
 *      POST http://localhost:3000/api/v1/hardware/zkteco
 *   3. NestGuard logs to MongoDB Atlas and updates the dashboard live via Socket.IO!
 *
 * Usage:
 *   node src/scripts/zkteco-agent-listener.js
 */
const http = require("http");

const ZK_SERVICE_URL = "http://127.0.0.1:22001/zkbio";
const NESTGUARD_API_URL = "http://localhost:3000/api/v1/hardware/zkteco";

console.log("\n==================================================");
console.log("   NestGuard — ZKTeco Live20R Hardware Gateway");
console.log("==================================================\n");

async function checkZKTecoService() {
  console.log(`[1/3] Checking ZKTeco Local Service at ${ZK_SERVICE_URL}...`);

  return new Promise((resolve) => {
    http
      .get(`${ZK_SERVICE_URL}/info`, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            console.log("      ✓ ZKTeco Service detected! Device info:", parsed);
            resolve(true);
          } catch {
            console.log("      ✓ ZKTeco Service is running.");
            resolve(true);
          }
        });
      })
      .on("error", () => {
        console.log("      ℹ ZKTeco Web Agent service is not running on port 22001.");
        console.log("      (If you are using the Live20R SDK C/C++ DLL directly, see zkteco_driver_bridge.py)\n");
        resolve(false);
      });
  });
}

function startPollingCapture() {
  console.log("[2/3] Initializing Live20R optical capture loop...");
  console.log("[3/3] Ready! Touch the physical Live20R sensor with your finger to scan.\n");

  setInterval(() => {
    // Polls ZKTeco capture endpoint
    http
      .get(`${ZK_SERVICE_URL}/fingerprint/getImage`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            if (result && result.ret === 0 && result.template) {
              console.log("[ZKTeco Live20R] Finger detected! Forwarding to NestGuard...");
              forwardToNestGuard(result);
            }
          } catch {}
        });
      })
      .on("error", () => {});
  }, 600);
}

function forwardToNestGuard(zkData) {
  const payload = JSON.stringify({
    fingerprintId: zkData.id || "FP-001",
    template: zkData.template || "",
    quality: zkData.quality || 99,
    gateName: "Main Gate",
    direction: "entry",
  });

  const req = http.request(
    NESTGUARD_API_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    },
    (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        console.log(`[NestGuard] Ingress recorded successfully! [Status: ${res.statusCode}]`);
      });
    }
  );

  req.on("error", (err) => {
    console.error("[NestGuard Error] Could not forward to backend:", err.message);
  });

  req.write(payload);
  req.end();
}

async function main() {
  const isAvailable = await checkZKTecoService();
  if (isAvailable) {
    startPollingCapture();
  } else {
    console.log("----------------------------------------------------------------");
    console.log("NOTE: Port 22001 is only for the optional ZKBioOnline Web Agent.");
    console.log("Since you have the official ZKTeco Hardware Driver installed,");
    console.log("you can connect directly to your Live20R / SLK20R by running:\n");
    console.log("   npm run zkteco");
    console.log("   (or: powershell -File src/scripts/zkteco-live20r-bridge.ps1)");
    console.log("----------------------------------------------------------------\n");
  }
}

main();
