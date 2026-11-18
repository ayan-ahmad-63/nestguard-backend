const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema(
  {
    rollNo: {
      type: String,
      required: [true, "Roll number or Worker ID is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    initials: {
      type: String,
      trim: true,
      maxlength: 4,
    },
    personType: {
      type: String,
      enum: ["STUDENT", "WORKER", "STAFF"],
      default: "STUDENT",
    },
    roomNo: {
      type: String,
      trim: true,
      default: "Unassigned",
    },
    department: {
      type: String,
      trim: true,
      default: "General",
    },
    guardianContact: {
      name: { type: String, trim: true, default: "" },
      phone: { type: String, trim: true, default: "" },
      email: {
        type: String,
        lowercase: true,
        trim: true,
        default: "",
      },
    },
    fingerprintId: {
      type: String,
      unique: true,
      sparse: true, // allows multiple null values
    },
    fingerprintTemplate: {
      type: String,
      default: "", // Base64 encoded biometric template from ZKTeco reader
    },
    isEnrolled: {
      type: Boolean,
      default: true,
    },
    consentGiven: {
      type: Boolean,
      default: true,
    },
    consentTimestamp: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["INSIDE", "OUTSIDE"],
      default: "OUTSIDE",
    },
  },
  { timestamps: true }
);

studentSchema.index({ status: 1, personType: 1 });
studentSchema.index({ personType: 1, isEnrolled: 1, createdAt: -1 });

module.exports = mongoose.model("Student", studentSchema);
