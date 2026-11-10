import { signAccessToken, getJwtCookieName, getJwtCookieOptions, getCsrfCookieName } from "../lib/jwt.js";
import { issueCsrfCookie } from "../lib/csrf.js";

export async function issueAccessToken(req, res) {
  try {
    // requireBetterAuthSession middleware must run before this handler.
    const session = req.auth?.session;
    const user = req.user;
    if (!session || !user) {
      return res.status(401).json({ success: false, message: "Unauthorized: Please log in", code: "UNAUTHENTICATED" });
    }

    const { token, expiresAt, expiresInSeconds } = signAccessToken({
      user,
      session: session.session || session,
    });

    res.cookie(getJwtCookieName(), token, getJwtCookieOptions(expiresInSeconds * 1000));
    const csrfToken = issueCsrfCookie(res);

    return res.status(200).json({
      success: true,
      message: "Access token issued",
      expiresAt,
      tokenType: "Bearer-cookie",
      csrfToken,
    });
  } catch (error) {
    console.error("Issue access token error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to issue access token" });
  }
}

export async function clearAccessToken(req, res) {
  try {
    const cookieBase = { path: "/", sameSite: "lax", secure: false };
    // Clear with common option variants to handle env differences safely.
    res.clearCookie(getJwtCookieName(), { path: "/" });
    res.clearCookie(getJwtCookieName(), cookieBase);
    res.clearCookie(getJwtCookieName(), { path: "/", sameSite: "none", secure: true });
    res.clearCookie(getCsrfCookieName(), { path: "/" });
    res.clearCookie(getCsrfCookieName(), cookieBase);
    res.clearCookie(getCsrfCookieName(), { path: "/", sameSite: "none", secure: true });
    return res.status(200).json({ success: true, message: "Access token cleared" });
  } catch (error) {
    console.error("Clear access token error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to clear access token" });
  }
}

export async function getCsrfToken(req, res) {
  try {
    // Requires authenticated Better Auth session to avoid anonymous CSRF token minting abuse patterns.
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized: Please log in", code: "UNAUTHENTICATED" });
    }
    const csrfToken = issueCsrfCookie(res);
    return res.status(200).json({ success: true, csrfToken });
  } catch (error) {
    console.error("Get CSRF token error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to issue CSRF token" });
  }
}
