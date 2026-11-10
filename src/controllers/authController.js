const Otp = require("../models/Otp");
const Customer = require("../models/Customer");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { sendSMS } = require("../services/smsService.js");
const Driver = require("../models/Driver");
const Ride = require("../models/Ride");

// App Store & Play Store Demo / Testing Credentials
const DEMO_PHONE_NUMBERS = ["6301616598", "9999999999", "9876543210"];
const DEMO_PASSWORD = "1234";

const getTenDigits = (phone) => {
  if (!phone) return "";
  const rawDigits = phone.toString().replace(/[^\d]/g, "");
  return rawDigits.length >= 10 ? rawDigits.slice(-10) : rawDigits;
};

const isDemoPhone = (phone) => {
  const tenDigits = getTenDigits(phone);
  return DEMO_PHONE_NUMBERS.includes(tenDigits);
};

// 🟢 1. REQUEST OTP
exports.requestOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number required" });

    let cleanPhone = phone.toString().trim();
    if (!cleanPhone.startsWith("+91") && cleanPhone.replace(/[^\d]/g, '').length === 10) {
      cleanPhone = `+91${cleanPhone.replace(/[^\d]/g, '')}`;
    }

    const tenDigits = getTenDigits(cleanPhone);
    const isDemo = isDemoPhone(cleanPhone);

    let generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();

    // App Store / Play Store Reviewer Demo Account Bypass
    if (isDemo) {
      generatedOtp = DEMO_PASSWORD;
    }

    // Save to DB
    await Otp.findOneAndUpdate(
      { phone: cleanPhone },
      { otp: generatedOtp, expiresAt: new Date() },
      { upsert: true, new: true },
    );

    // Also persist with +91 format if cleanPhone had different representation
    if (tenDigits) {
      await Otp.findOneAndUpdate(
        { phone: `+91${tenDigits}` },
        { otp: generatedOtp, expiresAt: new Date() },
        { upsert: true, new: true },
      );
    }

    // Skip sending SMS for demo test accounts
    if (!isDemo) {
      await sendSMS(cleanPhone, generatedOtp);
    }

    res.status(200).json({ success: true, message: "OTP sent successfully" });
  } catch (error) {
    console.error("requestOTP error:", error);
    res
      .status(500)
      .json({ error: error.message || "Could not send OTP. Check MSG91 SMS gateway." });
  }
};

// 🟢 2. VERIFY OTP
exports.verifyOTP = async (req, res) => {
  try {
    const { phone, otp, role, verifyOnly } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone and OTP are required" });
    }

    let cleanPhone = phone.toString().trim();
    const tenDigits = getTenDigits(cleanPhone);
    const phoneVariants = [
      cleanPhone,
      `+91${tenDigits}`,
      tenDigits
    ];

    const isDemo = isDemoPhone(cleanPhone);
    const enteredOtp = otp.toString().trim();

    // Find the OTP in our temp collection matching any phone variant
    const otpRecord = await Otp.findOne({ phone: { $in: phoneVariants }, otp: enteredOtp });

    // Allow App Store testing accounts with default password/OTP '1234'
    // Even if OTP was expired or not pre-requested
    const isDemoValid = isDemo && enteredOtp === DEMO_PASSWORD;

    if (!otpRecord && !isDemoValid) {
      return res.status(400).json({ error: "Invalid or expired OTP. Please try again." });
    }

    // Delete the used OTP record if present
    if (otpRecord) {
      await Otp.deleteOne({ _id: otpRecord._id });
    }

    if (verifyOnly) {
      return res.status(200).json({
        success: true,
        verified: true,
      });
    }

    const secretKey = process.env.JWT_SECRET || 'your_super_secret_jwt_key_rapido_2026qefiubkj';

    // Driver OTP verification flow (uses same MSG91 OTP & backend without creating Customer)
    if (role && role.toString().toUpperCase() === "DRIVER") {
      const driver = await Driver.findOne({ phone: { $in: phoneVariants } });

      if (!driver) {
        return res
          .status(404)
          .json({ success: false, error: "Driver not found. Please register." });
      }

      const token = jwt.sign(
        { id: driver._id, role: "DRIVER" },
        secretKey,
        { expiresIn: "30d" },
      );

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const ridesToday = await Ride.aggregate([
        { $match: { driverId: driver._id, status: "COMPLETED", endTime: { $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: "$driverNetEarning" } } }
      ]);
      const todayEarnings = ridesToday.length > 0 ? ridesToday[0].total : 0;

      const driverResponse = driver.toObject();
      driverResponse.todayEarnings = todayEarnings;

      return res.status(200).json({
        success: true,
        token,
        driver: driverResponse,
      });
    }

    // OTP is correct! Now find or create the Customer
    const formattedPhone = `+91${tenDigits}`;
    let isNew = false;
    let customer = await Customer.findOne({ phone: { $in: phoneVariants } });

    if (!customer) {
      isNew = true;
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, salt);
      customer = await Customer.create({
        phone: formattedPhone,
        name: isDemo ? "App Store Reviewer" : "Rider",
        password: hashedPassword,
        walletBalance: isDemo ? 500 : 0,
      });
    }

    // Generate JWT Token
    const token = jwt.sign(
      { id: customer._id, role: "CUSTOMER" },
      secretKey,
      { expiresIn: "30d" },
    );

    res.status(200).json({
      success: true,
      token,
      user: { id: customer._id, phone: customer.phone, name: customer.name, email: customer.email || "" },
      isNew,
    });
  } catch (error) {
    console.error("verifyOTP error:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.driverLogin = async (req, res) => {
  try {
    const { phone } = req.body;
    const cleanPhone = (phone || "").toString().trim();
    const tenDigits = getTenDigits(cleanPhone);
    const phoneVariants = [cleanPhone, `+91${tenDigits}`, tenDigits].filter(Boolean);

    // 1. Find the driver in MongoDB
    const driver = await Driver.findOne({ phone: { $in: phoneVariants } });

    if (!driver) {
      return res
        .status(404)
        .json({ success: false, error: "Driver not found. Please register." });
    }

    // 2. Generate JWT Token
    const secretKey = process.env.JWT_SECRET || 'your_super_secret_jwt_key_rapido_2026qefiubkj';
    const token = jwt.sign(
      { id: driver._id, role: "DRIVER" }, // 🟢 Standardize to 'id'
      secretKey,
      { expiresIn: "30d" },
    );

    // 3. Dynamically calculate today's earnings
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const ridesToday = await Ride.aggregate([
      { $match: { driverId: driver._id, status: "COMPLETED", endTime: { $gte: startOfDay } } },
      { $group: { _id: null, total: { $sum: "$driverNetEarning" } } }
    ]);
    const todayEarnings = ridesToday.length > 0 ? ridesToday[0].total : 0;
    
    // 4. Send success JSON back to React Native
    const driverResponse = driver.toObject();
    driverResponse.todayEarnings = todayEarnings;

    res.status(200).json({
      success: true,
      token,
      driver: driverResponse,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// 🟢 NEW: DRIVER REGISTRATION
// ==========================================
exports.driverRegister = async (req, res) => {
  try {
    const payload = req.body;

    // 1. Check if they already exist
    const existingDriver = await Driver.findOne({ phone: payload.phone });
    if (existingDriver) {
      return res
        .status(400)
        .json({ success: false, error: "Phone number already registered." });
    }

    // 2. Create the new Driver in MongoDB
    const newDriver = await Driver.create({
      ...payload,
      vehicleType: payload.vehicleType || "BIKE",
      permitPic: payload.permitPic || "",
      insurancePic: payload.insurancePic || "",
      fitnessPic: payload.fitnessPic || "",
      status: "PENDING", // Force them to PENDING so Admin can verify docs
      walletBalance: 0,
      todayEarnings: 0,
      totalRides: 0,
      rating: 5.0,
      isOnline: false,
    });

    res
      .status(201)
      .json({ success: true, message: "Driver registered successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🟢 CUSTOMER REGISTER
exports.customerRegister = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password || !phone) {
      return res.status(400).json({ success: false, error: "All fields (name, email, password, phone) are required." });
    }

    // Check if email already exists
    const emailExists = await Customer.findOne({ email: email.trim().toLowerCase() });
    if (emailExists) {
      return res.status(400).json({ success: false, error: "Email is already registered." });
    }

    // Check if phone already exists
    const phoneExists = await Customer.findOne({ phone: phone.trim() });
    if (phoneExists) {
      return res.status(400).json({ success: false, error: "Phone number is already registered." });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create the customer
    const customer = await Customer.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      phone: phone.trim(),
      walletBalance: 0,
    });

    // Generate JWT Token
    const secretKey = process.env.JWT_SECRET || 'your_super_secret_jwt_key_rapido_2026qefiubkj';
    const token = jwt.sign(
      { id: customer._id, role: "CUSTOMER" },
      secretKey,
      { expiresIn: "30d" }
    );

    res.status(201).json({
      success: true,
      token,
      user: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🟢 CUSTOMER LOGIN
exports.customerLogin = async (req, res) => {
  try {
    const { email, phone, identifier, password } = req.body;
    const loginId = (identifier || phone || email || "").toString().trim();

    if (!loginId || !password) {
      return res.status(400).json({ success: false, error: "Email or mobile number and password are required." });
    }

    const tenDigits = getTenDigits(loginId);
    const phoneVariants = [
      loginId,
      `+91${tenDigits}`,
      tenDigits
    ];

    const isDemo = isDemoPhone(loginId);
    const enteredPassword = password.toString().trim();

    // Find the customer by email or phone
    let customer = await Customer.findOne({
      $or: [
        { email: loginId.toLowerCase() },
        { phone: { $in: phoneVariants } }
      ]
    });

    if (isDemo && enteredPassword === DEMO_PASSWORD) {
      // Demo tester bypass for password login
      if (!customer) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, salt);
        customer = await Customer.create({
          phone: `+91${tenDigits}`,
          name: "App Store Reviewer",
          password: hashedPassword,
          walletBalance: 500,
        });
      }
    } else {
      if (!customer) {
        return res.status(401).json({ success: false, error: "Invalid email or password." });
      }

      if (!customer.password) {
        return res.status(401).json({ success: false, error: "Password not set for this account. Please login with OTP." });
      }

      // Check password
      const isMatch = await bcrypt.compare(enteredPassword, customer.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, error: "Invalid email or password." });
      }
    }

    // Generate JWT Token
    const secretKey = process.env.JWT_SECRET || 'your_super_secret_jwt_key_rapido_2026qefiubkj';
    const token = jwt.sign(
      { id: customer._id, role: "CUSTOMER" },
      secretKey,
      { expiresIn: "30d" }
    );

    res.status(200).json({
      success: true,
      token,
      user: {
        id: customer._id,
        name: customer.name,
        email: customer.email || "",
        phone: customer.phone,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
