import { ObjectId } from "mongodb";


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

function slotsOverlap(a, b) {
  const rangeA = parseTimeSlot(a);
  const rangeB = parseTimeSlot(b);
  if (!rangeA || !rangeB) {
    return String(a).trim() === String(b).trim();
  }
  return rangeA.start < rangeB.end && rangeB.start < rangeA.end;
}


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
    const dateStr = String(date).trim().slice(0, 10);
    const timeSlotStr = String(timeSlot).trim();

    if (!parseTimeSlot(timeSlotStr)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid timeSlot (expected "HH:MM-HH:MM")',
      });
    }

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
      userId: req.user.userId, 
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
