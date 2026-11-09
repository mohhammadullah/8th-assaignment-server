import { ObjectId } from "mongodb";

/** Create a new booking for the authenticated user */
export const createBooking = async (req, res) => {
  try {
    const { studioId, studioName, date, timeSlot, price } = req.body;

    if (!studioId || !studioName || !date || !timeSlot || price == null) {
      return res.status(400).json({
        success: false,
        message: "All fields are required: studioId, studioName, date, timeSlot, price",
      });
    }

    const bookingsCollection = req.app.locals.bookingsCollection;

    if (!bookingsCollection) {
      return res.status(500).json({ message: "Bookings collection not initialized" });
    }

    // Check for conflicting bookings
    const existingBookings = await bookingsCollection.find({
      studioId,
      date,
      status: "Confirmed",
    }).toArray();

    for (const booking of existingBookings) {
      if (booking.timeSlot === timeSlot) {
        return res.status(400).json({
          success: false,
          message: "Conflict Error: This studio is already booked for the selected time slot!",
        });
      }
    }

    const newBooking = {
      userId: req.user.userId,
      studioId,
      studioName,
      date,
      timeSlot,
      price,
      status: "Pending",
      createdAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(newBooking);

    res.status(201).json({
      success: true,
      message: "Studio booked successfully!",
      bookingId: result.insertedId,
    });
  } catch (error) {
    console.error("Booking Error:", error);
    res.status(500).json({ message: "Booking failed" });
  }
};

/** Get all bookings for the logged-in user */
export const getMyBookings = async (req, res) => {
  try {
    const bookingsCollection = req.app.locals.bookingsCollection;

    if (!bookingsCollection) {
      return res.status(500).json({ message: "Bookings collection not initialized" });
    }

    const bookings = await bookingsCollection
      .find({ userId: req.user.userId })
      .toArray();

    res.status(200).json({
      success: true,
      bookings,
    });
  } catch (error) {
    console.error("Get My Bookings Error:", error);
    res.status(500).json({ message: "Failed to fetch bookings" });
  }
};

/** Delete a booking by ID */
export const deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid booking ID format" });
    }

    const bookingsCollection = req.app.locals.bookingsCollection;

    if (!bookingsCollection) {
      return res.status(500).json({ message: "Bookings collection not initialized" });
    }

    const result = await bookingsCollection.deleteOne({
      _id: new ObjectId(id),
      userId: req.user.userId, // Only allow owner to delete
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Booking not found or not authorized" });
    }

    res.status(200).json({
      success: true,
      message: "Booking cancelled successfully!",
    });
  } catch (error) {
    console.error("Delete Booking Error:", error);
    res.status(500).json({ message: "Failed to delete booking" });
  }
};