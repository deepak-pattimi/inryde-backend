const express = require("express");
const router = express.Router();
const {
  requestOTP,
  verifyOTP,
  checkDriver,
  driverLogin,
  driverRegister,
  customerLogin,
  customerRegister,
} = require("../controllers/authController");

router.post("/request-otp", requestOTP);
router.post("/verify-otp", verifyOTP);

router.post("/check-driver", checkDriver);
router.post("/driver-login", driverLogin);
router.post("/driver-register", driverRegister);

router.post("/customer-login", customerLogin);
router.post("/customer-register", customerRegister);

module.exports = router;
