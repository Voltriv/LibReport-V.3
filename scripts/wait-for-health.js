/* Polls /api/health until ok, then exits 0 (or times out) */
const BACKEND = (process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');
const HEALTH = `${BACKEND}/api/health`;

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function isHealthy() {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4000);
    const res = await fetch(HEALTH, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const j = await res.json().catch(() => ({}));
    return !!j?.ok;
  } catch { return false; }
}

(async () => {
  const start = Date.now();
  const hardTimeout = Number(process.env.HEALTH_TIMEOUT_MS || 120000);
  const interval = 500;
  process.stdout.write(`Waiting for backend health at ${HEALTH}...\n`);
  while (Date.now() - start < hardTimeout) {
    if (await isHealthy()) {
      console.log('Backend is healthy.');
      return process.exit(0);
    }
    await wait(interval);
  }
  console.error('Timed out waiting for backend health.');
  process.exit(1);
})();

