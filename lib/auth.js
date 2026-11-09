import "dotenv/config";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { getMongoClient, getMongoDb } from "./database.js";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

// The Next.js frontend origin. Used for CORS and Better Auth cross-origin
// (frontend -> API) authentication requests.
const frontendOrigin = process.env.FRONTEND_URL || "http://localhost:3000";

function uniqueOrigins(values) {
  return [...new Set(values.filter(Boolean))];
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",

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

  trustedOrigins: uniqueOrigins([frontendOrigin, "http://localhost:3000"]),
});
