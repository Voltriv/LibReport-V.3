'use strict';

// Rate limiters.
//
// The stores are in-memory, which is correct only while the process is single.
// ecosystem.config.js runs instances: 1, exec_mode: 'fork'. Moving to cluster
// mode would give each worker its own counters and multiply every limit below by
// the worker count -- that change needs a shared store (Redis or Mongo) first.
//
// req.ip is meaningful because server.js sets 'trust proxy' to 1 for the single
// Nginx hop in front of this process.

const rateLimit = require('express-rate-limit');

// Brute-force protection for auth endpoints. Keyed by IP; trust proxy above
// ensures req.ip reflects the real client, not the Nginx hop.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' }
});

// Password reset gets its own bucket rather than sharing the one above. A reset
// token is 32 hex characters, so guessing is the threat that matters, and the
// request endpoint can be used to flood a mailbox. Keeping the budgets separate
// also means reset attempts cannot exhaust a legitimate user's login allowance.
const passwordResetRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Please try again later.' }
});

module.exports = { authRateLimiter, passwordResetRateLimiter };
