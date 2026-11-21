const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

let bridgeProcess = null;

/**
 * Automatically launches the ZKTeco Live20R / SLK20R USB Hardware Bridge on Windows
 */
function initLive20RBridge() {
  if (process.platform !== "win32") {
    console.log("[Live20R Gateway] Platform is not Windows; skipping native Live20R USB driver bridge.");
    return;
  }

  if (process.env.ENABLE_LIVE20R === "false") {
    console.log("[Live20R Gateway] Live20R hardware bridge disabled via ENABLE_LIVE20R=false.");
    return;
  }

  const dll64 = "C:\\Windows\\System32\\libzkfpcsharp.dll";
  const dll32 = "C:\\Windows\\SysWOW64\\libzkfpcsharp.dll";

  if (!fs.existsSync(dll64) && !fs.existsSync(dll32)) {
    console.log("[Live20R Gateway] ZKTeco driver DLLs not found in System32. Bridge skipped (SDK not installed).");
    return;
  }

  const scriptPath = path.resolve(__dirname, "../../scripts/zkteco-live20r-bridge.ps1");
  if (!fs.existsSync(scriptPath)) {
    console.warn(`[Live20R Gateway] Script not found at ${scriptPath}`);
    return;
  }

  console.log("[Live20R Gateway] Starting physical ZKTeco Live20R USB bridge daemon...");

  try {
    bridgeProcess = spawn("powershell.exe", [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    bridgeProcess.stdout.on("data", (data) => {
      const lines = data.toString().trim().split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) {
          console.log(`[Live20R] ${line}`);
        }
      }
    });

    bridgeProcess.stderr.on("data", (data) => {
      const err = data.toString().trim();
      if (err) {
        console.warn(`[Live20R Warning] ${err}`);
      }
    });

    bridgeProcess.on("exit", (code, signal) => {
      console.log(`[Live20R Gateway] Bridge process exited (code: ${code}, signal: ${signal})`);
      bridgeProcess = null;
    });

    bridgeProcess.on("error", (err) => {
      console.warn(`[Live20R Gateway] Bridge process error: ${err.message}`);
      bridgeProcess = null;
    });

    const cleanup = () => {
      if (bridgeProcess && !bridgeProcess.killed) {
        try {
          bridgeProcess.kill("SIGKILL");
        } catch {}
      }
    };

    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  } catch (err) {
    console.warn(`[Live20R Gateway] Failed to launch bridge: ${err.message}`);
  }
}

module.exports = { initLive20RBridge };
