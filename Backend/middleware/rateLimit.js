'use strict';

// Rate limiters, layered.
//
// Before this, only signup/admin-signup/login (20 / 15 min) and the two password
// reset routes (10 / 15 min) were limited. The other 69 endpoints had no ceiling
// at all -- including the aggregation-heavy /api/reports/* routes, which each run
// several collection scans per call.
//
// KEYING IS THE PART THAT MATTERS. The two original limiters key on IP only,
// which for a campus library means one NAT is one bucket for every student on
// site: a self-inflicted outage rather than a defence. So the general-purpose
// limiters below key on the ACCOUNT when the request carries a valid token, and
// fall back to IP only for anonymous traffic. The auth and reset limiters stay
// IP-keyed on purpose -- there is no account yet at that point, and IP is exactly
// the threat model there.
//
// The stores are in-memory, which is correct only while the process is single.
// ecosystem.config.js runs instances: 1, exec_mode: 'fork'. Moving to cluster mode
// would give each worker its own counters and multiply every limit here by the
// worker count; that change needs a shared store (Redis or Mongo) first.
//
// req.ip is meaningful because server.js sets 'trust proxy' to 1 for the single
// Nginx hop in front of this process.

const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const { JWT_SECRET } = require('../config');

const MINUTE = 60 * 1000;
const FIFTEEN_MINUTES = 15 * MINUTE;

// Limits are env-overridable so a test can run with a tight ceiling without
// waiting out a real window. Defaults are the production values.
function envInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

const LIMITS = {
  api: envInt('RATE_LIMIT_API_MAX', 300),
  mutation: envInt('RATE_LIMIT_MUTATION_MAX', 60),
  report: envInt('RATE_LIMIT_REPORT_MAX', 30),
  auth: envInt('RATE_LIMIT_AUTH_MAX', 20),
  reset: envInt('RATE_LIMIT_RESET_MAX', 10)
};

// Verifies rather than merely decoding: a decoded-but-unverified `sub` would let
// anyone mint a fresh bucket per request by editing the claim. Verification is an
// HMAC check, so this costs nothing measurable, and it runs before the auth gate
// has memoized a verdict on the request.
function identityKey(req) {
  const [, token] = (req.headers.authorization || '').split(' ');
  if (token) {
    try {
      const claims = jwt.verify(token, JWT_SECRET);
      if (claims?.sub) return `u:${claims.sub}`;
    } catch {
      // Fall through to IP: an invalid token is anonymous traffic.
    }
  }
  return `ip:${req.ip}`;
}

function buildLimiter({ windowMs, limit, message, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
    ...(keyGenerator ? { keyGenerator } : {})
  });
}

// Brute-force protection for auth endpoints. Keyed by IP; trust proxy ensures
// req.ip reflects the real client, not the Nginx hop.
const authRateLimiter = buildLimiter({
  windowMs: FIFTEEN_MINUTES,
  limit: LIMITS.auth,
  message: 'Too many attempts. Please try again later.'
});

// Password reset gets its own bucket rather than sharing the one above. A reset
// token is 32 hex characters, so guessing is the threat that matters, and the
// request endpoint can be used to flood a mailbox. Keeping the budgets separate
// also means reset attempts cannot exhaust a legitimate user's login allowance.
const passwordResetRateLimiter = buildLimiter({
  windowMs: FIFTEEN_MINUTES,
  limit: LIMITS.reset,
  message: 'Too many password reset attempts. Please try again later.'
});

// Broad backstop against scraping and enumeration of read endpoints.
const apiBaselineLimiter = buildLimiter({
  windowMs: FIFTEEN_MINUTES,
  limit: LIMITS.api,
  message: 'Too many requests. Please slow down.',
  keyGenerator: identityKey
});

// Writes are cheap to issue and expensive to undo, so they get a much shorter
// window than the baseline.
const mutationLimiter = buildLimiter({
  windowMs: MINUTE,
  limit: LIMITS.mutation,
  message: 'Too many changes in a short period. Please slow down.',
  keyGenerator: identityKey
});

// The report and heatmap aggregations are the most expensive reads in the app.
// They are micro-cached for 15s, but a caller varying the query string defeats
// that entirely -- which is exactly what a scraper does.
const reportLimiter = buildLimiter({
  windowMs: MINUTE,
  limit: LIMITS.report,
  message: 'Too many report requests. Please slow down.',
  keyGenerator: identityKey
});

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function isReportPath(path) {
  return path.startsWith('/api/reports/') || path.startsWith('/api/heatmap/');
}

// Mounted as conditional middleware rather than as route handlers: passing a
// limiter to app.post(path, limiter) would add a route layer and change the
// registered-route list that scripts/route-parity.js guards. Same technique the
// body-limit split (S5) uses.
function mountRateLimiters(app) {
  app.use((req, res, next) => (req.path.startsWith('/api') ? apiBaselineLimiter(req, res, next) : next()));
  app.use((req, res, next) =>
    req.path.startsWith('/api') && MUTATING_METHODS.has(req.method)
      ? mutationLimiter(req, res, next)
      : next());
  app.use((req, res, next) => (isReportPath(req.path) ? reportLimiter(req, res, next) : next()));
}

module.exports = {
  LIMITS,
  identityKey,
  authRateLimiter,
  passwordResetRateLimiter,
  apiBaselineLimiter,
  mutationLimiter,
  reportLimiter,
  mountRateLimiters
};
