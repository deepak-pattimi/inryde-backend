const mongoose = require("mongoose");

const supportMessageSchema = new mongoose.Schema(
  {
    sender: {
      type: String,
      enum: ["USER", "ADMIN"],
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const supportTicketSchema = new mongoose.Schema(
  {
    ticketCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      index: true,
      default: "",
    },
    role: {
      type: String,
      enum: ["CAPTAIN", "CUSTOMER"],
      default: "CAPTAIN",
    },
    name: {
      type: String,
      default: "",
      trim: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    category: {
      type: String,
      default: "KYC Verification",
      trim: true,
    },
    priority: {
      type: String,
      enum: ["NORMAL", "HIGH", "URGENT"],
      default: "NORMAL",
    },
    status: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "RESOLVED"],
      default: "OPEN",
    },
    messages: {
      type: [supportMessageSchema],
      default: [],
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("SupportTicket", supportTicketSchema);
