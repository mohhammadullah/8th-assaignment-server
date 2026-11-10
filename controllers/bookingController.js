import { ObjectId } from "mongodb";

function isYmd(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function toUtcDate(dateStr) {
  // Interpret booking date as a calendar day in UTC to avoid TZ ambiguity.
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseTimeSlot(slot) {
  const match = /^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/.exec(
    String(slot || "").trim()
  );
  if (!match) return null;
  const sh = Number(match[1]);
  const sm = Number(match[2]);
  const eh = Number(match[3]);
  const em = Number(match[4]);
  if ([sh, sm, eh, em].some((n) => !Number.isInteger(n))) return null;
  if (sh < 0 || sh > 23 || eh < 0 || eh > 23 || sm < 0 || sm > 59 || em < 0 || em > 59) {
    return null;
  }
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (end <= start) return null;
  return { start, end };
}

export function slotsOverlap(a, b) {
  const rangeA = typeof a === "string" ? parseTimeSlot(a) : a;
  const rangeB = typeof b === "string" ? parseTimeSlot(b) : b;
  if (!rangeA || !rangeB) {
    return String(a).trim() === String(b).trim();
  }
  return rangeA.start < rangeB.end && rangeB.start < rangeA.end;
}

function overlapWithRange(slot, range) {
  const r = parseTimeSlot(slot);
  if (!r) return false;
  return slotsOverlap(r, range);
}

async function hasOverlap(collection, filter, range, session) {
  const active = await collection
    .find({ ...filter, status: { $in: ["Pending", "Confirmed"] } }, { session })
    .project({ timeSlot: 1, _id: 0 })
    .toArray();
  return active.some((b) => overlapWithRange(b.timeSlot, range));
}

function computePrice(hourlyRate, range) {
  const hours = (range.end - range.start) / 60;
  const value = Number(hourlyRate) * hours;
  return Math.round(value * 100) / 100;
}

export const createBooking = async (req, res) => {
  try {
    const { studioId, date, timeSlot } = req.body || {};

    if (!studioId || !date || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: "studioId, date and timeSlot are required",
      });
    }

    const studioIdStr = String(studioId);
    if (!ObjectId.isValid(studioIdStr)) {
      return res.status(400).json({ success: false, message: "Invalid studioId" });
    }

    const dateStr = String(date).trim().slice(0, 10);
    if (!isYmd(dateStr) || !toUtcDate(dateStr)) {
      return res.status(400).json({ success: false, message: "Invalid date format (YYYY-MM-DD required)" });
    }

    // Reject past dates (UTC day comparison).
    const todayUtc = new Date();
    const todayYmd = todayUtc.toISOString().slice(0, 10);
    if (dateStr < todayYmd) {
      return res.status(400).json({ success: false, message: "Cannot book a past date" });
    }

    const timeSlotStr = String(timeSlot).trim();
    const range = parseTimeSlot(timeSlotStr);
    if (!range) {
      return res.status(400).json({
        success: false,
        message: 'Invalid timeSlot (expected "HH:MM-HH:MM" 24h, end after start)',
      });
    }

    const db = req.app.locals.db;
    const bookingsCollection = req.app.locals.bookingsCollection;
    const studiosCollection = req.app.locals.studiosCollection;
    if (!bookingsCollection || !studiosCollection) {
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }

    // Server-side source of truth for studio and price.
    const studio = await studiosCollection.findOne({ _id: new ObjectId(studioIdStr) });
    if (!studio) {
      return res.status(404).json({ success: false, message: "Studio not found" });
    }
    if (studio.hourlyRate == null || Number(studio.hourlyRate) <= 0) {
      return res.status(400).json({ success: false, message: "Studio pricing is unavailable" });
    }

    const serverPrice = computePrice(studio.hourlyRate, range);
    const normalizedSlot = timeSlotStr; // keep as provided (validated) for compatibility
    const userId = req.user.userId || req.user.id;

    const buildDoc = () => ({
      userId,
      userEmail: req.user.email,
      studioId: studioIdStr,
      studioName: studio.title || String(studio.studioName || "Studio"),
      date: dateStr,
      timeSlot: normalizedSlot,
      startMin: range.start,
      endMin: range.end,
      price: serverPrice,
      currency: "USD",
      status: "Pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const insertBooking = async (session) => {
      // Check studio conflicts (overlaps) and user conflicts atomically within txn when available.
      const studioConflict = await hasOverlap(
        bookingsCollection,
        { studioId: studioIdStr, date: dateStr },
        range,
        session
      );
      if (studioConflict) {
        return { conflict: "studio" };
      }

      const userConflict = await hasOverlap(
        bookingsCollection,
        { userId, date: dateStr },
        range,
        session
      );
      if (userConflict) {
        return { conflict: "user" };
      }

      const result = await bookingsCollection.insertOne(buildDoc(), session ? { session } : undefined);
      return { result };
    };

    // Try transaction for stronger atomicity (requires replica set / Atlas).
    let outcome;
    const session = db?.client?.startSession ? db.client.startSession() : null;
    if (session) {
      try {
        outcome = await session.withTransaction(async () => insertBooking(session), {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
        });
      } catch (txError) {
        // Fallback for standalone MongoDB where transactions are unsupported.
        const msg = String(txError?.message || "");
        if (txError?.code === 20 || /Transaction numbers|replica set|not supported/i.test(msg)) {
          outcome = await insertBooking(null);
        } else if (txError?.code === 11000) {
          outcome = { duplicate: true };
        } else {
          throw txError;
        }
      } finally {
        await session.endSession();
      }
    } else {
      outcome = await insertBooking(null);
    }

    if (outcome?.conflict === "studio") {
      return res.status(409).json({ success: false, message: "Slot already booked" });
    }
    if (outcome?.conflict === "user") {
      return res.status(409).json({ success: false, message: "You already have a booking at this date and time" });
    }
    if (outcome?.duplicate) {
      return res.status(409).json({ success: false, message: "Slot already booked" });
    }

    return res.status(201).json({
      success: true,
      message: "Studio booked successfully!",
      bookingId: outcome.result.insertedId,
      price: serverPrice,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "Slot already booked" });
    }
    console.error("Booking Error:", error.message);
    return res.status(500).json({ success: false, message: "Booking failed" });
  }
};

export const getMyBookings = async (req, res) => {
  try {
    const bookingsCollection = req.app.locals.bookingsCollection;
    if (!bookingsCollection) {
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }

    const userId = req.user.userId || req.user.id;
    // Active bookings only: cancelled records are preserved in MongoDB for
    // history/auditing but must not appear in the active My Bookings list.
    const bookings = await bookingsCollection
      .find({ userId, status: { $ne: "Cancelled" } })
      .sort({ date: 1, timeSlot: 1, createdAt: -1 })
      .toArray();

    return res.status(200).json({ success: true, bookings });
  } catch (error) {
    console.error("Get My Bookings Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch bookings" });
  }
};

export const getBookedSlots = async (req, res) => {
  try {
    const { studioId, date } = req.query || {};
    if (!studioId || !date) {
      return res.status(400).json({ success: false, message: "studioId and date are required" });
    }
    const studioIdStr = String(studioId);
    if (!ObjectId.isValid(studioIdStr)) {
      return res.status(400).json({ success: false, message: "Invalid studioId" });
    }
    const dateStr = String(date).trim().slice(0, 10);
    if (!isYmd(dateStr)) {
      return res.status(400).json({ success: false, message: "Invalid date format" });
    }

    const bookingsCollection = req.app.locals.bookingsCollection;
    if (!bookingsCollection) {
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }

    const bookings = await bookingsCollection
      .find({
        studioId: studioIdStr,
        date: dateStr,
        status: { $in: ["Pending", "Confirmed"] },
      })
      .project({ timeSlot: 1, _id: 0 })
      .toArray();

    const bookedSlots = [...new Set(bookings.map((b) => b.timeSlot).filter(Boolean))];
    return res.status(200).json({ success: true, studioId: studioIdStr, date: dateStr, bookedSlots });
  } catch (error) {
    console.error("Get Booked Slots Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch booked slots" });
  }
};

export const deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid booking ID format" });
    }

    const bookingsCollection = req.app.locals.bookingsCollection;
    if (!bookingsCollection) {
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }

    const userId = req.user.userId || req.user.id;
    const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }
    if (String(booking.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: cannot cancel another user's booking" });
    }

    // Soft-cancel to preserve history and free slot (partial unique indexes ignore non-active statuses).
    if (booking.status === "Cancelled") {
      return res.status(200).json({ success: true, message: "Booking already cancelled" });
    }

    await bookingsCollection.updateOne(
      { _id: new ObjectId(id), userId },
      { $set: { status: "Cancelled", cancelledAt: new Date(), updatedAt: new Date() } }
    );

    return res.status(200).json({ success: true, message: "Booking cancelled successfully!" });
  } catch (error) {
    console.error("Delete Booking Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to cancel booking" });
  }
};
