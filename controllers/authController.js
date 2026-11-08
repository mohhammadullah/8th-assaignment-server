import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;


    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const usersCollection = req.app.locals.usersCollection;
    
    if (!usersCollection) {
      return res.status(500).json({
        success: false,
        message: "Database collection not initialized",
      });
    }

    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email. Please login.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await usersCollection.insertOne({
      name: name || "User",
      email,
      password: hashedPassword,
      createdAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully!",
      userId: result.insertedId,
    });

  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const usersCollection = req.app.locals.usersCollection;
    
    if (!usersCollection) {
      return res.status(500).json({
        success: false,
        message: "Database collection not initialized",
      });
    }


    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid email or password" 
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid email or password" 
      });
    }

   
    const token = jwt.sign(
      { userId: user._id, email: user.email }, 
      process.env.JWT_SECRET || "your_jwt_secret_key", 
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful!",
      token,
      user: {
        email: user.email,
        name: user.name || "User"
      }
    });

  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};