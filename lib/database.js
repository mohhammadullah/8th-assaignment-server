import "dotenv/config";
import { MongoClient } from "mongodb";

// Lazily-created shared MongoDB client. Used by both the Express business
// API (index.js) and Better Auth so there is exactly one connection pool.
let client;

function getSafeMongoTarget() {
  const uri = process.env.MONGODB_URI || "";
  try {
    const normalized = uri
      .replace(/^mongodb\+srv:\/\//i, "https://")
      .replace(/^mongodb:\/\//i, "http://");
    const parsed = new URL(normalized);
    return {
      scheme: uri.startsWith("mongodb+srv://") ? "mongodb+srv" : (uri.startsWith("mongodb://") ? "mongodb" : "unknown"),
      host: parsed.hostname || "(unknown-host)",
      srv: uri.startsWith("mongodb+srv://"),
    };
  } catch {
    return { scheme: "unknown", host: "(unparseable-uri)", srv: false };
  }
}

export function describeMongoConnectionError(error) {
  const message = String(error?.message || "");
  const name = String(error?.name || "Error");
  const code = error?.code || error?.cause?.code || null;
  const reason = error?.reason;
  const reasonType = reason?.type || reason?.name || null;
  const target = getSafeMongoTarget();

  let category = "unknown";
  let hint = "Check MongoDB URI format, network access, and server logs.";

  if (/MONGODB_URI is not set/i.test(message)) {
    category = "configuration";
    hint = "Set MONGODB_URI in environment variables (do not commit secrets).";
  } else if (code === "ENOTFOUND" || /ENOTFOUND|getaddrinfo|querySrv|queryTxt/i.test(message)) {
    category = "dns";
    hint = "DNS/SRV lookup failed. Verify cluster hostname/SRV record and outbound DNS/network access.";
  } else if (/Authentication failed|bad auth|AuthenticationFailed|SCRAM|auth/i.test(message) && !/timed out/i.test(message)) {
    category = "authentication";
    hint = "Authentication failed. Verify database username/password, auth source/database user permissions, and URL encoding of credentials.";
  } else if (name === "MongoServerSelectionError" || /Server selection timed out/i.test(message)) {
    category = "network-or-allowlist";
    hint = "Server selection timed out. Common causes: MongoDB Atlas IP Access List blocking this host, firewall/VPN/network restrictions, paused cluster, or unreachable cluster nodes.";
  } else if (/timed out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(message) || /timed out/i.test(String(code))) {
    category = "network";
    hint = "Network/connectivity issue. Verify outbound access to MongoDB, firewall rules, and Atlas network settings.";
  } else if (/MongoParseError|Invalid scheme|URI/i.test(name + " " + message)) {
    category = "configuration";
    hint = "MongoDB URI appears malformed. Verify scheme, host, and URI structure in environment configuration.";
  }

  return {
    category,
    hint,
    name,
    message,
    code,
    reasonType,
    target,
  };
}

export function logMongoConnectionFailure(error, context = "startup") {
  const info = describeMongoConnectionError(error);
  console.error(`[MongoDB] Connection failed (${context})`);
  console.error(`[MongoDB] Category: ${info.category}`);
  console.error(`[MongoDB] Target: scheme=${info.target.scheme} host=${info.target.host} srv=${info.target.srv}`);
  console.error(`[MongoDB] Name: ${info.name}${info.code ? ` code=${String(info.code)}` : ""}${info.reasonType ? ` reason=${String(info.reasonType)}` : ""}`);
  console.error(`[MongoDB] Message: ${info.message}`);
  console.error(`[MongoDB] Hint: ${info.hint}`);
  if (info.category === "network-or-allowlist" || info.category === "network" || info.category === "dns") {
    console.error("[MongoDB] Atlas checks: ensure your current IP is allowed in Network Access, cluster is running (not paused), and your network allows outbound connections to Atlas.");
  }
  if (info.category === "authentication") {
    console.error("[MongoDB] Auth checks: verify DB user credentials/roles in Atlas and ensure special characters in the password are URL-encoded in MONGODB_URI.");
  }
}

export function getMongoClient() {
  if (!client) {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not set");
    }
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
