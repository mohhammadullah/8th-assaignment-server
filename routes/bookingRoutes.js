import express from "express";
import { createBooking, getMyBookings, getBookedSlots, deleteBooking } from "../controllers/bookingController.js";
import { verifyAuth } from "../middleware/authMiddleware.js";
import { csrfAndOriginProtection } from "../lib/csrf.js";

const router = express.Router();

router.get("/slots", getBookedSlots);
router.post("/", csrfAndOriginProtection, verifyAuth, createBooking);
router.get("/my-bookings", verifyAuth, getMyBookings);
router.delete("/:id", csrfAndOriginProtection, verifyAuth, deleteBooking);

export default router;