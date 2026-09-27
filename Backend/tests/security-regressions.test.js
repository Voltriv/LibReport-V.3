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

    await t.test('S6+S7: request-reset never returns a token and never confirms an address', async () => {
      // The old handler answered 200 { ok, uid, token, expiresAt } for a known address
      // and 404 { error } for an unknown one. The token in that body is a full
      // account-takeover primitive for any address the caller names (S7), and the
      // 404/200 split confirms which addresses have accounts (S6).
      const requestReset = (email) =>
        fetchJson(`${baseUrl}/api/auth/request-reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

      const known = await requestReset('student@test.local');
      const unknown = await requestReset('definitely-not-registered@test.local');

      assert.equal(known.status, 202);
      assert.equal(unknown.status, 202, 'an unknown address must not be distinguishable');
      assert.deepEqual(known.body, unknown.body, 'both responses must be identical');

      for (const [label, res] of [['known', known], ['unknown', unknown]]) {
        const serialized = JSON.stringify(res.body || {});
        assert.ok(!/token/i.test(serialized), `${label}: no token may appear in the body`);
        assert.ok(!/uid/i.test(serialized), `${label}: no user id may appear in the body`);
      }
    });

    await t.test('S6+S7: the reset queue is visible to elevated admins only', async () => {
      // With the token undisclosed, this listing is how a request reaches a human.
      await fetchJson(`${baseUrl}/api/auth/request-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'student@test.local' })
      });

      const asStudent = await fetchJson(`${baseUrl}/api/admin/password-resets`, { headers: studentHeaders });
      assert.equal(asStudent.status, 403);

      const asAdmin = await fetchJson(`${baseUrl}/api/admin/password-resets`, { headers: adminHeaders });
      assert.equal(asAdmin.status, 200);
      assert.ok(Array.isArray(asAdmin.body?.items));
      const entry = asAdmin.body.items.find((item) => item.email === 'student@test.local');
      assert.ok(entry, 'the pending request must be listed for an admin to action');
      assert.ok(!/token/i.test(JSON.stringify(entry)), 'not even the admin listing exposes a token');
    });

    await t.test('N10: an admin setting a password actually changes the credential', async () => {
      // user.password was assigned where the schema defines passwordHash. Mongoose
      // drops unknown paths under strict mode, so this endpoint reported
      // "Password updated successfully." while the credential was untouched: the old
      // password kept working and the new one never did.
      const { User } = require('../models');
      const target = await User.findOne({ email: 'student@test.local' }).lean();

      const updated = await fetchJson(`${baseUrl}/api/admin/users/${target._id}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...adminHeaders },
        body: JSON.stringify({ password: 'ReplacementPass123' })
      });
      assert.equal(updated.status, 200);

      const login = (password) =>
        fetchJson(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: target.studentId, password })
        });

      const withNew = await login('ReplacementPass123');
      assert.equal(withNew.status, 200, 'the new password must work');

      const withOld = await login('Password123');
      assert.equal(withOld.status, 401, 'the old password must stop working');

      // Answering the request is what clears it from the queue.
      const queue = await fetchJson(`${baseUrl}/api/admin/password-resets`, { headers: adminHeaders });
      const still = (queue.body?.items || []).find((item) => item.email === 'student@test.local');
      assert.equal(still, undefined, 'setting the password must resolve the pending request');
    });

    await t.test('N5: an account with no stored hash fails closed with 401', async () => {
      // bcrypt.compare throws on an undefined hash, which surfaced as a 500 and so
      // distinguished "exists but has no password" from "does not exist".
      const { Faculty } = require('../models');
      await Faculty.collection.insertOne({
        facultyId: '04-2324-999999',
        email: 'nohash@test.local',
        fullName: 'No Hash',
        status: 'active'
      });

      const attempt = await fetchJson(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: '04-2324-999999', password: 'anything-at-all' })
      });
      assert.equal(attempt.status, 401);
      assert.equal(attempt.body?.error, 'invalid credentials');
    });
    await t.test('F2: conflict responses carry a stable code, not just prose', async () => {
      // The UI used to branch on substrings of the message, so rewording a string
      // silently changed which feedback card a student saw. These codes are the
      // contract now; the message is free prose. Both are returned, so nothing that
      // reads err.response.data.error breaks.
      const { Book, BorrowRequest } = require('../models');

      const request = (bookId) =>
        fetchJson(`${baseUrl}/api/student/borrow-requests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...studentHeaders },
          body: JSON.stringify({ bookId: String(bookId), days: 14 })
        });

      // CH-0002 is out to this student on an overdue loan, so the active-loan check
      // is the one that must fire -- it is tested before the pending-request case
      // precisely because it takes precedence.
      const borrowed = await Book.findOne({ bookCode: 'CH-0002' }).lean();
      const active = await request(borrowed._id);
      assert.equal(active.status, 400);
      assert.equal(active.body?.code, 'BORROW_ALREADY_ACTIVE');
      assert.equal(typeof active.body?.error, 'string', 'the human-readable message must remain');

      // A book with a pending request but NO active loan reaches the second check.
      const fresh = await Book.create({
        title: 'Pending Only',
        author: 'A',
        bookCode: 'CH-9001',
        totalCopies: 2,
        availableCopies: 2
      });
      const { User } = require('../models');
      const student = await User.findOne({ email: 'student@test.local' }).lean();
      await BorrowRequest.create({
        userId: student._id,
        bookId: fresh._id,
        status: 'pending',
        requestType: 'borrow',
        daysRequested: 14,
        createdAt: new Date()
      });

      const pending = await request(fresh._id);
      assert.equal(pending.status, 400);
      assert.equal(pending.body?.code, 'BORROW_REQUEST_PENDING');
      assert.equal(typeof pending.body?.error, 'string');
    });

    await t.test('F2: a signup conflict names the field that actually collided', async () => {
      // The message says "studentId or email already exists", and the old regex in
      // StudentSignUp matched both halves every time -- so a duplicate email also
      // marked the Student ID field as taken.
      const signup = (body) =>
        fetchJson(`${baseUrl}/api/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

      const base = {
        fullName: 'Fresh Student',
        password: 'Password123',
        confirmPassword: 'Password123',
        department: 'CITE'
      };

      // Existing email, brand-new student ID: only `email` may be reported.
      const emailClash = await signup({
        ...base,
        studentId: '03-2324-777777',
        email: 'student@test.local'
      });
      assert.equal(emailClash.status, 409);
      assert.equal(emailClash.body?.code, 'SIGNUP_CONFLICT');
      assert.deepEqual(emailClash.body?.fields, ['email'], 'only the colliding field may be named');

      // Existing student ID, brand-new email: only `studentId` may be reported.
      const idClash = await signup({
        ...base,
        studentId: '03-2324-000001',
        email: 'brand-new-address@test.local'
      });
      assert.equal(idClash.status, 409);
      assert.deepEqual(idClash.body?.fields, ['studentId'], 'only the colliding field may be named');
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

    await t.test('S5: only the upload routes accept a large body', async () => {
      // 2 MB of JSON: over the 1 MB default, under the 50 MB upload ceiling.
      const padding = 'x'.repeat(2 * 1024 * 1024);
      const post = (path, body) =>
        fetchJson(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...adminHeaders },
          body: JSON.stringify(body)
        });

      const rejected = await post('/api/visit/enter', { barcode: padding });
      assert.equal(rejected.status, 413, 'a non-upload route must refuse an oversized body');

      // The upload route must still accept it. It fails validation on the
      // contents, which is fine -- the point is that the body was parsed rather
      // than rejected at 413.
      const accepted = await post('/api/books', { title: 'Big', author: 'A', notes: padding });
      assert.notEqual(accepted.status, 413, 'the upload route must still accept a large body');
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
