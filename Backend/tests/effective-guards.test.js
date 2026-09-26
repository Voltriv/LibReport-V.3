'use strict';

// The authorization policy of the API, asserted as a table.
//
// Authorization here does not live in the route guards. A deny-by-default
// dispatcher (server.js, "Admin-only global guard for API") resolves a guard from
// the URL *prefix* for every /api/* request, and it is usually STRICTER than the
// guard the route itself passes. GET /api/reports/fines reads as `authRequired`
// at its registration site, but the dispatcher has already applied
// `adminRequired`. The route-level guards on 62 routes are largely decorative.
//
// That makes the obvious refactor -- moving handlers into routes/*.js behind
// per-router guards -- a way to silently WIDEN access on dozens of routes. This
// file exists so that cannot happen quietly: it pins the effective verdict
// (dispatcher composed with route guard) for every registered endpoint against
// four principals.
//
// It is deliberately NOT a snapshot. route-behavior.json can be regenerated with
// UPDATE_ROUTE_SNAPSHOT=1, which is the right tool for an intended change in
// status or response shape -- but it would also silently bless a change in who
// can reach a route. The policy below has to be edited by hand, in a diff a
// reviewer sees.
//
// Classes:
//   open               reachable with no token at all
//   open-by-rule       reachable with no token; refused for a business reason,
//                      identically for everyone (not an authorization decision)
//   any-auth           any valid token, any role
//   admin              admin / librarian / librarian_staff
//   elevated           admin / librarian only -- librarian_staff excluded
//   owner-or-admin     the addressed user themselves, or any admin-class role
//
// "allow" asserts only that authorization did not reject: the status is neither
// 401 nor 403. A 400 from an empty body, or a 404 because an earlier principal
// in the sweep already deleted the row, both count as allowed. This suite is
// about who gets past the gate, not what happens after.
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

const BASELINE = require('./fixtures/route-baseline.json');

// One line per registered endpoint. Adding a route without adding it here fails
// the completeness check at the bottom of this file.
const POLICY = {
  "GET /api/health": "open",
  "GET /api": "open",
  "GET /api/": "open",
  "GET /api/auth/signup": "open",
  "GET /api/auth/login": "open",
  "POST /api/auth/signup": "open",
  "POST /api/auth/admin-signup": "open-by-rule",
  "POST /api/auth/login": "open",
  "GET /api/auth/me": "any-auth",
  "GET /api/student/me": "any-auth",
  "PATCH /api/student/me": "any-auth",
  "GET /api/admins": "elevated",
  "POST /api/admins": "elevated",
  "PATCH /api/admins/:id": "elevated",
  "DELETE /api/admins/:id": "elevated",
  "GET /api/faculty": "admin",
  "POST /api/faculty": "admin",
  "PATCH /api/faculty/:id": "admin",
  "POST /api/auth/request-reset": "open",
  "POST /api/auth/reset": "open",
  "GET /api/dashboard": "admin",
  "GET /api/heatmap/visits": "admin",
  "POST /api/visit/enter": "admin",
  "POST /api/visit/exit": "admin",
  "GET /api/visits/recent": "admin",
  "GET /api/tracker/stats": "admin",
  "GET /api/tracker/logs": "admin",
  "GET /api/books/library": "any-auth",
  "GET /api/books/:id/pdf": "any-auth",
  "POST /api/books": "admin",
  "GET /api/books": "admin",
  "GET /api/books/lookup": "any-auth",
  "GET /api/books/:id": "admin",
  "PATCH /api/books/:id": "admin",
  "DELETE /api/books/:id": "admin",
  "GET /api/files/:id": "any-auth",
  "GET /api/files/:id/:name": "any-auth",
  "POST /api/loans/borrow": "admin",
  "GET /api/student/notifications/public-key": "any-auth",
  "POST /api/student/notifications/subscribe": "any-auth",
  "DELETE /api/student/notifications/subscribe": "any-auth",
  "POST /api/student/borrow-requests": "any-auth",
  "GET /api/student/borrow-requests": "any-auth",
  "POST /api/student/borrow": "any-auth",
  "POST /api/student/renew": "any-auth",
  "GET /api/loans/requests": "admin",
  "POST /api/loans/requests/:id/approve": "admin",
  "POST /api/loans/requests/:id/reject": "admin",
  "POST /api/loans/:id/renewal": "admin",
  "POST /api/loans/return": "admin",
  "POST /api/loans/:id/return": "admin",
  "POST /api/student/return": "any-auth",
  "DELETE /api/loans/:id": "admin",
  "GET /api/loans/active": "admin",
  "GET /api/loans/history": "admin",
  "GET /api/student/:id/borrowed": "owner-or-admin",
  "GET /api/student/borrowed": "any-auth",
  "GET /api/student/overdue-books": "any-auth",
  "GET /api/student/borrowing-history": "any-auth",
  "GET /api/student/visit-history": "any-auth",
  "GET /api/reports/top-books": "admin",
  "GET /api/reports/overdue": "admin",
  "GET /api/reports/top-borrowers": "admin",
  "GET /api/reports/genre-trends": "admin",
  "GET /api/reports/underutilized": "admin",
  "GET /api/reports/fines": "admin",
  "GET /api/hours": "any-auth",
  "PUT /api/hours/:branch/:day": "admin",
  "GET /api/admin/users": "admin",
  "POST /api/admin/users": "admin",
  "PATCH /api/admin/users/:id/role": "admin",
  "PATCH /api/admin/users/:id/status": "admin",
  "PATCH /api/admin/users/:id/department": "admin",
  "PATCH /api/admin/users/:id/password": "admin",
  "DELETE /api/admin/uploads/pdfs": "admin",
 // Route-level elevatedAdminRequired, stricter than the gate's adminRequired for
 // /api/admin/*: a reset queue names accounts, so librarian_staff is excluded.
 "GET /api/admin/password-resets": "elevated",
  "GET /api/users/lookup": "admin",
};

const PRINCIPALS = ['anon', 'student', 'staff', 'admin'];

// allow = authorization let the request through (status is neither 401 nor 403).
const EXPECTED = {
  open: { anon: 'allow', student: 'allow', staff: 'allow', admin: 'allow' },
  // POST /api/auth/admin-signup: the dispatcher leaves /api/auth/* open, and the
  // handler then refuses with 403 "Admin signup is disabled" whenever an admin
  // already exists. Identical for every principal, token or not -- a business
  // rule, not a guard. Pinned so that if it ever starts depending on the caller,
  // this file says so.
  'open-by-rule': { anon: 403, student: 403, staff: 403, admin: 403 },
  'any-auth': { anon: 401, student: 'allow', staff: 'allow', admin: 'allow' },
  admin: { anon: 401, student: 403, staff: 'allow', admin: 'allow' },
  elevated: { anon: 401, student: 403, staff: 403, admin: 'allow' },
  // GET /api/student/:id/borrowed checks ownership inside the handler: the
  // addressed user themselves, or any admin-class role. librarian_staff used to be
  // excluded here while passing every other admin-class route, which produced a
  // 403 that looked arbitrary (finding N8, fixed) -- hence 'allow' for staff now.
  'owner-or-admin': { anon: 401, student: 'allow', staff: 'allow', admin: 'allow' }
};

let app;
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

  ({ app } = require('../server.js'));
  if (skip) return;

  baseUrl = await startTestServer(app);
  fixtures = await reseed();
});

test.after(async () => {
  await stopTestServer();
  restoreEnv();
});

async function reseed() {
  await resetDatabase();
  return seedFixtures();
}

// Mirrors concreteUrl in route-characterization.test.js: ":id" addresses a
// different collection depending on the prefix, so the order of these tests
// matters. /api/student/:id resolves to the student themselves, which is what
// makes the ownership branch of owner-or-elevated meaningful.
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
    else if (result.startsWith('/api/files/')) id = fixtures.pdfFileId;
    else id = fixtures.student._id;
    result = result.replace(':id', String(id));
  }
  return result
    .replace(':name', 'book.pdf')
    .replace(':branch', 'Main')
    .replace(':day', '1');
}

function headersFor(principal) {
  if (principal === 'anon') return {};
  if (principal === 'student') return buildAuthHeader(fixtures.student);
  if (principal === 'staff') return buildAuthHeader(fixtures.staff);
  return buildAuthHeader(fixtures.librarian);
}

let cacheBuster = 0;

async function call(method, routePath, principal) {
  // The micro-cache keys on method + token hash + url. A unique query string per
  // call keeps one principal's cached 200 from being replayed to the next, which
  // would make this suite depend on call order and a 15s TTL.
  cacheBuster += 1;
  const url = `${baseUrl}${concreteUrl(routePath)}?_cb=${cacheBuster}`;
  const options = { method, headers: { ...headersFor(principal) } };
  if (method !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    options.body = '{}';
  }
  const { status } = await fetchJson(url, options);
  return status;
}

const registrations = [];
for (const route of BASELINE.routes) {
  for (const routePath of route.paths) {
    for (const method of route.methods) {
      registrations.push({ method, routePath });
    }
  }
}

test('effective authorization per route', async (t) => {
  if (skip) {
    t.skip(skipReason);
    return;
  }

  for (const { method, routePath } of registrations) {
    const key = `${method} ${routePath}`;
    // eslint-disable-next-line no-await-in-loop
    await t.test(key, async () => {
      const policyClass = POLICY[key];
      assert.ok(
        policyClass,
        `${key} has no entry in POLICY. A new route must declare who may reach it -- add it to the table in this file.`
      );
      const expected = EXPECTED[policyClass];
      assert.ok(expected, `unknown policy class ${JSON.stringify(policyClass)} for ${key}`);

      // A pristine database per route: the sweep includes DELETEs, and a route's
      // verdict has to depend on the route, not on what ran before it.
      fixtures = await reseed();

      for (const principal of PRINCIPALS) {
        // eslint-disable-next-line no-await-in-loop
        const status = await call(method, routePath, principal);
        const want = expected[principal];
        if (want === 'allow') {
          assert.ok(
            status !== 401 && status !== 403,
            `${key} [${principal}] expected to pass authorization (class ${policyClass}) but got ${status}`
          );
        } else {
          assert.equal(
            status,
            want,
            `${key} [${principal}] expected ${want} (class ${policyClass}) but got ${status}`
          );
        }
      }
    });
  }
});

// Guards the table against the opposite mistake: a route removed from the app but
// left in POLICY, which would quietly stop being checked.
test('the policy table matches the registered routes exactly', () => {
  const registered = new Set(registrations.map(({ method, routePath }) => `${method} ${routePath}`));
  const declared = new Set(Object.keys(POLICY));

  const missing = [...registered].filter((key) => !declared.has(key));
  const stale = [...declared].filter((key) => !registered.has(key));

  assert.deepEqual(missing, [], `routes with no POLICY entry: ${missing.join(', ')}`);
  assert.deepEqual(stale, [], `POLICY entries for routes that no longer exist: ${stale.join(', ')}`);
});
