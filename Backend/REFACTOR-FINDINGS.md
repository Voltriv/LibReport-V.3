# Refactor findings

Defects found while extracting routes out of `server.js`, recorded rather than fixed.

Phase 1 moves handler bodies byte-identical so the move stays reviewable; everything wrong that
was noticed on the way lands here instead of in the diff. Phase 2 works this list, security first.

Status values: `open` (recorded, untouched) · `fixed in Phase 0` (had to be fixed to make the
verification work at all) · `fixed` (Phase 2).

Line numbers refer to `server.js` as of the baseline commit. They will drift as slices land; the
route baseline in `tests/fixtures/route-baseline.json` is the stable reference.

---

## Security

### S1 — `GET /api/files/:id` was unauthenticated · `server.js:2569` · **fixed in Phase 0**
The global guard's open-path allowlist exempted `/api/files/*` entirely, so the route streamed any
object out of the GridFS `uploads` bucket to anyone who could guess or observe an ObjectId. The same
bytes reached through `GET /api/books/:id/pdf` (`:2209`) *were* auth-gated — the gated route had an
open twin.

The fix could not simply require a bearer token. `Frontend/src/api.js` `resolveMediaUrl` rewrites
`/api/files/` URLs to the absolute backend origin, and they are consumed two ways that send no
Authorization header: cover images in `<img src>` (every card in the catalogue), and an "Open PDF"
anchor in `BooksLibrary.jsx`. A blanket token requirement would have blanked every book cover.

What was done instead, split by sensitivity:
- The route now resolves the stored content type first. **Image content types stay readable without
  a token** — deliberately, because `<img>` cannot send one and book jacket art is not the exposure.
  **Everything else requires a valid token**, which is the PDFs.
- `authRequired` was refactored to share a new `resolveAuth(req)` that returns a verdict instead of
  writing to the response, so the route reuses one implementation rather than a second copy of the
  token logic.
- The allowlist entry stays, now with a comment explaining that it exists so the handler can see the
  content type — not because the path is public.
- `BooksLibrary.jsx` swapped its `<a href="/api/files/...">` for the authenticated blob-fetch already
  used by `StudentCatalog.jsx`: `api.get('/books/:id/pdf', { responseType: 'blob' })`, then
  `URL.createObjectURL`.

Covered by `tests/security-regressions.test.js`: unauthenticated PDF read rejected, disabled account
rejected, cover image still served.

Residual, recorded not fixed: for non-image files the 404-vs-401 distinction still reveals whether a
given ObjectId exists, because the content type is only knowable after the lookup.

### S2 — micro-cache ignored identity and never evicted · `server.js:1079-1140` · **fixed in Phase 0**
`cacheKey` was `${req.method}:${req.originalUrl}` with no Authorization component, while the cache
covers `/api/dashboard`, `/api/reports/*` and `/api/heatmap/visits`. The middleware also runs
*before* the auth dispatcher, so the leak was not limited to authenticated peers.

Both leaks were reproduced before fixing:
- An **unauthenticated** request to `/api/dashboard` received **200 with the admin's full payload**,
  because the cached entry was returned before any guard ran.
- An admin received a **403** — the rejection cached moments earlier for a student — because
  `res.json` was wrapped without a status check, so error bodies were stored and replayed.

Three changes: the key now includes a SHA-256 hash of the bearer token (hashed so tokens are not
held as map keys, `anon` when absent); only 2xx responses are cached; and the `Map` is pruned of
expired entries and capped at 500, where before it grew without bound across distinct query strings.

Covered by `tests/security-regressions.test.js`, including a test that the cache still serves repeat
requests to the *same* user — the fix scopes caching, it does not disable it.

### S3 — password reset endpoints were not rate limited · `server.js:1837`, `:1851` · **fixed**
`authRateLimiter` (20 requests / 15 min) was applied to signup, admin-signup and login only.
`POST /api/auth/request-reset` and `POST /api/auth/reset` took none, leaving a 32-hex-character reset
token brute-forceable and the request endpoint usable to flood a mailbox.

Given a dedicated `passwordResetRateLimiter` (10 / 15 min) rather than sharing the auth bucket, so
reset attempts cannot exhaust a legitimate user's login allowance. Covered by
`tests/security-regressions.test.js`.

### S4 — every authenticated request authenticated twice · `server.js:1197-1235` · **fixed**
The global dispatcher resolves a guard for each `/api/*` path, and **62 routes** then pass a guard
again as route middleware. Each pass verified the JWT and called `accountIsDisabled`, which queries
Admin, then User, then Faculty — up to six redundant collection lookups per request.

Fixed by memoizing `resolveAuth` on the request via a `Symbol` key, rather than by stripping the 62
route-level guards: removing them risked silently dropping a role check, while memoizing leaves every
check running and only removes the duplicated work. Safe because a token cannot change mid-request,
and the disabled check still runs afresh on the next one — which is its purpose.

Verified by counting: a student-token request to `GET /api/hours` performs **2** lookups where it
previously performed 4.

### S5 — 50 MB JSON body limit applied to every endpoint · `server.js:63` · **fixed**
Uploads arrive as base64 strings inside JSON, so the ceiling was set globally rather than on the
routes that accept files. Every endpoint would therefore buffer up to 50 MB before any handler ran.

Only `POST /api/books` and `PATCH /api/books/:id` read `coverImageData` / `pdfData`. Those two keep
50 MB; everything else drops to 1 MB. Applied as middleware with a method-and-path test rather than
as route handlers — `app.post(path, parser)` would add a route layer and change the registered-route
list that `scripts/route-parity.js` guards.

`deploy/nginx-libreport.conf` still sets `client_max_body_size 50m`, which remains correct as the
outer bound for the upload routes. See I7.

### S6 — `POST /api/auth/request-reset` allows user enumeration · `server.js:1837` · **open, coupled to S7**
Returns `404 {error:'user not found'}` for an unknown email and `200 {ok,uid,token,expiresAt}` for a
known one, so the endpoint confirms which addresses have accounts. Rate limiting (S3) slows this but
does not close it.

**This cannot be fixed independently of S7.** The usual fix is to return an identical response either
way, but the success response currently carries the reset token itself — so the shapes cannot be made
to match while the token is in the body.

### S7 — the reset token is returned in the response body · `server.js:1847` · **open, needs a decision**
`return res.json({ ok: true, uid, token, expiresAt })`, with the comment "For demo we return the
token; in production, send by email." Anyone who can call the endpoint for an address obtains a valid
password-reset token for that account, which is a full account-takeover primitive.

Not fixed because it cannot be: there is no mail transport in the project, so removing the token from
the response leaves no way to complete a reset. Closing S6 and S7 together requires deciding how the
token reaches the user (SMTP, a queued mail service, or an admin-mediated flow).

Mitigating context, not a defence: neither reset route has a frontend caller (see C7), so the flow
appears unused in the shipped UI.

---

## Correctness

### C1 — the in-memory mongod is never stopped · `server.js:728` · **fixed in Phase 0 (worked around)**
`startMemoryDatabase` holds the server in a function-local `const mem`. It is never stored on a
module binding, never exported, and never stopped, so nothing outside that function can shut the
child mongod down.

Effect: `npm test` **never terminated**. Both analytics tests passed in ~145 ms, then the process
hung until the runner's timeout killed it and reported the whole file as
`testTimeoutFailure`. A verification step that never exits cannot gate a slice, so this had to be
addressed before Phase 1 could start.

Worked around by adding `--test-force-exit` to the `test` script. That hides the leak rather than
fixing it. The real fix belongs with the Phase 1 extraction of `db/connect.js`: keep the instance on
a module binding and expose a `disconnect()` that stops it, then drop the flag.

### C2 — `process.exit(1)` called from inside async helpers · `server.js:725`, `:976` · **open**
`startMemoryDatabase` and `ensureDefaultAdmin` terminate the process on failure. Once they are
modules this makes them untestable — any test that exercises a failure path kills the runner. They
should reject and let the entry point decide to exit.

### C3 — three route families depend on registration order · `server.js:2379`, `:3087` · **open**
`GET /api/books/lookup` (`:2381`) only works because it is registered above `GET /api/books/:id`
(`:2398`) — there is a comment at `:2379` saying so. `POST /api/loans/:id/renewal` (`:3087`) and
`POST /api/loans/:id/return` (`:3149`) sit in a specific position relative to the
`/api/loans/requests/:id/*` routes. Phase 1 preserves the order exactly; the durable fix is to
constrain `:id` to an ObjectId pattern so matching stops depending on file order.

`npm run routes:parity` fails on any reordering, so this is guarded during the move.

### C4 — error handling splits three ways · **open**
37 of 74 handlers have no `try/catch` and rely on Express 5 forwarding async rejections to the
handler at `:4549`. The other 37 catch locally, in three different styles: `sendError(res, err, msg)`
(`:2701`, `:2862`, `:3014`), inline `res.status(500).json({ error: err.message })`, and thrown
`HttpError`. The guards mix styles too — `authRequired` (`:1166`) is sync-with-`.then()` while
everything downstream is `async`/`await`.

### C5 — fourteen handlers exceed 100 lines · **open**
Worst first: `PATCH /api/books/:id` 153 (`:2404`), `GET /api/reports/underutilized` 139 (`:3951`),
`GET /api/reports/fines` 115 (`:4090`), `GET /api/reports/genre-trends` 115 (`:3836`),
`POST /api/loans/requests/:id/approve` 114 (`:2946`), `GET /api/loans/history` 112 (`:3306`),
`POST /api/admin/users` 105 (`:4267`).

### C6 — `fs.mkdirSync` runs at import time · `server.js:78` · **open**
Requiring `server.js` creates `Backend/uploads/` as a side effect, before any decision about whether
the process needs it. The directory is legacy anyway — binaries live in GridFS now.

### C7 — 26 routes have no frontend caller · **open, needs a decision (Q23)**
48 of 74 routes are called from `Frontend/src`. The rest have no caller there, including the entire
password-reset flow (`:1777`, `:1791`), all three `/api/faculty` routes, `PUT /api/hours/:branch/:day`,
`POST /api/loans/borrow`, `POST /api/student/borrow`, `POST /api/student/renew`,
`DELETE /api/admin/uploads/pdfs`, and `GET /api/books/lookup` — the route C3 exists to protect.

No frontend caller is not the same as no caller. Recorded, not judged.

---

## Frontend couplings (constrain Phase 2, do not change in Phase 1)

### F1 — any 401 or 403 logs the user out · `Frontend/src/api.js:150` · **open**
The axios interceptor clears the session and hard-redirects on 401 *or* 403 from any endpoint. A
route that ends up behind a different guard presents as users being randomly signed out, not as an
error. It also makes `StudentCatalog.jsx:245`'s `status === 403` PDF-permission branch dead code.

### F2 — the UI substring-matches backend error text · **open**
`StudentCatalog.jsx:172,180,188` lowercases `err.response.data.error` and matches `'pending request'`,
`'already have this book borrowed'` and `'rejected'` to choose which feedback card to show.
`StudentSignUp.jsx:113-118` regex-matches `/studentid/i` and `/email/i` against `/exists|in use|duplicate/i`.
Rewording those messages silently degrades the UI — no crash, no log.

### F3 — two 404s are swallowed into false states · **open**
`Borrowing.jsx:330` coerces a 404 on `/api/loans/requests?status=rejected` into `{items: []}`, so
losing that route makes rejected and cancelled history quietly disappear. `SignIn.jsx:40` renders a
404 on login as "Service temporarily unavailable", so a misprefixed auth route looks like an outage.

### F4 — five list-response shapes are all load-bearing · **open, deferred to Phase 3**
Bare array (`/api/admins`, `/api/books`, `/api/admin/users`), `{items}` (eleven routes), `{books}`
(`/api/student/overdue-books`), `{history}` (`/api/student/borrowing-history`), and
`{visits, page, totalPages, total}` (`/api/student/visit-history`). Wrapping a bare-array route in
`{items}` yields an empty list in the UI, not an error. `{error: string}` is read in 20+ components.

Normalizing these is a contract change across both codebases and would invalidate the
characterization tests in the same commit that changes the behavior they assert. Not a Phase 2 item.

---

## Infrastructure

### I1 — `mongodb` is used but not declared · **open**
Six scripts `require('mongodb')` directly while it appears nowhere in `Backend/package.json`; it
resolves transitively through mongoose. A mongoose bump can break `db:seed` and `db:indexes` with
no warning.

### I2 — `buildMemoryServerOptions` exists in four verbatim copies · **open**
`server.js:677`, `scripts/seed.js`, `scripts/indexes.js`, and `tests/helpers/memoryDb.js` (which
inherited it from `analytics-endpoints.test.js`). One `utils/memoryServer.js` should own it.

### I3 — `parseArgs` is hand-rolled five times · **open**
Five independent copies across `scripts/`.

### I4 — no `devDependencies`, no `engines` · **open**
`mongodb-memory-server` is a production dependency, and no Node version is pinned despite Express 5
and `node:test` both having floors.

### I5 — five scripts bypass `utils/dotenv` · **open**
`check_connection.js`, `sanitize_fields.js`, `migrate_to_atlas.js`, `indexes_clean.js` require
`dotenv` directly, defeating the project's own loader and its two-file precedence rule.

### I6 — PM2 passes only `NODE_ENV` · `ecosystem.config.js` · **open**
No `MONGO_URI`, no `JWT_SECRET`, no `env_file`, while `server.js:695` exits the process without
`JWT_SECRET`. Production boots entirely on a `Backend/.env` happening to exist on the host, and
fails at startup with no route to diagnose it.

### I7 — nginx proxies a legacy path · `deploy/nginx-libreport.conf` · **open**
The `/uploads/` location forwards to the backend's disk-static route (`server.js:81`), but uploads
live in GridFS and are served from `/api/files/:id` — the route in S1. Also
`client_max_body_size 50m` is coupled to S5 and must move with it.

### I8 — docker-compose exposes Mongo on all interfaces · `docker-compose.yml` · **open**
Publishes `27017:27017` with hardcoded `libreport:libreport`. On any shared network that is an open
database. Should bind `127.0.0.1` and take credentials from the environment.

### I9 — the seed wiped `faculty` but never repopulated it · `scripts/seed.js` · **fixed in Phase 0**
`faculty` was in the wipe list and in the summary counts, but no documents were ever inserted, so
every seeded environment reported `faculty: 0` and the three `/api/faculty` routes had nothing to
return. Fixed alongside the other Phase 0 seed work, since the characterization tests need fixtures.

### I10 — the seed had no borrow-request fixtures · `scripts/seed.js` · **fixed in Phase 0**
`borrowrequests` and `notificationsubscriptions` were never seeded, so the 15 student routes and the
114-line approval handler would have characterized against empty collections. Added: pending borrow,
pending renewal, approved, rejected and cancelled requests, one push subscription, one disabled user,
and a `librarian_staff` admin for the `adminRequired` / `elevatedAdminRequired` boundary.

`createdAt` / `updatedAt` are written explicitly — the seed uses the raw driver, so mongoose
timestamps never fire, and the borrow-request list sorts on `createdAt`.
