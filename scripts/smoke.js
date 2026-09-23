/* Simple backend smoke test (add --full for CRUD + admin checks) */
const BASE = (process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');
const API = `${BASE}/api`;

const TIMEOUT_MS = 8000;

function withTimeout(promise, ms = TIMEOUT_MS) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort('timeout'), ms);
  return promise(ac.signal).finally(() => clearTimeout(t));
}

async function jget(path, token) {
  return withTimeout((signal) => fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal }))
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
}

async function jpost(path, body, token) {
  return withTimeout((signal) => fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  })).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
}

function log(ok, msg, extra) {
  const s = ok ? '✅' : '❌';
  console.log(`${s} ${msg}${extra ? ` ${extra}` : ''}`);
}

(async () => {
  try {
    const h = await jget('/health');
    log(h.status === 200 && !!h.json?.ok, 'Health ok', JSON.stringify(h.json));
    if (!(h.json?.ok)) process.exit(2);

    const login = await jpost('/auth/login', { studentId: '03-2324-032224', password: 'Password123' });
    log(login.status === 200 && !!login.json?.token, 'Login ok', `status=${login.status}`);
    if (!login.json?.token) process.exit(3);
    const token = login.json.token;

    const d = await jget('/dashboard', token);
    log(d.status === 200 && !!d.json?.counts, 'Dashboard ok', JSON.stringify(d.json?.counts || {}));

    const facultyList = await jget('/faculty', token);
    log(facultyList.status === 200 && Array.isArray(facultyList.json), 'Faculty list ok', `count=${(facultyList.json || []).length}`);

    const b = await jget('/books/library?q=Clean', token).catch((e) => ({ error: e }));
    if (b?.error) {
      // Retry once after short delay
      await new Promise(r => setTimeout(r, 400));
      const b2 = await jget('/books/library?q=Clean', token);
      log(b2.status === 200 && Array.isArray(b2.json?.items), 'Books library ok (retry)', `count=${(b2.json?.items || []).length}`);
    } else {
      log(b.status === 200 && Array.isArray(b.json?.items), 'Books library ok', `count=${(b.json?.items || []).length}`);
    }

    const hm = await jget('/heatmap/visits', token).catch((e) => ({ error: e }));
    if (hm?.error) {
      await new Promise(r => setTimeout(r, 400));
      const hm2 = await jget('/heatmap/visits', token);
      log(hm2.status === 200 && Array.isArray(hm2.json?.items), 'Heatmap ok (retry)', `count=${(hm2.json?.items || []).length}`);
    } else {
      log(hm.status === 200 && Array.isArray(hm.json?.items), 'Heatmap ok', `count=${(hm.json?.items || []).length}`);
    }

    // Optional extended checks
    const FULL = process.argv.includes('--full');
    if (FULL) {
      // Admin users list
      const au = await jget('/admin/users', token);
      log(au.status === 200 && Array.isArray(au.json), 'Admin users ok', `count=${(au.json || []).length}`);

      // Hours
      const hrs = await jget('/hours', token);
      log(hrs.status === 200 && Array.isArray(hrs.json?.items), 'Hours ok', `count=${(hrs.json?.items || []).length}`);

      // CRUD book cycle (create → lookup → get → patch → delete)
      const rid = Math.random().toString(36).slice(2, 8);
      const title = `Smoke Book ${rid}`;
      const created = await jpost('/books', { title, author: 'Smoke Author', totalCopies: 1 }, token);
      log(created.status === 201 && created.json?._id, 'Book create ok', created.json?._id ? `id=${created.json._id}` : `status=${created.status}`);
      const bookId = created.json?._id;

      const lu = await jget(`/books/lookup?q=${encodeURIComponent(title)}`, token);
      log(lu.status === 200 && Array.isArray(lu.json?.items), 'Book lookup ok', `found=${(lu.json?.items || []).length}`);

      if (bookId) {
        const got = await jget(`/books/${bookId}`, token);
        log(got.status === 200 && got.json?._id === bookId, 'Book get ok');

        const patched = await withTimeout((signal) => fetch(`${API}/books/${bookId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ isbn: `SMOKE-${rid}` }),
          signal,
        })).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
        log(patched.status === 200 && patched.json?.isbn === `SMOKE-${rid}`, 'Book patch ok');

        const del = await withTimeout((signal) => fetch(`${API}/books/${bookId}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal,
        })).then((r) => ({ status: r.status }));
        log(del.status === 204, 'Book delete ok');
      }
    }

    console.log('Smoke tests completed. BASE=', BASE);
  } catch (e) {
    log(false, 'Smoke failed', e?.message || String(e));
    process.exit(1);
  }
})();
