import express from "express";
import { loginUser, registerUser, getMe, logoutUser, googleUser } from "../controllers/authController.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/google", googleUser);
router.get("/me", getMe);
router.post("/logout", logoutUser);

export default router;