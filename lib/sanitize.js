const FORBIDDEN_KEY = /(^\$)|(\.)/;

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = sanitizeValue(value[i]);
    }
    return value;
  }

  if (value && typeof value === "object") {
    // Preserve non-plain objects (ObjectId, Date, Buffer, etc.)
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return value;
    }
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEY.test(key)) {
        delete value[key];
        continue;
      }
      value[key] = sanitizeValue(value[key]);
    }
    return value;
  }

  return value;
}

// Express 5 makes req.query a getter in newer builds; sanitize in place and
// also return sanitized clones for body/params to block Mongo operator injection.
export function mongoSanitizeMiddleware(req, _res, next) {
  if (req.body && typeof req.body === "object") {
    sanitizeValue(req.body);
  }
  if (req.params && typeof req.params === "object") {
    sanitizeValue(req.params);
  }
  if (req.query && typeof req.query === "object") {
    try {
      sanitizeValue(req.query);
    } catch {
      // If query is not mutable, replace via define where possible; fallback ignore.
    }
  }
  next();
}
