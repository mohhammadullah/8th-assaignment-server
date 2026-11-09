import { ObjectId } from "mongodb";

/**
 * Parse a slot like "09:00-11:00" into minutes past midnight.
 * Returns { start, end } or null when it isn't a valid range.
 */
function parseTimeSlot(slot) {
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(
    String(slot).trim()
  );
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  if (end <= start) return null;
  return { start, end };
}

/**
 * True when two slots intersect. Back-to-back slots are fine:
 * 09:00-11:00 and 11:00-13:00 do NOT overlap.
 */
function slotsOverlap(a, b) {
  const rangeA = parseTimeSlot(a);
  const rangeB = parseTimeSlot(b);
  if (!rangeA || !rangeB) {
    return String(a).trim() === String(b).trim();
  }
  return rangeA.start < rangeB.end && rangeB.start < rangeA.end;
}

/** Create a new booking for the authenticated user */
export const createBooking = async (req, res) => {
  try {
    const { studioId, studioName, date, timeSlot, price } = req.body || {};

    if (!studioId || !studioName || !date || !timeSlot || price == null) {
      return res.status(400).json({
        success: false,
        message: "All fields are required: studioId, studioName, date, timeSlot, price",
      });
    }

    if (Number.isNaN(Date.parse(date))) {
      return res.status(400).json({ success: false, message: "Invalid date" });
    }

    const bookingsCollection = req.app.locals.bookingsCollection;

    if (!bookingsCollection) {
      return res.status(500).json({ message: "Bookings collection not initialized" });
    }

    const studioIdStr = String(studioId);
    const dateStr = String(date).trim().slice(0, 10); // YYYY-MM-DD from <input type="date">
    const timeSlotStr = String(timeSlot).trim();

    if (!parseTimeSlot(timeSlotStr)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid timeSlot (expected "HH:MM-HH:MM")',
      });
    }

    // 1) No overlapping slot on this studio + date, for anyone.
    //    Exact-match alone wouldn't stop 10:00-12:00 vs an existing 09:00-11:00.
    const studioBookingsOnDate = await bookingsCollection
      .find({
        studioId: studioIdStr,
        date: dateStr,
        status: { $ne: "Cancelled" },
      })
      .project({ timeSlot: 1, _id: 0 })
      .toArray();

    if (studioBookingsOnDate.some((b) => slotsOverlap(b.timeSlot, timeSlotStr))) {
      return res.status(400).json({
        success: false,
        message: "Slot already booked",
      });
    }

    // 2) Same user can't hold two bookings (any studio) with overlapping slots.
    const userBookingsOnDate = await bookingsCollection
      .find({
        userId: req.user.userId,
        date: dateStr,
        status: { $ne: "Cancelled" },
      })
      .project({ timeSlot: 1, _id: 0 })
      .toArray();

    if (userBookingsOnDate.some((b) => slotsOverlap(b.timeSlot, timeSlotStr))) {
      return res.status(400).json({
        success: false,
        message: "You already have a booking at this date and time",
      });
    }

    const newBooking = {
      userId: req.user.userId,
      studioId: studioIdStr,
      studioName,
      date: dateStr,
      timeSlot: timeSlotStr,
      price,
      status: "Pending",
      createdAt: new Date(),
    };

    try {
      const result = await bookingsCollection.insertOne(newBooking);
      return res.status(201).json({
        success: true,
        message: "Studio booked successfully!",
        bookingId: result.insertedId,
      });
    } catch (insertError) {
      // Unique-index race: two requests passed the check simultaneously.
      if (insertError.code === 11000) {
        return res.status(400).json({
          success: false,
          message: "Slot already booked",
        });
      }
      throw insertError;
    }
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
      .sort({ date: 1, timeSlot: 1 })
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

/**
 * GET /api/bookings/slots?studioId=&date=YYYY-MM-DD
 * Returns the time slots already taken for a studio on a date,
 * so the booking form can disable them in the UI.
 */
export const getBookedSlots = async (req, res) => {
  try {
    const { studioId, date } = req.query;

    if (!studioId || !date) {
      return res.status(400).json({
        success: false,
        message: "studioId and date are required",
      });
    }

    const bookingsCollection = req.app.locals.bookingsCollection;

    if (!bookingsCollection) {
      return res.status(500).json({ message: "Bookings collection not initialized" });
    }

    const bookings = await bookingsCollection
      .find({
        studioId: String(studioId),
        date: String(date).trim().slice(0, 10),
        status: { $ne: "Cancelled" },
      })
      .project({ timeSlot: 1, _id: 0 })
      .toArray();

    const bookedSlots = [...new Set(bookings.map((b) => b.timeSlot))];

    res.status(200).json({
      success: true,
      studioId: String(studioId),
      date: String(date).trim().slice(0, 10),
      bookedSlots,
    });
  } catch (error) {
    console.error("Get Booked Slots Error:", error);
    res.status(500).json({ message: "Failed to fetch booked slots" });
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
