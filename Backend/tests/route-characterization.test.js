'use strict';

// Characterization tests for the server.js route extraction.
//
// These assert nothing about what the API *should* do. They record what it
// currently does -- status code and response shape -- for every route in
// tests/fixtures/route-baseline.json, under three principals:
//
//   anon     no Authorization header
//   student  a valid token for a student account
//   admin    a valid token for a librarian account
//
// The auth dimension is the point. A refactor that moves a route behind the
// wrong guard still returns 200 to a valid admin token, so a happy-path-only
// suite cannot see it -- and the symptom in the UI is users being signed out
// (Frontend/src/api.js clears the session on any 401 or 403), not an error.
//
// Regenerate the snapshot deliberately, never to make a red run go green:
//   UPDATE_ROUTE_SNAPSHOT=1 npm test
//
// ./helpers must be required before ../server.js.
const {
  restoreEnv,
  probeMemoryBinary,
  resetDatabase,
  startTestServer,
  stopTestServer,
  buildAuthHeader,
  fetchJson
} = require('./helpers');
const { signature } = require('./helpers/shape');
const { seedFixtures } = require('./helpers/fixtures');

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const BASELINE = require('./fixtures/route-baseline.json');
const SNAPSHOT_PATH = path.join(__dirname, 'fixtures', 'route-behavior.json');
const UPDATING = process.env.UPDATE_ROUTE_SNAPSHOT === '1';

let app;
let baseUrl;
let fixtures;
let skip = false;
let skipReason = '';

const recorded = {};
let cacheBuster = 0;

test.before(async () => {
  await probeMemoryBinary().catch((err) => {
    skip = true;
    skipReason = (err?.message || String(err)).split('\n')[0] || 'MongoDB in-memory binary unavailable';
    process.env.NO_DB = 'true';
  });

  ({ app } = require('../server.js'));
  if (skip) return;

  baseUrl = await startTestServer(app);
  fixtures = await reseed();
});

test.after(async () => {
  if (!skip && UPDATING) {
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(recorded, null, 2)}\n`);
    console.log(`[characterization] snapshot written: ${Object.keys(recorded).length} endpoints`);
  }
  await stopTestServer();
  restoreEnv();
});

async function reseed() {
  await resetDatabase();
  return seedFixtures();
}

// Substitutes real ids into path parameters. ":id" means a different collection
// depending on the prefix, so order matters here -- /api/loans/requests/:id must
// be tested before the broader /api/loans/ case.
function concreteUrl(routePath) {
  let result = routePath;
  if (result.includes(':id')) {
    let id;
    if (result.startsWith('/api/books/')) id = fixtures.bookWithFiles._id;
    else if (result.startsWith('/api/loans/requests/')) id = fixtures.pendingRequest._id;
    else if (result.startsWith('/api/loans/')) id = fixtures.activeLoan._id;
    else if (result.startsWith('/api/admins/')) id = fixtures.staff._id;
    else if (result.startsWith('/api/faculty/')) id = fixtures.faculty._id;
    else if (result.startsWith('/api/admin/users/')) id = fixtures.student._id;
    else if (result.startsWith('/api/student/')) id = fixtures.student._id;
    // The PDF, not the cover: it is the sensitive half of the S1 exposure, so
    // this is the value whose recorded status must change when S1 is fixed.
    else if (result.startsWith('/api/files/')) id = fixtures.pdfFileId;
    else id = fixtures.student._id;
    result = result.replace(':id', String(id));
  }
  return result
    .replace(':name', 'book.pdf')
    .replace(':branch', 'Main')
    .replace(':day', '1');
}

// Only login gets a real payload -- it is cheap and exercises a path worth
// pinning. Everything else is sent empty on purpose: a validation rejection is
// just as stable a recorded behavior as a success, and inventing 35 valid
// payloads would make this suite a fixture project rather than a safety net.
function bodyFor(method, routePath) {
  if (method === 'POST' && routePath === '/api/auth/login') {
    return fixtures.credentials;
  }
  return method === 'GET' ? undefined : {};
}

async function call(method, routePath, headers) {
  // The micro-cache (finding S2) runs before the auth dispatcher and keys on
  // method:url with no identity component, so without a unique query string an
  // anon request can be served the admin response recorded moments earlier.
  // That is a real bug, covered by its own test below; here it would only make
  // these recordings depend on ordering and a 15s TTL.
  cacheBuster += 1;
  const url = `${baseUrl}${concreteUrl(routePath)}?_cb=${cacheBuster}`;
  const body = bodyFor(method, routePath);
  const options = { method, headers: { ...headers } };
  if (typeof body !== 'undefined') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const { status, body: responseBody } = await fetchJson(url, options);
  return { status, shape: signature(responseBody) };
}

const registrations = [];
for (const route of BASELINE.routes) {
  for (const routePath of route.paths) {
    for (const method of route.methods) {
      registrations.push({ method, routePath, mutating: method !== 'GET' });
    }
  }
}

// One top-level test with nested subtests, rather than 76 top-level ones: the
// database lifecycle has to surround the whole sweep, and root-level after hooks
// do not reliably run after a large batch of sibling tests.
test('route characterization', async (t) => {
  if (skip) {
    t.skip(skipReason);
    return;
  }

  for (const { method, routePath } of registrations) {
    const key = `${method} ${routePath}`;
    // eslint-disable-next-line no-await-in-loop
    await t.test(key, async () => {
      // Every route gets a pristine database, GETs included. Reseeding only
      // before mutating routes was not enough: DELETE /api/books/:id calls
      // removeStoredFile, which deletes the GridFS objects that
      // GET /api/files/:id needs, so that route recorded a 404 purely because of
      // what ran before it. A recorded observation has to depend on the route,
      // not on test order.
      fixtures = await reseed();

      const observed = {
        anon: await call(method, routePath, {}),
        student: await call(method, routePath, buildAuthHeader(fixtures.student)),
        admin: await call(method, routePath, buildAuthHeader(fixtures.librarian))
      };

      recorded[key] = observed;

      if (UPDATING) return;

      const expected = loadSnapshot()[key];
      assert.ok(expected, `${key} is missing from the snapshot. Regenerate with UPDATE_ROUTE_SNAPSHOT=1 if the route is new.`);
      for (const principal of ['anon', 'student', 'admin']) {
        assert.equal(
          observed[principal].status,
          expected[principal].status,
          `${key} [${principal}] status changed ${expected[principal].status} -> ${observed[principal].status}`
        );
        assert.equal(
          observed[principal].shape,
          expected[principal].shape,
          `${key} [${principal}] response shape changed`
        );
      }
    });
  }
});

let snapshotCache = null;
function loadSnapshot() {
  if (snapshotCache) return snapshotCache;
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      `No behavior snapshot at ${path.relative(process.cwd(), SNAPSHOT_PATH)}. Create it with: UPDATE_ROUTE_SNAPSHOT=1 npm test`
    );
  }
  snapshotCache = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  return snapshotCache;
}
