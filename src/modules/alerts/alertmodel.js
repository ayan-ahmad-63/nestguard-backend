const mongoose = require("mongoose");

const alertSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Alert title is required"],
      trim: true,
    },
    detail: {
      type: String,
      default: "",
    },
    severity: {
      type: String,
      enum: ["critical", "attention"],
      required: true,
    },
    gate: {
      type: String,
      default: "",
    },
    // Name only — never the student's CNIC or sensitive personal data
    user: {
      type: String,
      default: "Unknown",
    },
    acknowledged: {
      type: Boolean,
      default: false,
    },
    // Link back to the log entry that generated this alert
    entryLogRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EntryLog",
      default: null,
    },
  },
  { timestamps: true }
);

alertSchema.index({ acknowledged: 1, createdAt: -1 });
alertSchema.index({ severity: 1, createdAt: -1 });

module.exports = mongoose.model("Alert", alertSchema);
