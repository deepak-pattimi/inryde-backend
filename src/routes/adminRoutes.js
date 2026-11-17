const express = require("express");
const router = express.Router();
const { verifyAdminSecret } = require("../middlewares/auth");
const {
  getCustomers,
  deleteCustomer,
  updateCustomerStatus,
  getCustomerRides,
  getDrivers,
  getDriver,
  updateDriver,
  deleteDriver,
  getDriverRides,
  getLogs,
  getNotifications,
  sendCustomNotification,
  deleteNotification,
  getAudienceStats,
} = require("../controllers/adminController");
const {
  adminGetTickets,
  adminCreateTicket,
  adminUpdateTicket,
  adminReplyTicket,
  adminDeleteTicket,
} = require("../controllers/supportController");

router.use(verifyAdminSecret);

router.get("/customers", getCustomers);
router.delete("/customers/:id", deleteCustomer);
router.patch("/customers/:id/status", updateCustomerStatus);
router.get("/customers/:id/rides", getCustomerRides);

router.get("/drivers", getDrivers);
router.get("/drivers/:id", getDriver);
router.patch("/drivers/:id", updateDriver);
router.delete("/drivers/:id", deleteDriver);
router.get("/drivers/:id/rides", getDriverRides);
router.get("/logs", getLogs);

// 🔔 Broadcast Notifications Endpoints
router.get("/notifications", getNotifications);
router.post("/notifications/send", sendCustomNotification);
router.delete("/notifications/:id", deleteNotification);
router.get("/notifications/audience-stats", getAudienceStats);

// Support Tickets Endpoints
router.get("/support/tickets", adminGetTickets);
router.post("/support/tickets", adminCreateTicket);
router.patch("/support/tickets/:id", adminUpdateTicket);
router.post("/support/tickets/:id/messages", adminReplyTicket);
router.delete("/support/tickets/:id", adminDeleteTicket);

module.exports = router;
