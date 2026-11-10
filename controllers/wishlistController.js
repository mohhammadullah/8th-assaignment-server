import { ObjectId } from "mongodb";

function collections(req) {
  return {
    wishlist: req.app.locals.wishlistCollection,
    studios: req.app.locals.studiosCollection,
  };
}

export const listWishlist = async (req, res) => {
  try {
    const { wishlist, studios } = collections(req);
    if (!wishlist || !studios) {
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }

    const userId = req.user.userId || req.user.id;
    const entries = await wishlist
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();

    const ids = entries
      .map((e) => String(e.studioId))
      .filter((id) => ObjectId.isValid(id));

    if (ids.length === 0) {
      return res.status(200).json({ success: true, studios: [] });
    }

    const studioDocs = await studios
      .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
      .toArray();

    const byId = new Map(studioDocs.map((s) => [String(s._id), s]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

    return res.status(200).json({ success: true, studios: ordered });
  } catch (error) {
    console.error("List Wishlist Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load wishlist" });
  }
};

export const checkWishlist = async (req, res) => {
  try {
    const { studioId } = req.query || {};
    const { wishlist } = collections(req);
    if (!wishlist) {
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }
    if (!studioId || !ObjectId.isValid(String(studioId))) {
      return res.status(400).json({ success: false, message: "Valid studioId is required" });
    }

    const userId = req.user.userId || req.user.id;
    const entry = await wishlist.findOne({
      userId,
      studioId: String(studioId),
    });

    return res.status(200).json({ success: true, saved: Boolean(entry) });
  } catch (error) {
    console.error("Check Wishlist Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to check wishlist" });
  }
};

export const addToWishlist = async (req, res) => {
  try {
    const { studioId } = req.body || {};
    const { wishlist, studios } = collections(req);

    if (!wishlist || !studios) {
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }
    if (!studioId || !ObjectId.isValid(String(studioId))) {
      return res.status(400).json({ success: false, message: "Valid studioId is required" });
    }

    const studioIdStr = String(studioId);
    const studio = await studios.findOne({ _id: new ObjectId(studioIdStr) });
    if (!studio) {
      return res.status(404).json({ success: false, message: "Studio not found" });
    }

    const userId = req.user.userId || req.user.id;
    const existing = await wishlist.findOne({ userId, studioId: studioIdStr });
    if (existing) {
      return res.status(200).json({ success: true, message: "Already in wishlist", saved: true });
    }

    try {
      await wishlist.insertOne({ userId, studioId: studioIdStr, createdAt: new Date() });
    } catch (err) {
      if (err?.code === 11000) {
        return res.status(200).json({ success: true, message: "Already in wishlist", saved: true });
      }
      throw err;
    }

    return res.status(201).json({ success: true, message: "Studio saved to wishlist", saved: true });
  } catch (error) {
    console.error("Add Wishlist Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to save studio" });
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const { wishlist } = collections(req);
    if (!wishlist) {
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }

    const studioId = String(req.params.studioId || "");
    if (!ObjectId.isValid(studioId)) {
      return res.status(400).json({ success: false, message: "Invalid studioId" });
    }

    const userId = req.user.userId || req.user.id;
    const result = await wishlist.deleteOne({ userId, studioId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Saved studio not found", saved: false });
    }

    return res.status(200).json({ success: true, message: "Removed from wishlist", saved: false });
  } catch (error) {
    console.error("Remove Wishlist Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to remove saved studio" });
  }
};
