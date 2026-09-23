'use strict';

// Shared test harness: environment setup, server lifecycle, database reset, and
// authenticated request helpers. Extracted from analytics-endpoints.test.js so
// the characterization suite can reuse it rather than growing a second copy.
//
// Require this module before anything requires ../../server.js -- ./env has
// side effects that server.js reads at module scope.

const { restoreEnv } = require('./env');
const { buildMemoryServerOptions, probeMemoryBinary } = require('./memoryDb');

const { once } = require('node:events');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

let server = null;

// Resolves once mongoose has an open connection. server.js fires connectMongo()
// at module scope without awaiting it, so requiring the app does not mean the
// database is reachable yet.
async function ensureDbReady() {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  await new Promise((resolve, reject) => {
    const onError = (err) => {
      mongoose.connection.off('open', onOpen);
      reject(err);
    };
    const onOpen = () => {
      mongoose.connection.off('error', onError);
      resolve();
    };
    mongoose.connection.once('error', onError);
    mongoose.connection.once('open', onOpen);
  });
}

async function resetDatabase() {
  if (mongoose.connection.readyState !== 1) {
    await ensureDbReady();
  }
  await mongoose.connection.db.dropDatabase();
}

// Binds the app to an ephemeral port on loopback and returns its base URL.
// Takes the already-required app so the caller controls when server.js loads.
async function startTestServer(app) {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  await ensureDbReady();
  return `http://${address.address}:${address.port}`;
}

async function stopTestServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  await mongoose.disconnect();
}

// Mints a real JWT for a user document, matching what /api/auth/login issues.
function buildAuthHeader(user) {
  const token = jwt.sign(
    { sub: String(user._id), email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return { Authorization: `Bearer ${token}` };
}

// Every API error body is { error: string }, so responses are always parsed as
// JSON. Returns the status alongside the body rather than throwing, so tests can
// assert on 4xx responses directly.
async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

module.exports = {
  restoreEnv,
  buildMemoryServerOptions,
  probeMemoryBinary,
  ensureDbReady,
  resetDatabase,
  startTestServer,
  stopTestServer,
  buildAuthHeader,
  fetchJson
};
