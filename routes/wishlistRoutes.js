import express from "express";
import {
  listWishlist,
  checkWishlist,
  addToWishlist,
  removeFromWishlist,
} from "../controllers/wishlistController.js";
import { verifyAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", verifyAuth, listWishlist);
router.get("/check", verifyAuth, checkWishlist);
router.post("/", verifyAuth, addToWishlist);
router.delete("/:studioId", verifyAuth, removeFromWishlist);

export default router;
