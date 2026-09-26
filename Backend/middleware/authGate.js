'use strict';

// The real authorization boundary of this API.
//
// A single deny-by-default gate that resolves a guard from the URL PREFIX for
// every /api/* request. Anything not explicitly listed below requires an admin
// role, which is why adding a route accidentally makes it admin-only rather than
// public -- the safe direction.
//
// The route-level guards downstream are mostly weaker than this: a route
// registered with `authRequired` that falls through to the adminRequired branch
// here is effectively admin-only. Moving handlers into per-router guards without
// preserving this table would silently widen access on dozens of routes, so this
// gate is kept central and mounted once, ahead of every router.
//
// tests/effective-guards.test.js pins the resulting verdict for all 76 endpoints
// against four principals.

const mongoose = require('mongoose');

const { NO_DB } = require('../config');
const { isDbReady } = require('../db/state');
const { authRequired, adminRequired, studentRequired } = require('./guards');

function authGate(req, res, next) {
  if (!req.path.startsWith('/api')) return next();
  const open =
    req.path === '/api' ||
    req.path === '/api/' ||
    req.path === '/api/health' ||
    req.path.startsWith('/api/auth/') ||
    // Not public: the file route enforces its own check, because whether a token
    // is required depends on the stored content type (cover image vs book PDF)
    // and that is only knowable after a database lookup.
    req.path === '/api/files' ||
    req.path.startsWith('/api/files/');
  if (open) return next();

  // Checked here, above the guard branches, rather than below them. It used to
  // sit after the sharedAuth and /api/student early returns, so those routes
  // never reached it: with Mongo down they threw a raw Mongoose error from
  // inside a handler instead of returning this 503 (finding N4). Auth routes
  // are exempt because they return at the `open` check above -- POST
  // /api/auth/login keeps its own copy of this check for that reason.
  if (!NO_DB && !(mongoose.connection.readyState === 1 || isDbReady())) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  // Routes that any authenticated user (students or librarians) can access
  const sharedAuthPaths = [
    '/api/books/library',
    '/api/books/lookup',
    '/api/hours'
  ];
  if (sharedAuthPaths.some((p) => req.path.startsWith(p)) || (req.path.startsWith('/api/books/') && req.path.endsWith('/pdf'))) {
    return authRequired(req, res, next);
  }

  // Student specific APIs
  if (req.path.startsWith('/api/student/')) {
    return studentRequired(req, res, next);
  }

  return adminRequired(req, res, next);
}

module.exports = { authGate };
