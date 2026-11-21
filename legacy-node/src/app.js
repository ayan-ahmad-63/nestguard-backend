require("express-async-errors");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

// ── Rate Limiters ──
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    statusCode: 429,
    message: "Too many authentication attempts. Please try again after 15 minutes.",
  },
});

// ── Middleware ──
const authMiddleware = require("./middleware/authmiddleware");
const errorMiddleware = require("./middleware/errormiddleware");

// ── Route modules ──
const healthRoutes = require("./routes/health/healthroutes");
const authRoutes = require("./modules/auth/authroutes");
const entryLogRoutes = require("./modules/entryLogs/entrylogroutes");
const alertRoutes = require("./modules/alerts/alertroutes");
const gateRoutes = require("./modules/gates/gateroutes");
const zktecoRoutes = require("./modules/devices/zktecoroutes");
const studentRoutes = require("./modules/students/studentroutes");

const app = express();

// Disable ETags globally to eliminate 304 Not Modified responses on dynamic API resources
app.set("etag", false);

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5000";

app.use(
  cors({
    origin: [
      CLIENT_URL,
      "http://localhost:5000",
      "http://localhost:8000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:5173",
    ],
    credentials: true,
  })
);
app.use(helmet());
app.use(morgan("dev"));

// Prevent HTTP 304 caching — ensure clients always receive fresh 200 OK payloads with latest biometrics & records
app.use((req, res, next) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
  next();
});

app.use(compression());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Public routes ──
app.use("/api/v1/health-check", healthRoutes);
app.use("/api/v1/auth/login", authLimiter);
app.use("/api/v1/auth/biometric-login", authLimiter);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/hardware/zkteco", zktecoRoutes);
app.use("/api/v1/students", studentRoutes);

// ── Protected routes (auth required) ──
app.use("/api/v1/entry-logs", authMiddleware, entryLogRoutes);
app.use("/api/v1/alerts", authMiddleware, alertRoutes);
app.use("/api/v1/gates", authMiddleware, gateRoutes);

// ── Global error handler (must be last) ──
app.use(errorMiddleware);

module.exports = app;
