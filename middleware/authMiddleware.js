import { verifyHybridAuth, requireBetterAuthSession } from "./jwtAuthMiddleware.js";

// Hybrid API auth for protected routes:
// - prefers verified, session-bound JWT access token (HTTPOnly cookie)
// - falls back to verified Better Auth session for frontend compatibility (no frontend changes yet)
// This preserves Better Auth flows while enabling JWT-based API protection.
export const verifyAuth = verifyHybridAuth;
export const verifyTokenCookie = verifyHybridAuth;
export { requireBetterAuthSession };
