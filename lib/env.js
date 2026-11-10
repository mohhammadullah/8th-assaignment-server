import "dotenv/config";

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export function validateEnv() {
  // Required for DB + Better Auth in all environments.
  requireEnv("MONGODB_URI");
  requireEnv("BETTER_AUTH_SECRET");
  // Required for JWT HTTPOnly cookie access-token layer.
  requireEnv("JWT_ACCESS_SECRET");

  if (String(process.env.JWT_ACCESS_SECRET).length < 32) {
    throw new Error("JWT_ACCESS_SECRET must be at least 32 characters");
  }

  if (process.env.NODE_ENV === "production") {
    requireEnv("BETTER_AUTH_URL");
    requireEnv("FRONTEND_URL");
    if (!String(process.env.BETTER_AUTH_URL).startsWith("https://")) {
      throw new Error("BETTER_AUTH_URL must use https:// in production");
    }
    if (String(process.env.BETTER_AUTH_SECRET).length < 32) {
      throw new Error(
        "BETTER_AUTH_SECRET must be at least 32 characters in production"
      );
    }
  }

  return {
    nodeEnv: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT || 5000),
    dbName: process.env.MONGODB_DB || "studio-space",
  };
}
