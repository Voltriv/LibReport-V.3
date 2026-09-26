'use strict';

// Token verification and the role guards.
//
// Note that these are NOT where authorization is actually decided for most
// routes: middleware/authGate.js resolves a guard from the URL prefix for every
// /api/* request before any route runs, and that verdict is usually stricter than
// the guard the route itself passes. See tests/effective-guards.test.js for the
// effective policy per route.

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { JWT_SECRET, NO_DB } = require('../config');
const { isDbReady } = require('../db/state');
const { Admin, User, Faculty } = require('../models');
const { normalizeUserStatus, resolveUserRole } = require('../services/users');

function signToken(user) {
  const safeRole = resolveUserRole(user?.role);
  return jwt.sign({ sub: String(user._id), email: user.email, role: safeRole }, JWT_SECRET, { expiresIn: '7d' });
}

// Tokens live for 7 days, so signature alone is not enough: an account
// disabled after its token was issued must lose access immediately.
async function accountIsDisabled(sub) {
  if (NO_DB || !sub || !mongoose.isValidObjectId(sub)) return false;
  if (!(mongoose.connection.readyState === 1 || isDbReady())) return false;
  const projection = { status: 1 };
  const found =
    (await Admin.findById(sub, projection).lean())
    || (await User.findById(sub, projection).lean())
    || (await Faculty.findById(sub, projection).lean());
  if (!found) return false;
  return normalizeUserStatus(found.status) === 'disabled';
}

// Resolves the bearer token without touching the response, so a route that needs
// a verdict rather than a middleware short-circuit can share one implementation
// with authRequired. GET /api/files/:id needs exactly that: cover images must
// stay readable without a token, book PDFs must not.
//
// Memoized for the life of the request. The global dispatcher resolves a guard
// for every /api path, and 62 routes then pass a guard again as route middleware,
// so without this every authenticated request verified its JWT twice and ran
// accountIsDisabled twice -- up to six redundant collection lookups.
// Per-request caching is safe: the token cannot change mid-request, and the
// disabled check still runs afresh on the next one, which is what it is for.
const AUTH_RESULT = Symbol('authResult');

async function resolveAuth(req) {
  if (req[AUTH_RESULT]) return req[AUTH_RESULT];
  const result = await computeAuth(req);
  req[AUTH_RESULT] = result;
  return result;
}

async function computeAuth(req) {
  const header = req.headers.authorization || '';
  const [, token] = header.split(' ');
  if (!token) return { ok: false, status: 401, message: 'missing token' };
  let claims;
  try {
    claims = jwt.verify(token, JWT_SECRET);
  } catch {
    return { ok: false, status: 401, message: 'invalid token' };
  }
  if (await accountIsDisabled(claims.sub)) {
    return { ok: false, status: 401, message: 'Account is disabled', claims };
  }
  return { ok: true, claims };
}

function authRequired(req, res, next) {
  resolveAuth(req)
    .then((result) => {
      if (result.claims) req.user = result.claims;
      if (!result.ok) return res.status(result.status).json({ error: result.message });
      return next();
    })
    .catch(next);
}

function adminRequired(req, res, next) {
  return authRequired(req, res, () => {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'librarian' && role !== 'librarian_staff') {
      return res.status(403).json({ error: 'admin role required' });
    }
    return next();
  });
}

// Stricter admin middleware: only full admins and librarians
// Used for managing admin accounts so librarian_staff cannot access
function elevatedAdminRequired(req, res, next) {
  return authRequired(req, res, () => {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'librarian') {
      return res.status(403).json({ error: 'librarian or admin role required' });
    }
    return next();
  });
}

// Despite the name this admits every authenticated role, not just students: the
// student pages are also reachable by staff looking at a student's record.
function studentRequired(req, res, next) {
  return authRequired(req, res, () => {
    const role = req.user?.role;

    if (role !== 'student' && role !== 'librarian' && role !== 'admin' && role !== 'librarian_staff') {

      return res.status(403).json({ error: 'student role required' });
    }
    return next();
  });
}

module.exports = {
  signToken,
  accountIsDisabled,
  resolveAuth,
  authRequired,
  adminRequired,
  elevatedAdminRequired,
  studentRequired
};
