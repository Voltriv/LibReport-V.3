'use strict';

// Body-size ceilings, per route rather than globally.
//
// Only book create and update carry files, as base64 strings inside JSON, so
// only they need the large ceiling. Applying it globally meant every endpoint
// would buffer up to 50mb before any handler ran (finding S5).
//
// Registered as middleware rather than route handlers on purpose: app.post(path,
// parser) would add a route layer and change the registered-route list that
// scripts/route-parity.js guards. The first parser to consume a body wins, so
// the upload parser has to sit above the default one.

const express = require('express');

const UPLOAD_BODY_LIMIT = '50mb';
const DEFAULT_BODY_LIMIT = '1mb';

const uploadJsonParser = express.json({ limit: UPLOAD_BODY_LIMIT });

function acceptsUpload(req) {
  if (req.method === 'POST') return req.path === '/api/books';
  if (req.method === 'PATCH') return /^\/api\/books\/[^/]+$/.test(req.path);
  return false;
}

function mountBodyParsers(app) {
  app.use((req, res, next) => (acceptsUpload(req) ? uploadJsonParser(req, res, next) : next()));
  app.use(express.json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
}

module.exports = {
  UPLOAD_BODY_LIMIT,
  DEFAULT_BODY_LIMIT,
  acceptsUpload,
  mountBodyParsers
};
