import "dotenv/config";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { getMongoClient, getMongoDb } from "./database.js";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

// The Next.js frontend origins. FRONTEND_URL may be a single origin or a
// comma-separated list for production (e.g. "https://app.example.com,
// https://www.example.com"). Used for CORS and Better Auth cross-origin
// (frontend -> API) authentication requests. Localhost is always trusted
// for development.
function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function getAllowedOrigins() {
  return [
    ...new Set([
      ...parseOrigins(process.env.FRONTEND_URL),
      ...parseOrigins(process.env.BETTER_AUTH_TRUSTED_ORIGINS),
      "http://localhost:3000",
    ]),
  ];
}

function uniqueOrigins(values) {
  return [...new Set(values.filter(Boolean))];
}

const baseURL = (process.env.BETTER_AUTH_URL || "http://localhost:5000").replace(/\/+$/, "");
// When the API is served over HTTPS on a different origin than the frontend,
// the browser requires SameSite=None; Secure cookies or cross-origin auth
// POSTs will not send the session cookie. On HTTP localhost we must keep
// Lax (Secure cookies cannot be set on http).
const isHttps = baseURL.startsWith("https://");

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,

  // Better Auth stores its own collections in the same MongoDB database:
  // `user`, `session`, `account`, `verification`. The existing business
  // collections (`studios`, `bookings`, `wishlist`, `users`) stay untouched.
  database: mongodbAdapter(getMongoDb(), {
    client: getMongoClient(),
  }),

  emailAndPassword: {
    enabled: true,
  },

  // Google OAuth is only enabled when credentials are configured.
  socialProviders:
    googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        }
      : {},

  trustedOrigins: uniqueOrigins(getAllowedOrigins()),

  advanced: isHttps
    ? {
        // NOTE: `partitioned: true` (CHIPS) must NOT be set here. Partitioned
        // cookies are only sent inside partitioned/embed contexts, so the
        // session cookie would be set but never sent on the frontend's
        // cross-origin fetch to /api/auth/get-session — breaking session
        // persistence (and effectively Google login) in production.
        defaultCookieAttributes: {
          sameSite: "none",
          secure: true,
        },
      }
    : undefined,
});
