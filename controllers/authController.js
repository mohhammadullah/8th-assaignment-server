import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { ObjectId } from "mongodb";

// Read lazily: this module is imported before dotenv.config() runs in index.js.
const jwtSecret = () => process.env["JWT_SECRET"] || "your_jwt_secret_key";
const googleClientId = () => process.env["GOOGLE_CLIENT_ID"];

function issueSessionCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    secure: false, // local dev over http; set true only behind https
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

/**
 * POST /api/auth/google
 * Verifies a Google ID token, upserts the user, and sets the same
 * HTTPOnly `token` cookie used by email/password auth.
 */
export const googleUser = async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ success: false, message: "Google credential is required" });
    }
    if (!googleClientId()) {
      return res.status(500).json({ success: false, message: "Google client not configured on server" });
    }

    const oauthClient = new OAuth2Client(googleClientId());
    const ticket = await oauthClient.verifyIdToken({
      idToken: credential,
      audience: googleClientId(),
    });
    const payload = ticket.getPayload();

    const email = payload.email;
    const name = payload.name || payload.given_name || "";
    const picture = payload.picture || "";

    if (!email) {
      return res.status(400).json({ success: false, message: "Google account has no email" });
    }
    if (payload.email_verified === false) {
      return res.status(401).json({ success: false, message: "Google email is not verified" });
    }

    const usersCollection = req.app.locals.usersCollection;
    if (!usersCollection) {
      return res.status(500).json({ success: false, message: "Users collection not initialized" });
    }

    let user = await usersCollection.findOne({ email });
    if (!user) {
      const result = await usersCollection.insertOne({
        name,
        email,
        photoUrl: picture,
        createdAt: new Date(),
      });
      user = await usersCollection.findOne({ _id: result.insertedId });
    } else if (!user.photoUrl && picture) {
      await usersCollection.updateOne({ _id: user._id }, { $set: { photoUrl: picture } });
      user.photoUrl = picture;
    }

    const token = jwt.sign({ id: user._id, email: user.email }, jwtSecret(), { expiresIn: "7d" });
    issueSessionCookie(res, token);

    return res.status(200).json({
      success: true,
      message: "Google sign-in successful",
      user: { id: user._id, name: user.name, email: user.email, photoUrl: user.photoUrl },
    });
  } catch (error) {
    console.error("Google Auth Error:", error?.message || error);
    return res.status(401).json({ success: false, message: "Invalid Google token" });
  }
};

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

    const token = jwt.sign({ id: result.insertedId, email }, jwtSecret(), { expiresIn: "7d" });

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

    const token = jwt.sign({ id: user._id, email: user.email }, jwtSecret(), { expiresIn: "7d" });

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

    const decoded = jwt.verify(token, jwtSecret());
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