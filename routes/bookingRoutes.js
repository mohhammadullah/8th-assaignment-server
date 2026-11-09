import express from "express";
import { createBooking, getMyBookings, getBookedSlots, deleteBooking } from "../controllers/bookingController.js";
import { verifyAuth } from "../middleware/authMiddleware.js"; // আপনার যে নামে অথ মিডেলওয়্যার আছে

const router = express.Router();

// Public: lets the booking form disable already-booked slots.
router.get("/slots", getBookedSlots);
router.post("/", verifyAuth, createBooking);
router.get("/my-bookings", verifyAuth, getMyBookings);
router.delete("/:id", verifyAuth, deleteBooking);

export default router;