/* Cross-platform guided start:
 * - Picks first free frontend port from candidates (env PORT/FRONTEND_PORT, then 3000,3001,3002,3010,3020)
 * - Starts backend in memory DB mode
 * - Starts CRA frontend with chosen PORT
 * - Opens browser after backend health is ready (reuses open-after-healthy.js)
 * - Cleans up child processes on exit
 */
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

function log(msg) { process.stdout.write(`[guided] ${msg}\n`); }
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

async function pickPort() {
  const envPort = Number(process.env.FRONTEND_PORT || process.env.PORT || 0);
  const candidates = [envPort].filter(Boolean).concat([3000, 3001, 3002, 3010, 3020, 3030]);
  for (const p of candidates) {
    // brief retry loop in case something races us
    for (let i = 0; i < 2; i++) {
      if (await isPortFree(p)) return p;
      await wait(150);
    }
  }
  return 0; // let CRA auto-pick if all busy (it will choose next)
}

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd || process.cwd(),
    windowsHide: true,
  });
  child.on('exit', (code) => log(`${cmd} exited with code ${code}`));
  return child;
}

(async () => {
  const port = await pickPort();
  if (port) log(`Frontend will use port ${port}`);
  else log('All common ports busy; letting CRA choose a free port.');

  const children = [];
  const killAll = () => {
    for (const c of children) {
      try { if (!c.killed) c.kill(); } catch {}
    }
  };
  process.on('SIGINT', () => { killAll(); process.exit(0); });
  process.on('SIGTERM', () => { killAll(); process.exit(0); });
  process.on('exit', () => killAll());

  // Backend in-memory DB
  const backend = run('npm', ['run', 'dev:backend:memory']);
  children.push(backend);

  // Open browser after backend is healthy
  const frontendUrl = `http://localhost:${port || 3000}`;
  const opener = run('node', [path.join('scripts', 'open-after-healthy.js')], { env: { FRONTEND_URL: frontendUrl } });
  children.push(opener);

  // Frontend CRA
  const feEnv = { PORT: String(port || 3000), BROWSER: process.env.BROWSER || 'edge' };
  const frontend = run('npm', ['--prefix', 'Frontend', 'run', 'start'], { env: feEnv });
  children.push(frontend);

  // If any child exits with non-zero, shut down others
  const onExit = (name) => (code) => {
    if (typeof code === 'number' && code !== 0) {
      log(`${name} exited with ${code}; shutting down others.`);
      killAll();
      process.exit(code);
    }
  };
  backend.on('exit', onExit('backend'));
  frontend.on('exit', onExit('frontend'));
})();

