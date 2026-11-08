import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import authRoutes from "./routes/authRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);

const client = new MongoClient(process.env.MONGODB_URI);

async function connectToMongoDB() {
  try {
    await client.connect();
    app.locals.usersCollection = client.db("studio-space").collection("users");
    console.log("Successfully connected to MongoDB!");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
}

connectToMongoDB();

app.get("/", (req, res) => {
  res.send("StudioSpace Server is Running!");
});

const handleAddStudio = async (req, res) => {
  try {
    const studioData = req.body;
    const studiosCollection = client.db("studio-space").collection("studios");
    const result = await studiosCollection.insertOne({
      ...studioData,
      createdAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: "Studio listed successfully!",
      insertedId: result.insertedId,
      studioData,
    });
  } catch (error) {
    console.error("Add Studio Error:", error);
    res.status(500).json({ success: false, message: "Failed to submit studio" });
  }
};

app.post("/api/studios", handleAddStudio);
app.post("/add-studio", handleAddStudio);

app.get("/api/categories", async (req, res) => {
  try {
    const studiosCollection = client.db("studio-space").collection("studios");
    const categories = await studiosCollection.distinct("category");
    res.status(200).json(categories);
  } catch (error) {
    console.error("Fetch Categories Error:", error);
    res.status(500).json({ message: "Failed to fetch categories" });
  }
});

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

app.get("/api/studios/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid studio ID format" });
    }
    const studiosCollection = client.db("studio-space").collection("studios");
    const studio = await studiosCollection.findOne({ _id: new ObjectId(id) });
    if (!studio) {
      return res.status(404).json({ message: "Studio not found" });
    }
    res.status(200).json(studio);
  } catch (error) {
    res.status(500).json({ message: "Server error while fetching studio" });
  }
});

app.put("/api/studios/:id", async (req, res) => {
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

app.delete("/api/studios/:id", async (req, res) => {
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

app.post("/api/bookings", async (req, res) => {
  try {
    const bookingData = req.body;
    const bookingsCollection = client.db("studio-space").collection("bookings");
    
    const newBooking = {
      ...bookingData,
      status: "Pending",
      createdAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(newBooking);
    res.status(201).json({ success: true, message: "Studio booked successfully!", bookingId: result.insertedId });
  } catch (error) {
    res.status(500).json({ message: "Booking failed" });
  }
});

app.get("/api/bookings/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const bookingsCollection = client.db("studio-space").collection("bookings");
    const bookings = await bookingsCollection.find({ userEmail: email }).toArray();
    res.status(200).json(bookings);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch bookings" });
  }
});

app.patch("/api/bookings/:id/cancel", async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid booking ID format" });
    }
    const bookingsCollection = client.db("studio-space").collection("bookings");
    await bookingsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "Cancelled" } }
    );
    res.status(200).json({ success: true, message: "Booking cancelled successfully!" });
  } catch (error) {
    res.status(500).json({ message: "Failed to cancel booking" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});