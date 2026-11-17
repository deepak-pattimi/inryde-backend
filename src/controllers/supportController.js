const SupportTicket = require("../models/SupportTicket");
const Driver = require("../models/Driver");
const Customer = require("../models/Customer");

const generateTicketCode = () =>
  `TKT-${Math.floor(10000 + Math.random() * 90000)}`;

const formatTicket = (t) => {
  const obj = typeof t.toObject === "function" ? t.toObject() : t;
  const messages = Array.isArray(obj.messages)
    ? obj.messages.map((m) => ({
        id: String(m._id || m.id || ""),
        sender: m.sender,
        text: m.text,
        createdAt: m.createdAt,
      }))
    : [];
  const lastMsg = messages[messages.length - 1];
  return {
    id: String(obj._id),
    ticketCode: obj.ticketCode,
    userId: obj.userId || "",
    role: obj.role || "CAPTAIN",
    name: obj.name || "",
    phone: obj.phone || "",
    category: obj.category || "Other",
    priority: obj.priority || "NORMAL",
    status: obj.status || "OPEN",
    messages,
    note: lastMsg?.text || "",
    lastMessageAt: obj.lastMessageAt || obj.updatedAt || obj.createdAt,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
};

// User: list own tickets
exports.getMyTickets = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const tickets = await SupportTicket.find({ userId }).sort({
      lastMessageAt: -1,
      createdAt: -1,
    });
    res.json({ success: true, tickets: tickets.map(formatTicket) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// User: create ticket (and optional initial message)
exports.createMyTicket = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const {
      category = "KYC Verification",
      priority = "NORMAL",
      message = "",
    } = req.body;

    let role = "CAPTAIN";
    let account = await Driver.findById(userId);
    if (!account) {
      account = await Customer.findById(userId);
      if (account) role = "CUSTOMER";
    }

    const cleanMessage = String(message || "").trim();
    const initialMessages = cleanMessage
      ? [{ sender: "USER", text: cleanMessage }]
      : [];

    const ticket = await SupportTicket.create({
      ticketCode: generateTicketCode(),
      userId,
      role,
      name: account?.name || "User",
      phone: account?.phone || "",
      category: String(category).trim() || "Other",
      priority: ["NORMAL", "HIGH", "URGENT"].includes(priority)
        ? priority
        : "NORMAL",
      status: "OPEN",
      messages: initialMessages,
      lastMessageAt: new Date(),
    });

    const formatted = formatTicket(ticket);

    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("support_ticket_created", formatted);
      }
    } catch (e) {
      // ignore socket errors
    }

    res.status(201).json({ success: true, ticket: formatted });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// User: send message on existing ticket
exports.addMyTicketMessage = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { id } = req.params;
    const text = String(req.body.text || "").trim();
    if (!text) {
      return res
        .status(400)
        .json({ success: false, error: "Message text is required" });
    }

    const ticket = await SupportTicket.findOne({ _id: id, userId });
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, error: "Support ticket not found" });
    }

    ticket.messages.push({ sender: "USER", text });
    if (ticket.status === "RESOLVED") {
      ticket.status = "OPEN";
    }
    ticket.lastMessageAt = new Date();
    await ticket.save();

    const formatted = formatTicket(ticket);

    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("support_message", {
          ticketId: formatted.id,
          userId,
          ticket: formatted,
        });
      }
    } catch (e) {
      // ignore socket errors
    }

    res.json({ success: true, ticket: formatted });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Admin: list all support tickets
exports.adminGetTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.find().sort({
      lastMessageAt: -1,
      createdAt: -1,
    });
    res.json({ success: true, tickets: tickets.map(formatTicket) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Admin: create ticket
exports.adminCreateTicket = async (req, res) => {
  try {
    const {
      userId = "",
      role = "CUSTOMER",
      name = "",
      phone = "",
      category = "Ride / Fare",
      priority = "NORMAL",
      note = "",
    } = req.body;

    const cleanNote = String(note || "").trim();
    const ticket = await SupportTicket.create({
      ticketCode: generateTicketCode(),
      userId: String(userId || ""),
      role: role === "CAPTAIN" ? "CAPTAIN" : "CUSTOMER",
      name: String(name || "").trim(),
      phone: String(phone || "").trim(),
      category: String(category || "Other").trim(),
      priority: ["NORMAL", "HIGH", "URGENT"].includes(priority)
        ? priority
        : "NORMAL",
      status: "OPEN",
      messages: cleanNote ? [{ sender: "ADMIN", text: cleanNote }] : [],
      lastMessageAt: new Date(),
    });

    res.status(201).json({ success: true, ticket: formatTicket(ticket) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Admin: update status / priority
exports.adminUpdateTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority } = req.body;
    const updates = {};
    if (["OPEN", "IN_PROGRESS", "RESOLVED"].includes(status)) {
      updates.status = status;
    }
    if (["NORMAL", "HIGH", "URGENT"].includes(priority)) {
      updates.priority = priority;
    }

    const ticket = await SupportTicket.findByIdAndUpdate(id, updates, {
      new: true,
    });
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, error: "Ticket not found" });
    }

    const formatted = formatTicket(ticket);

    try {
      const io = req.app.get("io");
      if (io && ticket.userId) {
        io.to(String(ticket.userId)).emit("support_message", {
          ticketId: formatted.id,
          userId: String(ticket.userId),
          ticket: formatted,
        });
      }
    } catch (e) {
      // ignore socket errors
    }

    res.json({ success: true, ticket: formatted });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Admin: reply to a ticket
exports.adminReplyTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const text = String(req.body.text || "").trim();
    if (!text) {
      return res
        .status(400)
        .json({ success: false, error: "Reply text is required" });
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, error: "Ticket not found" });
    }

    ticket.messages.push({ sender: "ADMIN", text });
    if (ticket.status === "OPEN") {
      ticket.status = "IN_PROGRESS";
    }
    ticket.lastMessageAt = new Date();
    await ticket.save();

    const formatted = formatTicket(ticket);

    try {
      const io = req.app.get("io");
      if (io && ticket.userId) {
        io.to(String(ticket.userId)).emit("support_message", {
          ticketId: formatted.id,
          userId: String(ticket.userId),
          ticket: formatted,
        });
      }
    } catch (e) {
      // ignore socket errors
    }

    res.json({ success: true, ticket: formatted });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Admin: delete ticket
exports.adminDeleteTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const ticket = await SupportTicket.findByIdAndDelete(id);
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, error: "Ticket not found" });
    }
    res.json({ success: true, message: "Ticket deleted" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
