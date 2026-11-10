import crypto from "crypto";
import { getAllowedOrigins } from "./auth.js";
import { getCsrfCookieName, getCsrfCookieOptions, getCsrfHeaderName, getJwtCookieName } from "./jwt.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function issueCsrfCookie(res) {
  const token = createCsrfToken();
  // Align with JWT/access cookie lifetime window (15 min default) but keep usable.
  res.cookie(getCsrfCookieName(), token, getCsrfCookieOptions(15 * 60 * 1000));
  return token;
}

function getRequestOrigin(req) {
  const origin = req.headers.origin;
  if (origin) return origin;
  const referer = req.headers.referer;
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function csrfAndOriginProtection(req, res, next) {
  if (SAFE_METHODS.has(String(req.method || "GET").toUpperCase())) {
    return next();
  }

  const allowedOrigins = getAllowedOrigins();
  const origin = getRequestOrigin(req);

  // For cookie-authenticated browser mutations, require a trusted Origin/Referer.
  if (!origin || !allowedOrigins.includes(origin)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: invalid origin",
      code: "CSRF_ORIGIN_INVALID",
    });
  }

  // Double-submit cookie check for defense-in-depth on cross-origin cookie auth.
  // Compatibility mode: if no JWT access cookie is present (frontend not yet updated,
  // legacy Better Auth session fallback path), enforce strict Origin check above but
  // do not require CSRF header/cookie pair yet. When JWT cookie is present, require it.
  const hasJwtCookie = Boolean(req.cookies?.[getJwtCookieName()]);
  if (!hasJwtCookie) {
    return next();
  }

  const cookieName = getCsrfCookieName();
  const headerName = getCsrfHeaderName();
  const cookieToken = req.cookies?.[cookieName];
  const headerToken = req.headers[headerName];

  if (!cookieToken || !headerToken || String(cookieToken) !== String(headerToken)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: CSRF token validation failed",
      code: "CSRF_TOKEN_INVALID",
    });
  }

  return next();
}
