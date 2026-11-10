import express from "express";
import { requireBetterAuthSession } from "../middleware/jwtAuthMiddleware.js";
import { clearAccessToken, getCsrfToken, issueAccessToken } from "../controllers/authTokenController.js";

const router = express.Router();

// Issuance requires an existing verified Better Auth session.
router.post("/token", requireBetterAuthSession, issueAccessToken);
router.post("/token/refresh", requireBetterAuthSession, issueAccessToken);
router.get("/csrf", requireBetterAuthSession, getCsrfToken);
// Clearing can be called without a valid session (e.g. expired session/logout cleanup).
router.post("/token/clear", clearAccessToken);

export default router;
