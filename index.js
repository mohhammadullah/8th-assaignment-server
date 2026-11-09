import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ObjectId } from "mongodb";
import { toNodeHandler } from "better-auth/node";
import { auth, getAllowedOrigins } from "./lib/auth.js";
import { getMongoClient, getDbName } from "./lib/database.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import { verifyAuth } from "./middleware/authMiddleware.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS: only the frontend origin(s) may call the API with credentials.
// FRONTEND_URL may be a comma-separated list; localhost is always allowed
// for development so a fresh deploy works before env is updated.
const allowedOrigins = getAllowedOrigins();
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser clients (curl, health checks) with no Origin.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Better Auth owns /api/auth/*. Mounted BEFORE express.json() so the auth
// handler receives the raw request body, and with CORS already applied so
// the browser allows the session cookie to be set on cross-origin responses.
app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const client = getMongoClient();
const dbName = getDbName();
let mongoReady = null;

async function connectToMongoDB() {
  if (mongoReady) return mongoReady;
  mongoReady = (async () => {
    try {
      await client.connect();
      const db = client.db(dbName);
      app.locals.usersCollection = db.collection("users");
      app.locals.bookingsCollection = db.collection("bookings");
      app.locals.studiosCollection = db.collection("studios");
      app.locals.wishlistCollection = db.collection("wishlist");

      // Indexes are idempotent but each is an extra Atlas round-trip on a
      // cold start. Create them in the background (not awaited) so the first
      // request waits only for the connection, not for index maintenance.
      // MongoDB partial indexes do not support $ne; match the active
      // statuses explicitly so the unique index can be created.
      const activeOnly = { status: { $in: ["Pending", "Confirmed"] } };
      void (async () => {
        try {
          await app.locals.wishlistCollection.createIndex(
            { userId: 1, studioId: 1 },
            { unique: true, name: "uniq_user_studio" }
          );
        } catch (indexError) {
          console.warn("Wishlist index creation failed:", indexError.message);
        }
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
      })();

      console.log(`Successfully connected to MongoDB (db "${dbName}")!`);
      return true;
    } catch (error) {
      mongoReady = null;
      console.error("MongoDB connection failed:", error.message);
      throw error;
    }
  })();
  return mongoReady;
}

// Ensure a request never runs before collections exist (e.g. a cold request
// on Vercel before the boot connect finishes, or a transient DB failure).
app.use(async (req, res, next) => {
  if (!app.locals.bookingsCollection || !app.locals.studiosCollection) {
    try {
      await connectToMongoDB();
    } catch {
      return res
        .status(503)
        .json({ success: false, message: "Database unavailable" });
    }
  }
  return next();
});

// Health + root endpoints for deploy checks (Render / Vercel / uptime).
app.get("/api/health", async (req, res) => {
  try {
    await client.db(dbName).command({ ping: 1 });
    return res.status(200).json({
      success: true,
      status: "ok",
      db: dbName,
      time: new Date().toISOString(),
    });
  } catch (error) {
    return res
      .status(503)
      .json({ success: false, status: "degraded", error: error.message });
  }
});

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    service: "StudioSpace API",
    health: "/api/health",
  });
});

// Routes
app.use("/api/bookings", bookingRoutes);
app.use("/api/wishlist", wishlistRoutes);

app.get("/api/studios/featured", async (req, res) => {
  try {
    const studiosCollection = client.db(dbName).collection("studios");
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

    const studiosCollection = client.db(dbName).collection("studios");
    const studios = await studiosCollection.find({ ownerEmail: email }).toArray();
    res.status(200).json(studios);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch user listings" });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const studiosCollection = client.db(dbName).collection("studios");
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
    const studiosCollection = client.db(dbName).collection("studios");
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
    // Minimal validation so bad payloads get a 400 instead of polluting the DB.
    if (
      !studioData.title ||
      !studioData.category ||
      !studioData.location ||
      studioData.hourlyRate == null ||
      Number(studioData.hourlyRate) <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "title, category, location and a positive hourlyRate are required",
      });
    }
    // Image must be a real http(s) URL — never store blob: URLs or huge
    // data: payloads (the frontend validates the same rules).
    if (studioData.image != null) {
      const imageValue = String(studioData.image).trim();
      let imageOk = false;
      try {
        const parsed = new URL(imageValue);
        imageOk = parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {
        imageOk = false;
      }
      if (!imageOk) {
        return res.status(400).json({
          success: false,
          message:
            "image must be a valid http(s) URL (blob: and data: URLs are not allowed)",
        });
      }
      studioData.image = imageValue;
    }
    const studiosCollection = client.db(dbName).collection("studios");

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
    const studiosCollection = client.db(dbName).collection("studios");
    const studio = await studiosCollection.findOne({ _id: new ObjectId(id) });
    if (!studio) {
      return res.status(404).json({ message: "Studio not found" });
    }
    res.status(200).json(studio);
  } catch (error) {
    res.status(500).json({ message: "Server error while fetching studio" });
  }
});

async function findOwnStudio(req, res) {
  const studiosCollection = client.db(dbName).collection("studios");
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

    if (updatedData.image != null) {
      const imageValue = String(updatedData.image).trim();
      let imageOk = false;
      try {
        const parsed = new URL(imageValue);
        imageOk = parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {
        imageOk = false;
      }
      if (!imageOk) {
        return res.status(400).json({
          success: false,
          message:
            "image must be a valid http(s) URL (blob: and data: URLs are not allowed)",
        });
      }
      updatedData.image = imageValue;
    }

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

// JSON 404 for any unmatched API route so the frontend never gets HTML.
app.use("/api", (req, res) => {
  return res
    .status(404)
    .json({ success: false, message: "API route not found" });
});

// Central JSON error handler (invalid JSON bodies, CORS errors, etc.).
app.use((error, req, res, next) => {
  if (error?.type === "entity.too.large" || error?.type === "entity.parse.failed") {
    return res
      .status(400)
      .json({ success: false, message: "Invalid request body" });
  }
  if (error?.message?.includes("not allowed by CORS")) {
    return res
      .status(403)
      .json({ success: false, message: error.message });
  }
  console.error("Unhandled error:", error);
  return res
    .status(500)
    .json({ success: false, message: "Internal server error" });
});

// On Vercel (serverless) the platform imports `app` and never calls listen().
// Locally / on Render / Railway we must listen after Mongo is ready.
const isServerless = Boolean(process.env.VERCEL);
if (!isServerless) {
  connectToMongoDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
      });
    })
    .catch((error) => {
      console.error("Failed to start server:", error.message);
      process.exit(1);
    });
} else {
  // Warm the connection for the first serverless invocation.
  void connectToMongoDB().catch(() => undefined);
}

export default app;
