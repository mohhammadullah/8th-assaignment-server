import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

/** Register a new user */
export const registerUser = async (req, res) => {
  try {
    const { name, email, password, photoUrl } = req.body;
    const usersCollection = req.app.locals.usersCollection;

    if (!usersCollection) {
      return res.status(500).json({ success: false, message: "Users collection not initialized" });
    }

    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "User already exists with this email" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await usersCollection.insertOne({
      name,
      email,
      password: hashedPassword,
      photoUrl: photoUrl || "",
      createdAt: new Date(),
    });

    const token = jwt.sign({ id: result.insertedId, email }, JWT_SECRET, { expiresIn: "7d" });

    res.cookie("token", token, {
      httpOnly: true,
      secure: false, // local dev over http; set true only behind https
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token, // kept for backward compatibility; the cookie is the source of truth
      user: { id: result.insertedId, name, email, photoUrl },
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ success: false, message: "Server error during registration" });
  }
};

/** Login user */
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const usersCollection = req.app.locals.usersCollection;

    if (!usersCollection) {
      return res.status(500).json({ success: false, message: "Users collection not initialized" });
    }

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });

    res.cookie("token", token, {
      httpOnly: true,
      secure: false, // local dev over http; set true only behind https
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      success: true,
      message: "Login successful",
      token, // kept for backward compatibility; the cookie is the source of truth
      user: { id: user._id, name: user.name, email: user.email, photoUrl: user.photoUrl },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ success: false, message: "Server error during login" });
  }
};

/** Get currently authenticated user (getMe) — reads the HTTPOnly `token` cookie */
export const getMe = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    // Cookie first (the supported flow); Bearer only as a legacy fallback.
    const token = req.cookies?.token || (authHeader && authHeader.split(" ")[1]);

    if (!token) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const usersCollection = req.app.locals.usersCollection;

    if (!usersCollection) {
      return res.status(500).json({ success: false, message: "Users collection not initialized" });
    }

    const user = await usersCollection.findOne(
      { _id: new ObjectId(decoded.id) },
      { projection: { password: 0 } }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      user: { id: user._id, name: user.name, email: user.email, photoUrl: user.photoUrl },
    });
  } catch (error) {
    console.error("GetMe Error:", error);
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

/** Logout user */
export const logoutUser = async (req, res) => {
  try {
    res.clearCookie("token", {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });
    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout Error:", error);
    res.status(500).json({ success: false, message: "Server error during logout" });
  }
};