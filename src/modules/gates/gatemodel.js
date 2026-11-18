const mongoose = require("mongoose");

const gateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Gate name is required"],
      unique: true,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["safe", "attention", "critical", "offline"],
      default: "safe",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Phase-II: dual readers, reed sensor, battery telemetry
  },
  { timestamps: true }
);

module.exports = mongoose.model("Gate", gateSchema);
