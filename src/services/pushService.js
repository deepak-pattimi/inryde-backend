const { Expo } = require('expo-server-sdk');
const Driver = require('../models/Driver');
const Customer = require('../models/Customer');

// Initialize the Expo Push Notification SDK
const expo = new Expo();

// 🟢 1. NOTIFY NEARBY DRIVERS (Using MongoDB $near map math)
const notifyNearbyDrivers = async (rideId, rideData) => {
    try {
        console.log(`🔔 Searching for drivers near Ride: ${rideId}`);
        const { pickup, fare } = rideData;
        
        if (!pickup || !pickup.coordinates) return;

        // Remember: MongoDB uses [Longitude, Latitude]
        const pickupLng = pickup.coordinates[0];
        const pickupLat = pickup.coordinates[1];

        // 🚀 THE MAGIC QUERY: Let MongoDB do the heavy lifting!
        // We only fetch online drivers, with a valid push token, within a 10km absolute maximum radius.
        const nearbyDrivers = await Driver.find({
            isOnline: true,
            status: "APPROVED",
            pushToken: { $ne: "", $exists: true }, 
            currentLocation: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [pickupLng, pickupLat]
                    },
                    $maxDistance: 10000 // 10,000 meters = 10km max search radius
                }
            }
        });

        if (nearbyDrivers.length === 0) {
            console.log("📭 No online drivers found in the area.");
            return;
        }

        let messages = [];

        // Loop through the drivers MongoDB found for us
        nearbyDrivers.forEach(driver => {
            // Check if the Expo token is valid format
            if (!Expo.isExpoPushToken(driver.pushToken)) return;

            // Optional: If the driver has a custom max distance preference (e.g., only wants rides within 3km)
            // We can check it here. (Assuming driver.maxPickupDist is stored in KM).
            // MongoDB $near is so good, we don't even need to calculate the exact distance again unless we want to display it.
            const driverMaxRange = driver.maxPickupDist || 5; 

            messages.push({
                to: driver.pushToken,
                sound: 'default',
                title: '🚖 NEW RIDE REQUEST',
                body: `Trip: ₹${fare} • Tap to view location`,
                data: { rideId: rideId, type: 'new_order' },
                priority: 'high',
                channelId: 'default', 
            });
        });

        // Expo requires us to send notifications in "chunks" (batches) so we don't overload Apple/Google servers
        if (messages.length > 0) {
            let chunks = expo.chunkPushNotifications(messages);
            for (let chunk of chunks) {
                try {
                    await expo.sendPushNotificationsAsync(chunk);
                } catch (error) {
                    console.error("❌ Error sending Expo chunk:", error);
                }
            }
            console.log(`✅ Sent push notifications to ${messages.length} drivers.`);
        }

    } catch (error) {
        console.error("❌ Notification Error (Drivers):", error);
    }
};

// 🟢 2. NOTIFY CUSTOMER (When a driver accepts the ride)
const notifyCustomer = async (customerId, driverName) => {
    try {
        // Find the customer in MongoDB
        const customer = await Customer.findById(customerId);
        
        if (!customer) return;

        const pushToken = customer.pushToken;

        // Verify they have a valid Expo token
        if (pushToken && Expo.isExpoPushToken(pushToken)) {
            console.log(`🔔 Notifying Customer: ${customerId}`);
            
            await expo.sendPushNotificationsAsync([{
                to: pushToken,
                sound: 'default',
                title: '🚖 Driver Found!',
                body: `${driverName} is on the way to pick you up.`,
                data: { type: 'driver_found' },
                priority: 'high'
            }]);
        }
    } catch (error) {
        console.error("❌ Customer Notification Error:", error);
    }
};

// 🟢 3. NOTIFY CUSTOMER GENERIC (For Arrivals, Completions, Cancellations)
const notifyCustomerGeneric = async (customerId, title, body, type = 'update') => {
    try {
        const customer = await Customer.findById(customerId);
        if (!customer) return;

        const pushToken = customer.pushToken;
        if (pushToken && Expo.isExpoPushToken(pushToken)) {
            await expo.sendPushNotificationsAsync([{
                to: pushToken,
                sound: 'default',
                title: title,
                body: body,
                data: { type },
                priority: 'high'
            }]);
        }
    } catch (error) {
        console.error("❌ Customer Notification Error:", error);
    }
};

// 🟢 4. SEND CUSTOM BROADCAST NOTIFICATION (Admin to All, Customers, or Drivers)
const sendBroadcastNotification = async ({
    title,
    message,
    target = "ALL", // "ALL" | "CUSTOMERS" | "DRIVERS"
    category = "FESTIVAL_OFFER",
    discountCode = "",
    discountPercent = 0,
    actionUrl = ""
}) => {
    let tokens = [];

    try {
        if (target === "CUSTOMERS" || target === "ALL") {
            const customers = await Customer.find({
                isActive: { $ne: false },
                pushToken: { $ne: "", $exists: true }
            }).select("pushToken");
            customers.forEach((c) => {
                if (c.pushToken && Expo.isExpoPushToken(c.pushToken)) {
                    tokens.push(c.pushToken);
                }
            });
        }

        if (target === "DRIVERS" || target === "ALL") {
            const drivers = await Driver.find({
                status: "APPROVED",
                pushToken: { $ne: "", $exists: true }
            }).select("pushToken");
            drivers.forEach((d) => {
                if (d.pushToken && Expo.isExpoPushToken(d.pushToken)) {
                    tokens.push(d.pushToken);
                }
            });
        }

        // Deduplicate tokens
        const uniqueTokens = [...new Set(tokens)];
        let successCount = 0;
        let failureCount = 0;

        if (uniqueTokens.length > 0) {
            const pushMessages = uniqueTokens.map((token) => ({
                to: token,
                sound: "default",
                title: title,
                body: message,
                data: {
                    type: "custom_broadcast",
                    category,
                    discountCode,
                    discountPercent,
                    actionUrl,
                },
                priority: "high",
                channelId: "default",
            }));

            const chunks = expo.chunkPushNotifications(pushMessages);
            for (const chunk of chunks) {
                try {
                    const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
                    ticketChunk.forEach((ticket) => {
                        if (ticket.status === "ok") {
                            successCount++;
                        } else {
                            failureCount++;
                        }
                    });
                } catch (chunkErr) {
                    console.error("❌ Error sending broadcast chunk:", chunkErr);
                    failureCount += chunk.length;
                }
            }
        }

        return {
            totalRecipients: uniqueTokens.length,
            successCount,
            failureCount,
        };
    } catch (error) {
        console.error("❌ Broadcast notification error:", error);
        throw error;
    }
};

// 🟢 5. NOTIFY DRIVER ON ACCOUNT VERIFICATION / STATUS CHANGE
const notifyDriverStatus = async (driver, status) => {
    try {
        if (!driver || !driver.pushToken || !Expo.isExpoPushToken(driver.pushToken)) return;
        const isApproved = status === "APPROVED";
        const title = isApproved ? "🎉 Profile Approved!" : "Profile Status Update";
        const body = isApproved
            ? "Your documents have been verified. You can now go online and receive ride requests!"
            : `Your driver profile status has been updated to ${status}.`;

        await expo.sendPushNotificationsAsync([{
            to: driver.pushToken,
            sound: "default",
            title,
            body,
            data: { type: "driver_status_update", status },
            priority: "high",
            channelId: "default",
        }]);
        console.log(`🔔 Sent status update notification to driver: ${driver._id} (${status})`);
    } catch (error) {
        console.error("❌ Driver status notification error:", error);
    }
};

module.exports = { 
    notifyNearbyDrivers, 
    notifyCustomer, 
    notifyCustomerGeneric,
    sendBroadcastNotification,
    notifyDriverStatus,
};