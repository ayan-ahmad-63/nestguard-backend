const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const connectDB = require("./database/connection/connection");
const { initSerialBridge } = require("./modules/devices/serialbridge");
const { initLive20RBridge } = require("./modules/devices/live20rbridge");

const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5000";

// Global server boot timestamp for client session invalidation on restart
global.SERVER_BOOT_TIME = Date.now();

const httpServer = http.createServer(app);

// ── Socket.IO ──────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: [
      CLIENT_URL,
      "http://localhost:5000",
      "http://localhost:8000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:5173",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Make io available to controllers via req.app.get("io")
app.set("io", io);

io.on("connection", (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  // Emit server boot time to client to verify session validity
  socket.emit("server_boot", { serverBootTime: global.SERVER_BOOT_TIME });

  socket.on("disconnect", (reason) => {
    console.log(`[Socket.IO] Client disconnected (${socket.id}): ${reason}`);
  });

  // Hardware gateway can emit raw scan events directly via socket
  socket.on("gateway_scan", (data) => {
    if (!data || !data.log || typeof data.log !== "object") {
      console.warn(`[Socket.IO] Rejected invalid gateway_scan from ${socket.id}`);
      return;
    }
    console.log(`[Socket.IO] Verified gateway_scan broadcast from ${socket.id}:`, data.log.name || "Access Event");
    // Re-broadcast to all connected dashboard clients
    io.emit("scan_event", data);
  });
});

const { execSync } = require("child_process");

function freePortOnWindows(port) {
  if (process.platform !== "win32") return;
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const lines = output.trim().split(/\r?\n/);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      if (pid && pid !== process.pid && !isNaN(pid)) {
        console.log(`[Port Manager] Port ${port} is occupied by stale process PID ${pid}. Terminating it...`);
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
          console.log(`[Port Manager] Successfully terminated stale PID ${pid}.`);
        } catch {}
      }
    }
  } catch {}
}

// ── Start ──────────────────────────────────────────────────────────────────
let isRetrying = false;

httpServer.on("error", (err) => {
  if (err.code === "EADDRINUSE" && !isRetrying) {
    isRetrying = true;
    console.warn(`\n[Server Warning] Port ${PORT} is already in use (EADDRINUSE).`);
    console.log(`[Server] Freeing port ${PORT} from any previous zombie process...`);
    freePortOnWindows(PORT);

    setTimeout(() => {
      try {
        httpServer.close();
      } catch {}
      httpServer.listen(PORT, () => {
        isRetrying = false;
        console.log(`NestGuard Backend API running on port ${PORT}`);
        console.log(`Socket.IO ready — accepting connections from ${CLIENT_URL}`);
        initLive20RBridge();
      });
    }, 1200);
  } else {
    console.error("Server fatal error:", err);
    process.exit(1);
  }
});

// Clean socket shutdown on Nodemon restart (prevents EADDRINUSE on file edit)
process.once("SIGUSR2", () => {
  console.log("\n[Server] Nodemon restart signal (SIGUSR2) received. Releasing port...");
  try {
    httpServer.close(() => {
      process.kill(process.pid, "SIGUSR2");
    });
  } catch {
    process.kill(process.pid, "SIGUSR2");
  }
});

process.on("SIGINT", () => {
  console.log("\n[Server] SIGINT received. Shutting down gracefully...");
  try {
    httpServer.close(() => {
      process.exit(0);
    });
  } catch {
    process.exit(0);
  }
});

process.on("SIGTERM", () => {
  console.log("\n[Server] SIGTERM received. Shutting down gracefully...");
  try {
    httpServer.close(() => {
      process.exit(0);
    });
  } catch {
    process.exit(0);
  }
});

const startServer = async () => {
  try {
    await connectDB();
    initSerialBridge(io);
    httpServer.listen(PORT, () => {
      console.log(`NestGuard Backend API running on port ${PORT}`);
      console.log(`Socket.IO ready — accepting connections from ${CLIENT_URL}`);
      initLive20RBridge();
    });
  } catch (error) {
    console.error("Error starting server:", error.message);
    process.exit(1);
  }
};

startServer();
