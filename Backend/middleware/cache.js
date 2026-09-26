'use strict';

// Micro-cache for read-heavy GET endpoints (15s TTL).
//
// Runs BEFORE the auth gate, which is what made finding S2 dangerous: req.user
// does not exist yet, so identity has to come from the raw Authorization header.
// Without an identity component in the key, one caller's response was served to
// the next for per-user endpoints like /api/dashboard and /api/reports/* --
// including to unauthenticated callers, who received a full admin payload with a
// 200.

const crypto = require('node:crypto');

const TTL_MS = 15_000;
const MICRO_CACHE_MAX_ENTRIES = 500;

const microCache = new Map();

// The token is hashed rather than used directly so bearer tokens are not held as
// map keys.
function cacheIdentity(req) {
  const [, token] = (req.headers.authorization || '').split(' ');
  if (!token) return 'anon';
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
}

function cacheKey(req) { return `${req.method}:${cacheIdentity(req)}:${req.originalUrl}`; }

// Drops expired entries, then oldest-first if still at the cap. A Map iterates in
// insertion order, so the first key is the oldest. Without this the cache grew
// without bound: one entry per distinct query string, never released.
function pruneMicroCache(now) {
  for (const [key, entry] of microCache) {
    if (entry.expires <= now) microCache.delete(key);
  }
  while (microCache.size >= MICRO_CACHE_MAX_ENTRIES) {
    const oldest = microCache.keys().next();
    if (oldest.done) break;
    microCache.delete(oldest.value);
  }
}

function cacheable(path) {
  return (
    path.startsWith('/api/books/library') ||
    path.startsWith('/api/reports/') ||
    path.startsWith('/api/books/lookup') ||
    path.startsWith('/api/hours') ||
    path.startsWith('/api/dashboard') ||
    path.startsWith('/api/heatmap/visits')
  );
}

function microCacheMiddleware(req, res, next) {
  if (req.method !== 'GET' || !cacheable(req.path)) return next();
  const key = cacheKey(req);
  const hit = microCache.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) {
    res.set('X-Micro-Cache', 'HIT');
    return res.status(hit.status).json(hit.body);
  }
  const json = res.json.bind(res);
  res.json = (body) => {
    const status = res.statusCode || 200;
    // Successful responses only. res.json was previously wrapped without a status
    // check, so a rejection was cached and then replayed -- an admin could be
    // served the 403 a student had just received.
    if (status >= 200 && status < 300) {
      try {
        pruneMicroCache(now);
        microCache.set(key, { body, status, expires: now + TTL_MS });
        res.set('X-Micro-Cache', 'MISS');
      } catch {}
    }
    return json(body);
  };
  next();
}

module.exports = { TTL_MS, cacheable, microCacheMiddleware };
