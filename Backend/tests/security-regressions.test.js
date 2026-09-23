'use strict';

// Regression tests for the two data exposures fixed before the route extraction
// began (S1 and S2 in REFACTOR-FINDINGS.md). These assert the intended behavior,
// unlike the characterization suite which only records whatever is current.
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
const { seedFixtures } = require('./helpers/fixtures');

const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

// Counts the collection lookups accountIsDisabled performs. GET /api/hours is
// the clean probe: it carries an inline authRequired, is also matched by the
// global dispatcher, and its own handler touches only the hours collection.
const AUTH_COLLECTIONS = new Set(['admins', 'users', 'faculty']);
async function countAuthLookups(run) {
  let lookups = 0;
  mongoose.set('debug', (collection, method) => {
    if (method === 'findOne' && AUTH_COLLECTIONS.has(collection)) lookups += 1;
  });
  try {
    await run();
  } finally {
    mongoose.set('debug', false);
  }
  return lookups;
}

let app;
let baseUrl;
let skip = false;
let skipReason = '';

test('security regressions', async (t) => {
  await probeMemoryBinary().catch((err) => {
    skip = true;
    skipReason = (err?.message || String(err)).split('\n')[0] || 'MongoDB in-memory binary unavailable';
    process.env.NO_DB = 'true';
  });

  ({ app } = require('../server.js'));

  if (skip) {
    t.skip(skipReason);
    return;
  }

  baseUrl = await startTestServer(app);

  try {
    await resetDatabase();
    const f = await seedFixtures();
    const adminHeaders = buildAuthHeader(f.librarian);
    const studentHeaders = buildAuthHeader(f.student);

    await t.test('S1: a book PDF is not readable without a token', async () => {
      const anon = await fetchJson(`${baseUrl}/api/files/${f.pdfFileId}`);
      assert.equal(anon.status, 401, 'an unauthenticated PDF read must be rejected');

      const withToken = await fetchJson(`${baseUrl}/api/files/${f.pdfFileId}`, { headers: studentHeaders });
      assert.equal(withToken.status, 200, 'an authenticated user must still be able to read it');
    });

    await t.test('S1: a disabled account cannot read a book PDF', async () => {
      const disabled = await fetchJson(`${baseUrl}/api/files/${f.pdfFileId}`, {
        headers: buildAuthHeader(f.disabledStudent)
      });
      assert.equal(disabled.status, 401);
    });

    await t.test('S1: cover images stay readable without a token', async () => {
      // Deliberate: covers render in <img src>, which cannot send an
      // Authorization header. Requiring one here would blank every book cover in
      // the catalogue, so image content types remain open by design.
      const anon = await fetchJson(`${baseUrl}/api/files/${f.coverFileId}`);
      assert.equal(anon.status, 200, 'cover images must not require a token');
    });

    await t.test('S2: a cached response is not served across users', async () => {
      // /api/dashboard is cached for 15s. The cache middleware runs before the
      // auth dispatcher, so keying on method:url alone let the next caller --
      // including an unauthenticated one -- receive the previous user's body.
      const warm = await fetchJson(`${baseUrl}/api/dashboard`, { headers: adminHeaders });
      assert.equal(warm.status, 200, 'admin should get the dashboard');

      const anon = await fetchJson(`${baseUrl}/api/dashboard`);
      assert.equal(anon.status, 401, 'an unauthenticated repeat must not be served the cached body');
      assert.ok(!anon.body?.counts, 'no dashboard payload may leak to an unauthenticated caller');

      const asStudent = await fetchJson(`${baseUrl}/api/dashboard`, { headers: studentHeaders });
      assert.equal(asStudent.status, 403, 'a student must not be served the cached admin body');
      assert.ok(!asStudent.body?.counts, 'no dashboard payload may leak to a student');
    });

    await t.test('S2: the cache still serves repeat requests to the same user', async () => {
      // The fix must not disable caching, only scope it to one identity.
      const first = await fetchJson(`${baseUrl}/api/dashboard`, { headers: adminHeaders });
      const second = await fetchJson(`${baseUrl}/api/dashboard`, { headers: adminHeaders });
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.deepEqual(second.body, first.body);
    });

    await t.test('S4: a request resolves its identity once, not twice', async () => {
      // A student token lives in `users`, so accountIsDisabled costs two lookups:
      // a miss on admins, then a hit on users. The dispatcher and the route's own
      // authRequired both ran it, making four. Memoizing the result on the
      // request halves that without removing a single role check.
      const lookups = await countAuthLookups(async () => {
        const res = await fetchJson(`${baseUrl}/api/hours?branch=Main`, { headers: studentHeaders });
        assert.equal(res.status, 200);
      });
      assert.equal(lookups, 2, `expected one identity resolution (2 lookups), saw ${lookups}`);
    });

    await t.test('S3: password reset endpoints are rate limited', async () => {
      // The limiter allows 10 per 15 minutes; the 11th must be rejected. Before
      // this, the reset token -- 32 hex characters -- could be guessed without
      // any throttle at all.
      let lastStatus = 0;
      for (let i = 0; i < 12; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetchJson(`${baseUrl}/api/auth/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: String(f.student._id), token: 'f'.repeat(32), newPassword: 'not-the-one' })
        });
        lastStatus = res.status;
        if (lastStatus === 429) break;
      }
      assert.equal(lastStatus, 429, 'repeated reset attempts must eventually be throttled');
    });

    await t.test('S2: an error response is not cached', async () => {
      // res.json was wrapped before the status was known, so a 4xx body could be
      // stored and then replayed to a caller who would otherwise have succeeded.
      const denied = await fetchJson(`${baseUrl}/api/reports/fines`, { headers: studentHeaders });
      assert.equal(denied.status, 403);

      const allowed = await fetchJson(`${baseUrl}/api/reports/fines`, { headers: adminHeaders });
      assert.equal(allowed.status, 200, 'the admin must not receive the cached 403');
      assert.ok(allowed.body?.items, 'the admin must get the real payload');
    });
  } finally {
    await stopTestServer();
    restoreEnv();
  }
});
