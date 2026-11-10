import express from "express";
import {
  listWishlist,
  checkWishlist,
  addToWishlist,
  removeFromWishlist,
} from "../controllers/wishlistController.js";
import { verifyAuth } from "../middleware/authMiddleware.js";
import { csrfAndOriginProtection } from "../lib/csrf.js";

const router = express.Router();

router.get("/", verifyAuth, listWishlist);
router.get("/check", verifyAuth, checkWishlist);
router.post("/", csrfAndOriginProtection, verifyAuth, addToWishlist);
router.delete("/:studioId", csrfAndOriginProtection, verifyAuth, removeFromWishlist);

export default router;
