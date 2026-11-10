import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ObjectId } from "mongodb";
import { toNodeHandler } from "better-auth/node";

import { validateEnv } from "./lib/env.js";
import { auth, getAllowedOrigins } from "./lib/auth.js";
import { getMongoClient, getDbName, logMongoConnectionFailure } from "./lib/database.js";
import { mongoSanitizeMiddleware } from "./lib/sanitize.js";
import { csrfAndOriginProtection } from "./lib/csrf.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import authTokenRoutes from "./routes/authTokenRoutes.js";
import { verifyAuth } from "./middleware/authMiddleware.js";
import { z } from "zod";

dotenv.config();
const env = validateEnv();

const app = express();
app.set("trust proxy", 1);
const PORT = env.port;

const allowedOrigins = getAllowedOrigins();
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser clients (curl, health checks) with no Origin.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    credentials: true,
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many authentication requests" },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests" },
});

// Better Auth owns /api/auth/*. Mounted BEFORE express.json() so the auth
// handler receives the raw request body. CORS already applied.
app.use("/api/auth", authLimiter);
app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(cookieParser());
app.use(mongoSanitizeMiddleware);
app.use("/api", apiLimiter);

// JWT access-token issuance/clear endpoints (derived from verified Better Auth session).
// Mounted on a separate namespace to avoid conflicts with Better Auth's /api/auth/* handler.
app.use("/api/session", authLimiter, authTokenRoutes);

const client = getMongoClient();
const dbName = getDbName();
let mongoReady = null;

async function ensureIndexes(db) {
  const studios = db.collection("studios");
  const bookings = db.collection("bookings");
  const wishlist = db.collection("wishlist");

  const activeOnly = { status: { $in: ["Pending", "Confirmed"] } };

  try {
    await wishlist.createIndex(
      { userId: 1, studioId: 1 },
      { unique: true, name: "uniq_user_studio" }
    );
  } catch (error) {
    console.warn("Wishlist index creation failed:", error.message);
  }

  try {
    await studios.createIndex({ ownerEmail: 1, createdAt: -1 });
    await studios.createIndex({ category: 1 });
  } catch (error) {
    console.warn("Studio index creation failed:", error.message);
  }

  try {
    await bookings.createIndex(
      { studioId: 1, date: 1, timeSlot: 1 },
      { unique: true, partialFilterExpression: activeOnly, name: "uniq_studio_date_slot" }
    );
    await bookings.createIndex(
      { userId: 1, date: 1, timeSlot: 1 },
      { unique: true, partialFilterExpression: activeOnly, name: "uniq_user_date_slot" }
    );
    await bookings.createIndex({ userId: 1, date: 1, timeSlot: 1 });
    await bookings.createIndex({ studioId: 1, date: 1 });
  } catch (error) {
    console.warn("Booking index creation failed:", error.message);
  }
}

async function connectToMongoDB() {
  if (mongoReady) return mongoReady;
  mongoReady = (async () => {
    try {
      await client.connect();
      await client.db(dbName).command({ ping: 1 });
      const db = client.db(dbName);
      app.locals.db = db;
      app.locals.usersCollection = db.collection("users");
      app.locals.bookingsCollection = db.collection("bookings");
      app.locals.studiosCollection = db.collection("studios");
      app.locals.wishlistCollection = db.collection("wishlist");

      // Background index maintenance to keep cold starts fast.
      void ensureIndexes(db);
      console.log(`Successfully connected to MongoDB (db "${dbName}")!`);
      return true;
    } catch (error) {
      mongoReady = null;
      logMongoConnectionFailure(error, "startup/connect");
      throw error;
    }
  })();
  return mongoReady;
}

// Ensure a request never runs before collections exist.
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

app.get("/api/health", async (_req, res) => {
  try {
    await client.db(dbName).command({ ping: 1 });
    return res.status(200).json({
      success: true,
      status: "ok",
      db: dbName,
      time: new Date().toISOString(),
    });
  } catch {
    return res
      .status(503)
      .json({ success: false, status: "degraded" });
  }
});

app.get("/", (_req, res) => {
  return res.status(200).json({
    success: true,
    service: "StudioSpace API",
    health: "/api/health",
  });
});

// Routes
app.use("/api/bookings", bookingRoutes);
app.use("/api/wishlist", wishlistRoutes);

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const studioCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  location: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional().default(""),
  hourlyRate: z.coerce.number().positive().max(100000),
  image: z
    .string()
    .trim()
    .url()
    .refine((v) => /^https?:\/\//i.test(v), "image must be http(s)")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  amenities: z.array(z.string().trim().max(100)).max(50).optional(),
  capacity: z.coerce.number().int().positive().max(10000).optional(),
});

const studioUpdateSchema = studioCreateSchema.partial();

app.get("/api/studios/featured", async (_req, res) => {
  try {
    const studios = await reqSafeStudios(res, app);
    if (!studios) return;
    const result = await studios
      .find({})
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ message: "Failed to fetch featured studios" });
  }
});

function reqSafeStudios(res, appRef) {
  const studios = appRef.locals.studiosCollection;
  if (!studios) {
    res.status(503).json({ success: false, message: "Database unavailable" });
    return null;
  }
  return studios;
}

// Backward-compatible endpoint; session identity is authoritative.
app.get("/api/studios/user/:email", verifyAuth, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email || "");
    if (email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: cannot access another user's listings",
      });
    }
    const studios = app.locals.studiosCollection;
    const result = await studios
      .find({ ownerEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray();
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ message: "Failed to fetch user listings" });
  }
});

// Preferred session-derived endpoint (avoids email-in-path scoping).
app.get("/api/studios/mine", verifyAuth, async (req, res) => {
  try {
    const studios = app.locals.studiosCollection;
    const result = await studios
      .find({ ownerEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray();
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ message: "Failed to fetch user listings" });
  }
});

app.get("/api/categories", async (_req, res) => {
  try {
    const studios = app.locals.studiosCollection;
    const categories = await studios.distinct("category");
    return res.status(200).json(categories.filter(Boolean));
  } catch {
    return res.status(500).json({ message: "Failed to fetch categories" });
  }
});

app.get("/api/studios", async (req, res) => {
  try {
    const { category } = req.query;
    const query = {};
    if (typeof category === "string" && category.trim()) {
      const safe = escapeRegex(category.trim().slice(0, 100));
      query.category = { $regex: new RegExp(`^${safe}$`, "i") };
    }
    const studios = app.locals.studiosCollection;
    const result = await studios.find(query).sort({ createdAt: -1 }).toArray();
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ message: "Failed to fetch studios" });
  }
});

app.post("/api/studios", csrfAndOriginProtection, verifyAuth, async (req, res) => {
  try {
    const parsed = studioCreateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid studio data",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }

    const studioData = parsed.data;
    const studios = app.locals.studiosCollection;
    const doc = {
      ...studioData,
      ownerEmail: req.user.email,
      ownerId: req.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await studios.insertOne(doc);
    return res.status(201).json({
      success: true,
      message: "Studio listed successfully!",
      insertedId: result.insertedId,
      studioData: doc,
    });
  } catch (error) {
    console.error("Add Studio Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to submit studio" });
  }
});

app.get("/api/studios/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid studio ID format" });
    }
    const studios = app.locals.studiosCollection;
    const studio = await studios.findOne({ _id: new ObjectId(id) });
    if (!studio) {
      return res.status(404).json({ success: false, message: "Studio not found" });
    }
    return res.status(200).json(studio);
  } catch {
    return res.status(500).json({ success: false, message: "Server error while fetching studio" });
  }
});

async function findOwnStudio(req, res) {
  const studios = app.locals.studiosCollection;
  const studio = await studios.findOne({ _id: new ObjectId(req.params.id) });

  if (!studio) {
    res.status(404).json({ success: false, message: "Studio not found" });
    return null;
  }

  // Prefer stable ownerId when present; fall back to ownerEmail for legacy docs.
  const ownsById = studio.ownerId && String(studio.ownerId) === String(req.user.id);
  const ownsByEmail =
    studio.ownerEmail &&
    String(studio.ownerEmail).toLowerCase() === String(req.user.email).toLowerCase();

  if (!ownsById && !ownsByEmail) {
    res.status(403).json({
      success: false,
      message: "Forbidden: you do not own this studio",
    });
    return null;
  }

  return { studios, studio };
}

app.put("/api/studios/:id", csrfAndOriginProtection, verifyAuth, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid studio ID format" });
    }

    const owned = await findOwnStudio(req, res);
    if (!owned) return;

    const parsed = studioUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid studio update data",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }

    // Never allow ownership or identity fields to be overwritten.
    const { ownerEmail, ownerId, _id, createdAt, ...rest } = parsed.data;
    void ownerEmail; void ownerId; void _id; void createdAt;

    if (Object.keys(rest).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    }

    await owned.studios.updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...rest, updatedAt: new Date() } }
    );

    return res.status(200).json({ success: true, message: "Studio updated successfully!" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update studio" });
  }
});

app.delete("/api/studios/:id", csrfAndOriginProtection, verifyAuth, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid studio ID format" });
    }

    const owned = await findOwnStudio(req, res);
    if (!owned) return;

    await owned.studios.deleteOne({ _id: new ObjectId(id) });
    return res.status(200).json({ success: true, message: "Studio deleted successfully!" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to delete studio" });
  }
});

// JSON 404 for any unmatched API route.
app.use("/api", (_req, res) => {
  return res.status(404).json({ success: false, message: "API route not found" });
});

function isProd() {
  return process.env.NODE_ENV === "production";
}

// Central JSON error handler.
app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "Request body too large" });
  }
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Invalid request body" });
  }
  if (error?.message?.includes("not allowed by CORS")) {
    return res.status(403).json({ success: false, message: "Not allowed by CORS" });
  }
  if (error?.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ success: false, message: "Invalid request" });
  }

  if (!isProd()) {
    console.error("Unhandled error:", error);
  } else {
    console.error("Unhandled error:", error?.message || "internal error");
  }

  return res.status(500).json({ success: false, message: "Internal server error" });
});

const isServerless = Boolean(process.env.VERCEL);
if (!isServerless) {
  connectToMongoDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
      });
    })
    .catch((error) => {
      console.error("Failed to start server due to MongoDB connection failure.");
      console.error("Server startup aborted (Express not listening).");
      if (process.env.NODE_ENV !== "production") {
        console.error(`Failure summary: ${error?.name || "Error"}: ${error?.message || "unknown error"}`);
      }
      process.exit(1);
    });
} else {
  void connectToMongoDB().catch(() => undefined);
}

export default app;
