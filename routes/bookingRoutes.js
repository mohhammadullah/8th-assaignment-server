import express from "express";
import { createBooking, getMyBookings, getBookedSlots, deleteBooking } from "../controllers/bookingController.js";
import { verifyAuth } from "../middleware/authMiddleware.js"; 

const router = express.Router();


router.get("/slots", getBookedSlots);
router.post("/", verifyAuth, createBooking);
router.get("/my-bookings", verifyAuth, getMyBookings);
router.delete("/:id", verifyAuth, deleteBooking);

export default router;