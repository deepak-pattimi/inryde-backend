const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/auth");
const {
  getMyTickets,
  createMyTicket,
  addMyTicketMessage,
} = require("../controllers/supportController");

router.use(verifyToken);

router.get("/tickets", getMyTickets);
router.post("/tickets", createMyTicket);
router.post("/tickets/:id/messages", addMyTicketMessage);

module.exports = router;
