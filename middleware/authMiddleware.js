import jwt from "jsonwebtoken";


const jwtSecret = () => process.env["JWT_SECRET"] || "your_jwt_secret_key";

export const verifyTokenCookie = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ success: false, message: "Unauthorized access: No token provided!" });
  }

  jwt.verify(token, jwtSecret(), (err, decoded) => {
    if (err) {
      return res.status(401).json({ success: false, message: "Unauthorized: Invalid or expired token!" });
    }

    req.user = { ...decoded, userId: decoded.id };
    next();
  });
};

export const verifyAuth = verifyTokenCookie;