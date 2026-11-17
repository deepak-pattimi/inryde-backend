require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");
const jwt = require("jsonwebtoken");
const cron = require("node-cron");
const errorHandler = require("./middlewares/errorHandler");
const connectDB = require("./config/db");
const Ride = require("./models/Ride");

const walletRoutes = require("./routes/walletRoutes");
const authRoutes = require("./routes/authRoutes");
const rideRoutes = require("./routes/rideRoutes");
const customerRoutes = require("./routes/customerRoutes");
const driverRoutes = require("./routes/driverRoutes");
const adminRoutes = require("./routes/adminRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const supportRoutes = require("./routes/supportRoutes");

const app = express();

// 🟢 Wrap Express in a standard Node HTTP server
const server = http.createServer(app);

// 🟢 Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"]
  }
});

// 🟢 Make 'io' globally accessible to our controllers
app.set("io", io);

// 🟢 Socket.io Authentication Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication error: No token provided"));
  try {
    const secretKey = process.env.JWT_SECRET || 'your_super_secret_jwt_key_rapido_2026qefiubkj';
    const decoded = jwt.verify(token, secretKey);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error("Authentication error: Invalid token"));
  }
});

// 🟢 Listen for real-time WebSocket connections
io.on("connection", (socket) => {
  console.log(`⚡ Device Connected: ${socket.id}`);

  // When a user opens the app, they join a private room matching their database ID
  socket.on("joinRoom", (userId) => {
    socket.join(userId);
    console.log(`👤 User joined private room: ${userId}`);
  });

  socket.on("disconnect", () => {
    console.log(`🔌 Device Disconnected: ${socket.id}`);
  });
});

app.use(cors());
app.use(express.json());

// 🟢 Security Middleware
const mongoSanitize = require("./middlewares/mongoSanitize");
app.use(mongoSanitize);
app.use(helmet());
app.use(hpp());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // Increased limit: polling apps make many requests
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json({ success: false, error: options.message });
  },
  message: "Too many requests from this IP, please try again after 15 minutes",
});
app.use("/api", limiter);

connectDB();

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Inryde Backend is Live",
  });
});

app.use("/api/rides", rideRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/support", supportRoutes);

// 🟢 Global Error Handler
app.use(errorHandler);


// 🟢 Background Worker for Scheduled Rides
// Runs every minute to check if any scheduled rides need to be released
cron.schedule("* * * * *", async () => {
  try {
    const tenMinsFromNow = new Date(Date.now() + 10 * 60 * 1000);

    // Find rides that are SCHEDULED and whose time is <= 10 mins from now
    const ridesToRelease = await Ride.find({
      status: "SCHEDULED",
      scheduledTime: { $lte: tenMinsFromNow }
    });

    if (ridesToRelease.length > 0) {
      console.log(`[Cron] Releasing ${ridesToRelease.length} scheduled rides to drivers!`);
      for (const ride of ridesToRelease) {
        ride.status = "REQUESTED";
        await ride.save();
      }
      // Broadcast to all drivers that new rides are available
      io.emit("newRideAvailable");
    }
  } catch (err) {
    console.error("[Cron] Error processing scheduled rides:", err);
  }
});

const PORT = process.env.PORT || 4000;

// 🟢 IMPORTANT: Start 'server', not 'app'
server.listen(PORT, "0.0.0.0", () => {
  console.log(`=================================`);
  console.log(`🚀 Server & WebSockets running on port ${PORT}`);
  console.log(`=================================`);
});