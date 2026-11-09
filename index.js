import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import { MongoClient, ObjectId } from "mongodb";
import authRoutes from "./routes/authRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import { verifyTokenCookie } from "./middleware/authMiddleware.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

// CORS Configuration
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());


const client = new MongoClient(process.env.MONGODB_URI);

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


const verifyToken = (req, res, next) => {
  const cookieToken = req.cookies?.token;
  if (cookieToken) {
    return verifyTokenCookie(req, res, next);
  }
 
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ success: false, message: "Unauthorized: No token provided!" });
  }
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ success: false, message: "Unauthorized: Invalid or expired token!" });
    }
    req.user = { ...decoded, userId: decoded.id };
    next();
  });
};

// Routes
app.use("/api/auth", authRoutes);
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

app.get("/api/studios/user/:email", async (req, res) => {
  try {
    const email = req.params.email;
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


app.post("/api/studios", verifyToken, async (req, res) => {
  try {
    const studioData = req.body;
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

app.put("/api/studios/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid studio ID format" });
    }
    const updatedData = req.body;
    const studiosCollection = client.db("studio-space").collection("studios");

    await studiosCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    res.status(200).json({ success: true, message: "Studio updated successfully!" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update studio" });
  }
});

app.delete("/api/studios/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid studio ID format" });
    }
    const studiosCollection = client.db("studio-space").collection("studios");
    await studiosCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).json({ success: true, message: "Studio deleted successfully!" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete studio" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});