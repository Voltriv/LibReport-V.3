'use strict';

// Book.availableCopies must survive concurrent returns.
//
// The old return path read loan.returnedAt from a document already in memory,
// saved, and then incremented availableCopies unconditionally. Two requests for
// the same loan -- a double-clicked button is enough -- both saw returnedAt as
// null, both saved, and both incremented, so the catalogue gained a copy that does
// not physically exist. The delete path had the same shape.
//
// The decrement side was already atomic (guarded by availableCopies > 0), so the
// error was one-directional: counts only ever inflate, and a book eventually shows
// as available when every copy is out.
//
// These tests fire the requests concurrently rather than in sequence. A sequential
// version passes against the buggy code too, which is why the bug survived.
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

let baseUrl;
let fixtures;
let skip = false;
let skipReason = '';

test.before(async () => {
  await probeMemoryBinary().catch((err) => {
    skip = true;
    skipReason = (err?.message || String(err)).split('\n')[0] || 'MongoDB in-memory binary unavailable';
    process.env.NO_DB = 'true';
  });

  const { app } = require('../server.js');
  if (skip) return;

  baseUrl = await startTestServer(app);
});

test.after(async () => {
  await stopTestServer();
  restoreEnv();
});

async function readBook(id) {
  const { Book } = require('../models');
  return Book.findById(id).lean();
}

test('copy accounting under concurrency', async (t) => {
  if (skip) {
    t.skip(skipReason);
    return;
  }

  await t.test('concurrent returns of one loan give back exactly one copy', async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    const admin = buildAuthHeader(fixtures.librarian);
    const loan = fixtures.activeLoan;
    const before = await readBook(loan.bookId);

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        fetchJson(`${baseUrl}/api/loans/${loan._id}/return`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...admin },
          body: '{}'
        }))
    );

    const succeeded = attempts.filter((r) => r.status >= 200 && r.status < 300).length;
    assert.equal(succeeded, 1, `exactly one return may succeed, ${succeeded} did`);

    const after = await readBook(loan.bookId);
    assert.equal(
      after.availableCopies,
      before.availableCopies + 1,
      `availableCopies must rise by exactly 1 (was ${before.availableCopies}, now ${after.availableCopies})`
    );
    assert.ok(
      after.availableCopies <= after.totalCopies,
      'availableCopies must never exceed totalCopies'
    );
  });

  await t.test('a return racing a delete gives back exactly one copy', async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    const admin = buildAuthHeader(fixtures.librarian);
    const loan = fixtures.activeLoan;
    const before = await readBook(loan.bookId);

    // Both paths used to decide independently whether the loan was active, then
    // both incremented.
    const [returned, deleted] = await Promise.all([
      fetchJson(`${baseUrl}/api/loans/${loan._id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...admin },
        body: '{}'
      }),
      fetchJson(`${baseUrl}/api/loans/${loan._id}`, { method: 'DELETE', headers: admin })
    ]);

    // Either order is legitimate; what must not happen is both crediting a copy.
    assert.ok(
      [returned.status, deleted.status].some((s) => s >= 200 && s < 300),
      'at least one of the two operations must succeed'
    );

    const after = await readBook(loan.bookId);
    assert.ok(
      after.availableCopies - before.availableCopies <= 1,
      `at most one copy may be credited, got ${after.availableCopies - before.availableCopies}`
    );
    assert.ok(
      after.availableCopies <= after.totalCopies,
      'availableCopies must never exceed totalCopies'
    );
  });

  await t.test('deleting an already-returned loan credits nothing', async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    const admin = buildAuthHeader(fixtures.librarian);
    const loan = fixtures.activeLoan;

    const returned = await fetchJson(`${baseUrl}/api/loans/${loan._id}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...admin },
      body: '{}'
    });
    assert.ok(returned.status >= 200 && returned.status < 300);

    const afterReturn = await readBook(loan.bookId);
    const deleted = await fetchJson(`${baseUrl}/api/loans/${loan._id}`, { method: 'DELETE', headers: admin });
    assert.equal(deleted.status, 204);

    const afterDelete = await readBook(loan.bookId);
    assert.equal(
      afterDelete.availableCopies,
      afterReturn.availableCopies,
      'the copy was already credited by the return; deleting the record must not credit it again'
    );
  });
});
