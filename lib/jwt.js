import jwt from "jsonwebtoken";

const DEFAULT_ISSUER = process.env.JWT_ISSUER || process.env.BETTER_AUTH_URL || "studio-space-api";
const DEFAULT_AUDIENCE = process.env.JWT_AUDIENCE || process.env.FRONTEND_URL || "studio-space-client";
const DEFAULT_TTL_SECONDS = Math.max(60, Number(process.env.JWT_ACCESS_TTL_SECONDS || 900));
const ALGORITHM = "HS256";

export function getJwtConfig() {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || String(secret).trim().length < 32) {
    throw new Error("JWT_ACCESS_SECRET must be configured (min 32 chars)");
  }

  return {
    secret,
    issuer: String(DEFAULT_ISSUER),
    audience: String(DEFAULT_AUDIENCE),
    expiresInSeconds: DEFAULT_TTL_SECONDS,
    algorithm: ALGORITHM,
  };
}

export function getJwtCookieName() {
  const configured = process.env.JWT_COOKIE_NAME;
  if (configured) return configured;
  const isHttps = String(process.env.BETTER_AUTH_URL || "").startsWith("https://");
  return isHttps ? "__Host-studio_access" : "studio_access";
}

export function getCsrfCookieName() {
  return process.env.CSRF_COOKIE_NAME || "studio_csrf";
}

export function getCsrfHeaderName() {
  return String(process.env.CSRF_HEADER_NAME || "x-csrf-token").toLowerCase();
}

function isProductionHttps() {
  return process.env.NODE_ENV === "production" || String(process.env.BETTER_AUTH_URL || "").startsWith("https://");
}

export function getJwtCookieOptions(maxAgeMs) {
  const prodLike = isProductionHttps();
  const sameSite =
    process.env.JWT_COOKIE_SAMESITE ||
    (String(process.env.BETTER_AUTH_URL || "").startsWith("https://") ? "none" : "lax");
  const secure =
    typeof process.env.JWT_COOKIE_SECURE === "string"
      ? process.env.JWT_COOKIE_SECURE === "true"
      : prodLike;
  const options = {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    maxAge: maxAgeMs,
  };
  if (process.env.JWT_COOKIE_DOMAIN) options.domain = process.env.JWT_COOKIE_DOMAIN;
  return options;
}

export function getCsrfCookieOptions(maxAgeMs) {
  const prodLike = isProductionHttps();
  const sameSite =
    process.env.JWT_COOKIE_SAMESITE ||
    (String(process.env.BETTER_AUTH_URL || "").startsWith("https://") ? "none" : "lax");
  const secure =
    typeof process.env.JWT_COOKIE_SECURE === "string"
      ? process.env.JWT_COOKIE_SECURE === "true"
      : prodLike;
  const options = {
    httpOnly: false, // must be readable by frontend to echo in header (double-submit)
    secure,
    sameSite,
    path: "/",
    maxAge: maxAgeMs,
  };
  if (process.env.JWT_COOKIE_DOMAIN) options.domain = process.env.JWT_COOKIE_DOMAIN;
  return options;
}

export function signAccessToken({ user, session }) {
  const cfg = getJwtConfig();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(user.id),
    uid: String(user.id),
    email: user.email,
    name: user.name || "",
    sid: String(session.id || session.session?.id || session.token || ""),
    typ: "access",
    iat: now,
  };

  const token = jwt.sign(payload, cfg.secret, {
    algorithm: cfg.algorithm,
    issuer: cfg.issuer,
    audience: cfg.audience,
    expiresIn: cfg.expiresInSeconds,
  });

  const decoded = jwt.decode(token);
  const expMs = decoded && typeof decoded === "object" && decoded.exp ? decoded.exp * 1000 : Date.now() + cfg.expiresInSeconds * 1000;
  return { token, expiresAt: new Date(expMs).toISOString(), expiresInSeconds: cfg.expiresInSeconds };
}

export function verifyAccessToken(token) {
  const cfg = getJwtConfig();
  return jwt.verify(token, cfg.secret, {
    algorithms: [cfg.algorithm],
    issuer: cfg.issuer,
    audience: cfg.audience,
    clockTolerance: 10,
  });
}
