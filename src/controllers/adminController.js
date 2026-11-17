const Customer = require("../models/Customer");
const Driver = require("../models/Driver");
const Ride = require("../models/Ride");
const Otp = require("../models/Otp");
const Notification = require("../models/Notification");
const { sendBroadcastNotification, notifyDriverStatus } = require("../services/pushService");

const normalizeCustomer = (customer) => ({
  id: customer._id,
  name: customer.name,
  phone: customer.phone,
  email: customer.email || "",
  walletBalance: customer.walletBalance || 0,
  status: customer.isActive === false ? "BLOCKED" : "ACTIVE",
  createdAt: customer.createdAt,
  updatedAt: customer.updatedAt,
});

const normalizeDriver = (driver) => ({
  id: driver._id,
  name: driver.name,
  phone: driver.phone,
  bikeNumber: driver.bikeNumber,
  profilePic: driver.profilePic || "",
  status: driver.status || (driver.isOnline ? "APPROVED" : "PENDING"),
  isOnline: driver.isOnline,
  rating: driver.rating || 5.0,
  walletBalance: driver.walletBalance || 0,
  licenseNumber: driver.licenseNumber || "",
  currentLocation: driver.currentLocation || { coordinates: [0, 0] },
  licenseFrontPic: driver.licenseFrontPic || "",
  licenseBackPic: driver.licenseBackPic || "",
  rcFrontPic: driver.rcFrontPic || "",
  rcBackPic: driver.rcBackPic || "",
  aadharFrontPic: driver.aadharFrontPic || "",
  aadharBackPic: driver.aadharBackPic || "",
  createdAt: driver.createdAt,
  updatedAt: driver.updatedAt,
});

exports.getCustomers = async (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: -1 });
    res.json({ success: true, customers: customers.map(normalizeCustomer) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ success: false, error: "Customer not found" });
    }

    const phone = customer.phone;

    // Cancel any active rides
    try {
      await Ride.updateMany(
        {
          customerId: id,
          status: { $in: ['SEARCHING', 'PENDING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] }
        },
        {
          status: 'CANCELLED',
          cancellationReason: 'Customer account deleted by admin'
        }
      );
    } catch (e) {
      console.error("Error cancelling customer rides:", e);
    }

    // Clean up OTPs
    if (phone) {
      try {
        await Otp.deleteMany({ phone });
      } catch (e) {
        console.error("Error deleting customer OTPs:", e);
      }
    }

    await Customer.findByIdAndDelete(id);
    res.json({ success: true, message: "Customer account deleted successfully." });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteDriver = async (req, res) => {
  try {
    const { id } = req.params;
    const driver = await Driver.findById(id);
    if (!driver) {
      return res.status(404).json({ success: false, error: "Driver not found" });
    }

    const phone = driver.phone;

    // Cancel active rides
    try {
      await Ride.updateMany(
        {
          driverId: id,
          status: { $in: ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] }
        },
        {
          status: 'CANCELLED',
          cancellationReason: 'Driver account deleted by admin'
        }
      );
    } catch (e) {
      console.error("Error cancelling driver rides:", e);
    }

    if (phone) {
      try {
        await Otp.deleteMany({ phone });
      } catch (e) {
        console.error("Error deleting driver OTPs:", e);
      }
    }

    await Driver.findByIdAndDelete(id);
    res.json({ success: true, message: "Driver account deleted successfully." });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateCustomerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const isActive = status !== "BLOCKED";
    const customer = await Customer.findByIdAndUpdate(
      id,
      { isActive },
      { new: true },
    );
    if (!customer)
      return res
        .status(404)
        .json({ success: false, error: "Customer not found" });
    res.json({ success: true, customer: normalizeCustomer(customer) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getCustomerRides = async (req, res) => {
  try {
    const { id } = req.params;
    const rides = await Ride.find({ customerId: id }).sort({ createdAt: -1 });
    res.json({ success: true, rides });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getDrivers = async (req, res) => {
  try {
    const drivers = await Driver.find().sort({ createdAt: -1 });
    res.json({ success: true, drivers: drivers.map(normalizeDriver) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getDriver = async (req, res) => {
  try {
    const { id } = req.params;
    const driver = await Driver.findById(id);
    if (!driver)
      return res
        .status(404)
        .json({ success: false, error: "Driver not found" });
    res.json({ success: true, driver: normalizeDriver(driver) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateDriver = async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = {};
    const body = req.body;

    if (typeof body.walletBalance !== "undefined")
      allowed.walletBalance = Number(body.walletBalance) || 0;
    if (typeof body.phone !== "undefined") allowed.phone = body.phone;
    if (typeof body.status !== "undefined") {
      allowed.status = body.status;
      if (body.status === "REJECTED") allowed.isOnline = false;
    }
    if (typeof body.isOnline !== "undefined")
      allowed.isOnline = Boolean(body.isOnline);

    const driver = await Driver.findByIdAndUpdate(id, allowed, { new: true });
    if (!driver)
      return res
        .status(404)
        .json({ success: false, error: "Driver not found" });

    // 🟢 Real-time WebSocket emission to driver room
    try {
      const io = req.app.get("io");
      if (io) {
        io.to(id.toString()).emit("driverStatusUpdated", {
          status: driver.status,
          isOnline: driver.isOnline,
        });
      }
    } catch (wsErr) {
      console.error("Error emitting driverStatusUpdated:", wsErr);
    }

    // 🟢 Send push notification if status was updated
    if (body.status && driver.pushToken) {
      notifyDriverStatus(driver, body.status).catch((e) =>
        console.error("Push notify error:", e)
      );
    }

    res.json({ success: true, driver: normalizeDriver(driver) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getDriverRides = async (req, res) => {
  try {
    const { id } = req.params;
    const rides = await Ride.find({ driverId: id })
      .populate("customerId", "name phone")
      .sort({ createdAt: -1 });

    const formattedRides = rides.map((ride) => {
      const rideObj = ride.toObject();
      if (rideObj.customerId) {
        rideObj.userName = rideObj.customerId.name || "Customer";
        rideObj.userPhone = rideObj.customerId.phone || "";
      }
      return rideObj;
    });

    res.json({ success: true, rides: formattedRides });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const fs = require("fs");
const path = require("path");

exports.getLogs = async (req, res) => {
  try {
    const logFilePath = path.join(__dirname, "../../logs/combined.log");
    if (!fs.existsSync(logFilePath)) {
      return res.json({ success: true, logs: [] });
    }

    const content = fs.readFileSync(logFilePath, "utf8");
    const formattedLogs = content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return { message: line, timestamp: new Date(), level: "info" };
        }
      })
      .reverse() // Newest logs first!
      .slice(0, 200); // Limit to last 200 log statements for speed

    res.json({ success: true, logs: formattedLogs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🔔 Notifications Controller Methods
exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find().sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, notifications });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.sendCustomNotification = async (req, res) => {
  try {
    const {
      title,
      message,
      target = "ALL",
      category = "FESTIVAL_OFFER",
      discountCode = "",
      discountPercent = 0,
      actionUrl = "",
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, error: "Title and message are required." });
    }

    // 1. Send push notifications via Expo SDK
    let pushResult = { totalRecipients: 0, successCount: 0, failureCount: 0 };
    try {
      pushResult = await sendBroadcastNotification({
        title,
        message,
        target,
        category,
        discountCode,
        discountPercent: Number(discountPercent) || 0,
        actionUrl,
      });
    } catch (pushErr) {
      console.error("Warning: Push broadcast failed partially:", pushErr.message);
    }

    // 2. Broadcast via WebSockets (if connected clients)
    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("admin_broadcast_notification", {
          title,
          message,
          target,
          category,
          discountCode,
          discountPercent,
          actionUrl,
          timestamp: new Date(),
        });
      }
    } catch (sockErr) {
      console.error("Warning: Socket broadcast failed:", sockErr.message);
    }

    // 3. Save notification record in database
    const notification = await Notification.create({
      title,
      message,
      target,
      category,
      discountCode,
      discountPercent: Number(discountPercent) || 0,
      actionUrl,
      recipientCount: pushResult.totalRecipients,
      successCount: pushResult.successCount,
      failureCount: pushResult.failureCount,
      status: "SENT",
    });

    res.status(201).json({
      success: true,
      message: `Notification broadcast sent to ${pushResult.totalRecipients} recipients!`,
      notification,
      stats: pushResult,
    });
  } catch (error) {
    console.error("Error sending custom notification:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    await Notification.findByIdAndDelete(id);
    res.json({ success: true, message: "Notification deleted successfully." });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getAudienceStats = async (req, res) => {
  try {
    const totalCustomers = await Customer.countDocuments();
    const pushReadyCustomers = await Customer.countDocuments({
      pushToken: { $ne: "", $exists: true },
    });

    const totalDrivers = await Driver.countDocuments();
    const approvedDrivers = await Driver.countDocuments({ status: "APPROVED" });
    const pushReadyDrivers = await Driver.countDocuments({
      status: "APPROVED",
      pushToken: { $ne: "", $exists: true },
    });
    const onlineDrivers = await Driver.countDocuments({ isOnline: true });

    const totalCampaigns = await Notification.countDocuments();

    res.json({
      success: true,
      stats: {
        totalCustomers,
        pushReadyCustomers,
        totalDrivers,
        approvedDrivers,
        pushReadyDrivers,
        onlineDrivers,
        totalCampaigns,
        totalReach: pushReadyCustomers + pushReadyDrivers,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

