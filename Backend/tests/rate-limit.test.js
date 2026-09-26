'use strict';

// Rate limiting, including the property that matters most: the general-purpose
// limiters key on the ACCOUNT, not the IP.
//
// Every request in this suite comes from 127.0.0.1, so an IP-keyed limiter would
// put all four principals in one bucket. That is the bug this suite is here to
// catch: for a campus library, IP-keying means one NAT is one bucket for every
// student on site, and exhausting it locks out the whole building.
//
// The limits are read from the environment at module load, so they are tightened
// HERE, before ./helpers (and therefore ../server.js) is required. Otherwise the
// suite would have to issue 300 requests to observe a single 429.
process.env.RATE_LIMIT_API_MAX = '8';
process.env.RATE_LIMIT_MUTATION_MAX = '3';
process.env.RATE_LIMIT_REPORT_MAX = '2';

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
  await resetDatabase();
  fixtures = await seedFixtures();
});

test.after(async () => {
  await stopTestServer();
  delete process.env.RATE_LIMIT_API_MAX;
  delete process.env.RATE_LIMIT_MUTATION_MAX;
  delete process.env.RATE_LIMIT_REPORT_MAX;
  restoreEnv();
});

let unique = 0;

// A fresh query string per call: /api/hours and /api/reports/* are micro-cached,
// and a cache HIT would still be counted by the limiter (it runs first) but would
// not exercise the handler. Varying the URL keeps the two concerns separate.
async function get(path, headers) {
  unique += 1;
  return fetchJson(`${baseUrl}${path}${path.includes('?') ? '&' : '?'}_u=${unique}`, { headers });
}

async function send(method, path, headers) {
  unique += 1;
  return fetchJson(`${baseUrl}${path}?_u=${unique}`, {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}'
  });
}

test('rate limiting', async (t) => {
  if (skip) {
    t.skip(skipReason);
    return;
  }

  await t.test('the baseline limiter refuses a flood with 429 and a JSON error body', async () => {
    const student = buildAuthHeader(fixtures.student);
    const statuses = [];
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { status, body } = await get('/api/hours', student);
      statuses.push(status);
      if (status === 429) {
        // The frontend reads err.response.data.error on every failure path, so a
        // 429 with a non-JSON body would surface as a blank message.
        assert.equal(typeof body?.error, 'string', '429 must carry { error: string }');
        break;
      }
    }
    assert.ok(statuses.includes(429), `expected a 429 within 10 requests, saw ${statuses.join(',')}`);
  });

  await t.test('exhausting one account does not affect another', async () => {
    // The student's bucket is already spent by the previous subtest. If the
    // limiter were IP-keyed, the admin would be refused too -- same 127.0.0.1.
    const admin = buildAuthHeader(fixtures.librarian);
    const { status } = await get('/api/hours', admin);
    assert.notEqual(status, 429, 'a second account must have its own bucket (limiter is account-keyed, not IP-keyed)');
    assert.equal(status, 200);
  });

  await t.test('an invalid token counts as anonymous rather than minting a new bucket', async () => {
    // Keying on an unverified `sub` would let a caller edit the claim and get a
    // fresh allowance per request. A forged token must fall back to the IP bucket.
    const forged = { Authorization: 'Bearer not.a.real.token' };
    const first = await get('/api/hours', forged);
    assert.equal(first.status, 401, 'a forged token is still rejected by the guard');

    const statuses = [];
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { status } = await get('/api/hours', forged);
      statuses.push(status);
      if (status === 429) break;
    }
    assert.ok(
      statuses.includes(429),
      `forged tokens must share one bucket, not get a fresh one each time; saw ${statuses.join(',')}`
    );
  });

  await t.test('mutations have a tighter bucket than reads', async () => {
    // RATE_LIMIT_MUTATION_MAX is 3 against a baseline of 8, so the mutation
    // limiter is what must trigger here.
    const admin = buildAuthHeader(fixtures.librarian);
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { status } = await send('POST', '/api/visit/enter', admin);
      statuses.push(status);
      if (status === 429) break;
    }
    assert.ok(statuses.includes(429), `expected the mutation limiter to trigger, saw ${statuses.join(',')}`);
  });

  await t.test('the report aggregations have their own tighter bucket', async () => {
    const admin = buildAuthHeader(fixtures.staff);
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { status } = await get('/api/reports/fines', admin);
      statuses.push(status);
      if (status === 429) break;
    }
    assert.ok(statuses.includes(429), `expected the report limiter to trigger, saw ${statuses.join(',')}`);
  });
});
