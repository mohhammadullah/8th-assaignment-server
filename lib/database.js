import "dotenv/config";
import { MongoClient } from "mongodb";

// Lazily-created shared MongoDB client. Used by both the Express business
// API (index.js) and Better Auth so there is exactly one connection pool.
let client;

export function getMongoClient() {
  if (!client) {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not set");
    }
    // Balance cold-start latency vs. flaky Atlas handshakes. 5s was too
    // aggressive on slow links (TLS timeouts); keep moderate budgets and let
    // the Express middleware retry on the next request.
    client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 15000,
      socketTimeoutMS: 20000,
      maxPoolSize: 10,
      minPoolSize: 0,
    });
  }
  return client;
}

export function getDbName() {
  return process.env.MONGODB_DB || "studio-space";
}

export function getMongoDb() {
  return getMongoClient().db(getDbName());
}
