import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { getJwtCookieName, verifyAccessToken } from "../lib/jwt.js";

function toReqUser(user) {
  const { id, name, email, image } = user || {};
  return {
    id,
    userId: id,
    name,
    email,
    image,
    photoUrl: image,
  };
}

async function resolveBetterAuthSession(req) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session?.user) return null;
  return session;
}

export async function resolveRequestAuth(req) {
  const tokenName = getJwtCookieName();
  const token = req.cookies?.[tokenName];

  if (token) {
    try {
      const claims = verifyAccessToken(token);
      // Session-bound validation for revocation consistency with Better Auth logout/session invalidation.
      const session = await resolveBetterAuthSession(req);
      if (!session?.user) {
        return { ok: false, status: 401, message: "Unauthorized: session invalid or expired", code: "SESSION_INVALID" };
      }

      const sessionId = String(session.session?.id || "");
      if (claims.sid && sessionId && String(claims.sid) !== sessionId) {
        return { ok: false, status: 401, message: "Unauthorized: token session mismatch", code: "TOKEN_SESSION_MISMATCH" };
      }

      if (String(session.user.id) !== String(claims.sub || claims.uid)) {
        return { ok: false, status: 401, message: "Unauthorized: token user mismatch", code: "TOKEN_USER_MISMATCH" };
      }

      return {
        ok: true,
        strategy: "jwt",
        user: toReqUser(session.user),
        claims,
        session,
      };
    } catch (error) {
      const name = error?.name || "";
      if (name === "TokenExpiredError") {
        return { ok: false, status: 401, message: "Unauthorized: JWT expired", code: "TOKEN_EXPIRED" };
      }
      return { ok: false, status: 401, message: "Unauthorized: invalid JWT", code: "TOKEN_INVALID" };
    }
  }

  // Compatibility fallback (frontend not yet updated): allow verified Better Auth session.
  try {
    const session = await resolveBetterAuthSession(req);
    if (!session?.user) {
      return { ok: false, status: 401, message: "Unauthorized: Please log in", code: "UNAUTHENTICATED" };
    }
    return { ok: true, strategy: "better-auth-session", user: toReqUser(session.user), session };
  } catch {
    return { ok: false, status: 500, message: "Failed to verify authentication", code: "AUTH_VERIFY_FAILED" };
  }
}

export async function verifyHybridAuth(req, res, next) {
  const result = await resolveRequestAuth(req);
  if (!result.ok) {
    return res.status(result.status).json({
      success: false,
      message: result.message,
      code: result.code,
    });
  }
  req.user = result.user;
  req.auth = { strategy: result.strategy, claims: result.claims || null, session: result.session || null };
  return next();
}

export async function requireBetterAuthSession(req, res, next) {
  try {
    const session = await resolveBetterAuthSession(req);
    if (!session?.user) {
      return res.status(401).json({ success: false, message: "Unauthorized: Please log in", code: "UNAUTHENTICATED" });
    }
    req.user = toReqUser(session.user);
    req.auth = { strategy: "better-auth-session", session };
    return next();
  } catch (error) {
    console.error("Better Auth session check error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to verify session" });
  }
}
