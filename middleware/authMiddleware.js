import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";

// Resolve the Better Auth session for the incoming request and expose the
// user as `req.user` in the shape the existing controllers expect:
// { id, userId, name, email, image, photoUrl }.
//
// This is authoritative: the session is validated against the database on
// every protected request. Never trust user IDs or owner emails from the
// client body.
async function resolveSessionUser(req) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session?.user) {
    return null;
  }

  const { id, name, email, image } = session.user;

  return {
    id,
    userId: id,
    name,
    email,
    image,
    photoUrl: image,
  };
}

export async function verifyAuth(req, res, next) {
  try {
    const user = await resolveSessionUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Please log in",
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify session",
    });
  }
}

// Backwards-compatible alias. Existing routes import `verifyTokenCookie`
// (from the previous JWT implementation); they now get a Better Auth
// session check instead.
export const verifyTokenCookie = verifyAuth;
