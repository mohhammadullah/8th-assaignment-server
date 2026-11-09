import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ObjectId } from "mongodb";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { getMongoClient } from "./lib/database.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import { verifyAuth } from "./middleware/authMiddleware.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS: only the frontend origin(s) may call the API with credentials.
const frontendOrigin = process.env.FRONTEND_URL || "http://localhost:3000";
app.use(
  cors({
    origin: [...new Set([frontendOrigin, "http://localhost:3000"])],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Better Auth owns /api/auth/*. Mounted BEFORE express.json() so the auth
// handler receives the raw request body, and with CORS already applied so
// the browser allows the session cookie to be set on cross-origin responses.
app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use(express.json());
app.use(cookieParser());

const client = getMongoClient();

async function connectToMongoDB() {
  try {
    await client.connect();
    app.locals.usersCollection = client.db("studio-space").collection("users");
    app.locals.bookingsCollection = client.db("studio-space").collection("bookings");
    app.locals.studiosCollection = client.db("studio-space").collection("studios");
    app.locals.wishlistCollection = client.db("studio-space").collection("wishlist");
    await app.locals.wishlistCollection.createIndex(
      { userId: 1, studioId: 1 },
      { unique: true, name: "uniq_user_studio" }
    );

    const activeOnly = { status: { $ne: "Cancelled" } };
    try {
      await app.locals.bookingsCollection.createIndex(
        { studioId: 1, date: 1, timeSlot: 1 },
        { unique: true, partialFilterExpression: activeOnly, name: "uniq_studio_date_slot" }
      );
      await app.locals.bookingsCollection.createIndex(
        { userId: 1, date: 1, timeSlot: 1 },
        { unique: true, partialFilterExpression: activeOnly, name: "uniq_user_date_slot" }
      );
    } catch (indexError) {
      console.warn("Booking index creation failed:", indexError.message);
    }

    console.log("Successfully connected to MongoDB!");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
}

connectToMongoDB();

// Routes
app.use("/api/bookings", bookingRoutes);
app.use("/api/wishlist", wishlistRoutes);

app.get("/api/studios/featured", async (req, res) => {
  try {
    const studiosCollection = client.db("studio-space").collection("studios");
    const studios = await studiosCollection
      .find({})
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();
    res.status(200).json(studios);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch featured studios" });
  }
});

app.get("/api/studios/user/:email", verifyAuth, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);

    // Only the authenticated user may list their own studios.
    if (email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: cannot access another user's listings",
      });
    }

    const studiosCollection = client.db("studio-space").collection("studios");
    const studios = await studiosCollection.find({ ownerEmail: email }).toArray();
    res.status(200).json(studios);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch user listings" });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const studiosCollection = client.db("studio-space").collection("studios");
    const categories = await studiosCollection.distinct("category");
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch categories" });
  }
});

app.get("/api/studios", async (req, res) => {
  try {
    const { category } = req.query;
    let query = {};
    if (category) {
      query.category = { $regex: new RegExp(`^${category}$`, "i") };
    }
    const studiosCollection = client.db("studio-space").collection("studios");
    const studios = await studiosCollection.find(query).toArray();
    res.status(200).json(studios);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch studios" });
  }
});

app.post("/api/studios", verifyAuth, async (req, res) => {
  try {
    // Never trust ownership or identity fields supplied by the client.
    const { ownerEmail, _id, createdAt, ...studioData } = req.body || {};
    const studiosCollection = client.db("studio-space").collection("studios");

    const result = await studiosCollection.insertOne({
      ...studioData,
      ownerEmail: req.user.email,
      createdAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: "Studio listed successfully!",
      insertedId: result.insertedId,
      studioData: { ...studioData, ownerEmail: req.user.email },
    });
  } catch (error) {
    console.error("Add Studio Error:", error);
    res.status(500).json({ success: false, message: "Failed to submit studio" });
  }
});

app.get("/api/studios/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid studio ID format" });
    }
    const studiosCollection = client.db("studio-space").collection("studios");
    const studio = await studiosCollection.findOne({ _id: new ObjectId(id) });
    if (!studio) {
      return res.status(400).json({ message: "Studio not found" });
    }
    res.status(200).json(studio);
  } catch (error) {
    res.status(500).json({ message: "Server error while fetching studio" });
  }
});

async function findOwnStudio(req, res) {
  const studiosCollection = client.db("studio-space").collection("studios");
  const studio = await studiosCollection.findOne({
    _id: new ObjectId(req.params.id),
  });

  if (!studio) {
    res.status(404).json({ success: false, message: "Studio not found" });
    return null;
  }

  if (
    !studio.ownerEmail ||
    studio.ownerEmail.toLowerCase() !== req.user.email.toLowerCase()
  ) {
    res.status(403).json({
      success: false,
      message: "Forbidden: you do not own this studio",
    });
    return null;
  }

  return { studiosCollection, studio };
}

app.put("/api/studios/:id", verifyAuth, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid studio ID format" });
    }

    const owned = await findOwnStudio(req, res);
    if (!owned) return;

    // Never allow ownership or identity fields to be overwritten.
    const { ownerEmail, _id, createdAt, ...updatedData } = req.body || {};

    await owned.studiosCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    res.status(200).json({ success: true, message: "Studio updated successfully!" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update studio" });
  }
});

app.delete("/api/studios/:id", verifyAuth, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid studio ID format" });
    }

    const owned = await findOwnStudio(req, res);
    if (!owned) return;

    await owned.studiosCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).json({ success: true, message: "Studio deleted successfully!" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete studio" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
