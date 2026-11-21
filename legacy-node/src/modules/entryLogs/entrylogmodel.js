const mongoose = require("mongoose");

const entryLogSchema = new mongoose.Schema(
  {
    // Who scanned — optional so unrecognised scans can still be logged
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
    },
    studentSnapshot: {
      // Snapshot so the log stays readable even if the student is deleted
      name: { type: String, default: "Unknown Person" },
      initials: { type: String, default: "??" },
      rollNo: { type: String, default: "UNREG" },
    },
    gateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Gate",
      required: true,
    },
    gateName: {
      type: String,
      required: true,
    },
    direction: {
      type: String,
      enum: ["entry", "exit"],
      required: true,
    },
    method: {
      type: String,
      enum: ["Fingerprint", "Card", "Manual", "None"],
      default: "Fingerprint",
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["safe", "attention", "critical"],
      default: "safe",
    },
    // Rule-based anomaly score: -1.0 (critical) … 0.0 (clean)
    // Phase-II: replace with per-student ML baseline
    anomalyScore: {
      type: Number,
      default: 0,
    },
    // Human-readable label shown in the live feed
    raw: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

// Index for dashboard queries
entryLogSchema.index({ timestamp: -1 });
entryLogSchema.index({ studentId: 1, timestamp: -1 });
entryLogSchema.index({ status: 1, timestamp: -1 });
entryLogSchema.index({ gateName: 1, timestamp: -1 });

module.exports = mongoose.model("EntryLog", entryLogSchema);
