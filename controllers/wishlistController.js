import { ObjectId } from "mongodb";

function collections(req) {
  return {
    wishlist: req.app.locals.wishlistCollection,
    studios: req.app.locals.studiosCollection,
  };
}

/** GET /api/wishlist — the logged-in user's saved studios (full docs). */
export const listWishlist = async (req, res) => {
  try {
    const { wishlist, studios } = collections(req);
    if (!wishlist || !studios) {
      return res.status(500).json({ message: "Wishlist collection not initialized" });
    }

    const entries = await wishlist
      .find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .toArray();

    const ids = entries
      .map((e) => e.studioId)
      .filter((id) => ObjectId.isValid(id));

    if (ids.length === 0) {
      return res.status(200).json({ success: true, studios: [] });
    }

    const studioDocs = await studios
      .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
      .toArray();

    // Keep wishlist order, drop any stale entries for deleted studios.
    const byId = new Map(studioDocs.map((s) => [String(s._id), s]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

    res.status(200).json({ success: true, studios: ordered });
  } catch (error) {
    console.error("List Wishlist Error:", error);
    res.status(500).json({ message: "Failed to load wishlist" });
  }
};

/** GET /api/wishlist/check?studioId= — { saved: boolean } */
export const checkWishlist = async (req, res) => {
  try {
    const { studioId } = req.query;
    const { wishlist } = collections(req);
    if (!wishlist) {
      return res.status(500).json({ message: "Wishlist collection not initialized" });
    }
    if (!studioId) {
      return res.status(400).json({ success: false, message: "studioId is required" });
    }

    const entry = await wishlist.findOne({
      userId: req.user.userId,
      studioId: String(studioId),
    });

    res.status(200).json({ success: true, saved: Boolean(entry) });
  } catch (error) {
    console.error("Check Wishlist Error:", error);
    res.status(500).json({ message: "Failed to check wishlist" });
  }
};

/** POST /api/wishlist { studioId } — save a studio (idempotent). */
export const addToWishlist = async (req, res) => {
  try {
    const { studioId } = req.body || {};
    const { wishlist } = collections(req);

    if (!wishlist) {
      return res.status(500).json({ message: "Wishlist collection not initialized" });
    }
    if (!studioId) {
      return res.status(400).json({ success: false, message: "studioId is required" });
    }

    const existing = await wishlist.findOne({
      userId: req.user.userId,
      studioId: String(studioId),
    });

    if (existing) {
      return res.status(200).json({
        success: true,
        message: "Already in wishlist",
        saved: true,
      });
    }

    await wishlist.insertOne({
      userId: req.user.userId,
      studioId: String(studioId),
      createdAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: "Studio saved to wishlist",
      saved: true,
    });
  } catch (error) {
    console.error("Add Wishlist Error:", error);
    res.status(500).json({ message: "Failed to save studio" });
  }
};

/** DELETE /api/wishlist/:studioId — remove a saved studio. */
export const removeFromWishlist = async (req, res) => {
  try {
    const { wishlist } = collections(req);
    if (!wishlist) {
      return res.status(500).json({ message: "Wishlist collection not initialized" });
    }

    const result = await wishlist.deleteOne({
      userId: req.user.userId,
      studioId: String(req.params.studioId),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Saved studio not found",
        saved: false,
      });
    }

    res.status(200).json({
      success: true,
      message: "Removed from wishlist",
      saved: false,
    });
  } catch (error) {
    console.error("Remove Wishlist Error:", error);
    res.status(500).json({ message: "Failed to remove saved studio" });
  }
};
