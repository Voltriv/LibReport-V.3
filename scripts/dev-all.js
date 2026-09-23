/* One-terminal dev stack: database + backend + frontend.
 *
 *   npm run dev
 *
 * Phases, in order:
 *   [env]      ensure Backend/.env exists and has a JWT_SECRET
 *   [db]       start a persistent mongod on 27017 (data in .mongo-data/)
 *   [seed]     indexes + admin account + sample catalog (all idempotent)
 *   [backend]  npm --prefix Backend run dev
 *   [frontend] npm --prefix Frontend start
 *
 * Ctrl+C stops all three. The database directory survives.
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'Backend');
const ENV_FILE = path.join(BACKEND, '.env');
const ENV_EXAMPLE = path.join(BACKEND, '.env.example');
const DB_PATH = path.join(ROOT, '.mongo-data');
const MONGO_PORT = Number(process.env.MONGO_PORT || 27017);
const MONGO_VERSION = process.env.MONGO_MEMORY_VERSION || '7.0.14';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Dev defaults. Only ever written into a .env that does not exist yet.
const DEV_ENV = {
  NODE_ENV: 'development',
  BACKEND_PORT: '4000',
  MONGO_URI: `mongodb://127.0.0.1:${MONGO_PORT}/libreport`,
  DB_NAME: 'libreport',
  ADMIN_ID: '03-2324-032224',
  ADMIN_NAME: 'Librarian',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'Password123',
  ALLOW_ADMIN_SIGNUP: 'false'
};

function log(scope, msg) {
  process.stdout.write(`[${scope}] ${msg}\n`);
}

function fail(scope, msg) {
  process.stderr.write(`[${scope}] ${msg}\n`);
  process.exit(1);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- [env] ------------------------------------------------------------------

function readEnvValue(contents, key) {
  const match = contents.match(new RegExp(`^[ \\t]*${key}[ \\t]*=(.*)$`, 'm'));
  return match ? match[1].trim() : null;
}

function writeEnvFile() {
  if (IS_PRODUCTION) {
    fail('env', 'Refusing to generate a dev Backend/.env with NODE_ENV=production. Create it by hand.');
  }
  let contents = fs.existsSync(ENV_EXAMPLE) ? fs.readFileSync(ENV_EXAMPLE, 'utf8') : '';
  const { gen } = require(path.join(BACKEND, 'scripts', 'generate_jwt_secret.js'));
  const values = { ...DEV_ENV, JWT_SECRET: gen(48) };

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'm');
    contents = pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
  }

  fs.writeFileSync(ENV_FILE, contents, { mode: 0o600 });
  log('env', 'created Backend/.env with dev defaults (gitignored)');
}

function ensureEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    writeEnvFile();
    return;
  }

  const contents = fs.readFileSync(ENV_FILE, 'utf8');
  if (readEnvValue(contents, 'JWT_SECRET')) {
    log('env', 'Backend/.env ok');
    return;
  }

  const { gen } = require(path.join(BACKEND, 'scripts', 'generate_jwt_secret.js'));
  const line = `JWT_SECRET=${gen(48)}`;
  const pattern = /^[ \t]*JWT_SECRET[ \t]*=.*$/m;
  const patched = pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
  fs.writeFileSync(ENV_FILE, patched);
  log('env', 'filled in the missing JWT_SECRET');
}

function loadEnv() {
  const env = require(path.join(BACKEND, 'utils', 'dotenv.js'));
  env.config({ path: ENV_FILE });
}

// --- [db] -------------------------------------------------------------------

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

async function pickFrontendPort() {
  const envPort = Number(process.env.FRONTEND_PORT || process.env.PORT || 0);
  const candidates = [envPort].filter(Boolean).concat([3000, 3001, 3002, 3010, 3020, 3030]);
  for (const p of candidates) {
    for (let i = 0; i < 2; i += 1) {
      if (await isPortFree(p)) return p;
      await wait(150);
    }
  }
  return 0; // let CRA pick
}

/* A half-finished download leaves a truncated mongod in the cache that macOS
 * kills on exec ("spawn Unknown system error -88"), and mongodb-memory-server
 * reuses it forever because the file exists. Exec it once; if it can't run,
 * drop it so the next create() re-downloads a good copy. */
function discardBrokenBinary() {
  const dir = process.env.MONGOMS_DOWNLOAD_DIR
    || process.env.MONGO_MEMORY_DOWNLOAD_DIR
    || path.join(os.homedir(), '.cache', 'mongodb-binaries');
  const binary = path.join(dir, `mongod-${process.arch}-${process.platform}-${MONGO_VERSION}`);
  if (!fs.existsSync(binary)) return;

  const probe = spawnSync(binary, ['--version'], { stdio: 'ignore', timeout: 20000 });
  if (probe.status === 0) return;

  log('db', `cached mongod ${MONGO_VERSION} is unusable; removing it so a fresh copy downloads`);
  try { fs.rmSync(binary, { force: true }); } catch {}
}

/* True when MONGO_URI points somewhere other than this machine (Atlas, a
 * staging box). Starting a local mongod in that case wastes a process and
 * misleads: the seed steps and the backend would both talk to the remote. */
function usingRemoteMongo() {
  const uri = (process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) return false;
  if (uri.startsWith('mongodb+srv://')) return true;
  const host = uri.replace(/^mongodb:\/\//, '').replace(/^[^@]*@/, '').split(/[/?,]/)[0];
  const name = host.split(':')[0].toLowerCase();
  return Boolean(name) && name !== 'localhost' && name !== '127.0.0.1' && name !== '::1';
}

async function startDatabase() {
  if (usingRemoteMongo()) {
    log('db', 'MONGO_URI points at a remote database — not starting a local mongod');
    return null;
  }

  if (await isPortOpen(MONGO_PORT)) {
    log('db', `reusing mongod already listening on ${MONGO_PORT}`);
    return null;
  }

  fs.mkdirSync(DB_PATH, { recursive: true });
  discardBrokenBinary();

  let MongoMemoryServer;
  try {
    ({ MongoMemoryServer } = require(path.join(BACKEND, 'node_modules', 'mongodb-memory-server')));
  } catch {
    fail('db', 'mongodb-memory-server is not installed. Run "npm run setup" first.');
  }

  try {
    // Not actually in-memory: a real mongod process pointed at a persistent
    // dbPath, using the binary mongodb-memory-server already caches for us.
    const mongo = await MongoMemoryServer.create({
      binary: { version: MONGO_VERSION },
      instance: {
        port: MONGO_PORT,
        portGeneration: false,
        dbPath: DB_PATH,
        storageEngine: 'wiredTiger'
      }
    });
    log('db', `mongod up on ${MONGO_PORT} (data: ${path.relative(ROOT, DB_PATH)}/)`);
    return mongo;
  } catch (err) {
    process.stderr.write(`[db] failed to start mongod: ${err?.message || err}\n`);
    fail(
      'db',
      'Install a local MongoDB ("brew install mongodb-community" then "brew services start mongodb-community") '
        + `and re-run, or free port ${MONGO_PORT} if something else is holding it.`
    );
  }
  return null;
}

// --- [seed] -----------------------------------------------------------------

function runToCompletion(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: process.platform === 'win32',
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...(opts.env || {}) },
      windowsHide: true
    });
    let output = '';
    if (opts.quiet) {
      child.stdout.on('data', (d) => { output += d; });
      child.stderr.on('data', (d) => { output += d; });
    }
    child.on('exit', (code) => resolve({ code: code ?? 1, output }));
    child.on('error', (err) => resolve({ code: 1, output: `${output}${err.message}` }));
  });
}

async function countBooks() {
  try {
    const { MongoClient } = require(path.join(BACKEND, 'node_modules', 'mongodb'));
    const { resolveMongoConfig } = require(path.join(BACKEND, 'db', 'uri.js'));
    const { uri, dbName } = resolveMongoConfig();
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    try {
      await client.connect();
      return await client.db(dbName).collection('books').countDocuments();
    } finally {
      await client.close().catch(() => {});
    }
  } catch {
    return null;
  }
}

async function bootstrapData() {
  const steps = [
    { label: 'indexes', args: ['scripts/indexes.js'] },
    {
      label: 'admin',
      args: [
        'scripts/create_admin.js',
        '--id', process.env.ADMIN_ID || DEV_ENV.ADMIN_ID,
        '--name', process.env.ADMIN_NAME || DEV_ENV.ADMIN_NAME,
        '--email', process.env.ADMIN_EMAIL || DEV_ENV.ADMIN_EMAIL,
        '--password', process.env.ADMIN_PASSWORD || DEV_ENV.ADMIN_PASSWORD
      ]
    },
    { label: 'catalog', args: ['scripts/bootstrap-dev.js'] }
  ];

  for (const step of steps) {
    const { code, output } = await runToCompletion('node', step.args, { cwd: BACKEND, quiet: true });
    if (code !== 0) {
      process.stderr.write(output);
      if (/bad auth|authentication failed|ENOTFOUND|ServerSelection/i.test(output)) {
        process.stderr.write(
          '[seed] MONGO_URI could not be reached. For Atlas: URL-encode the password, and add this '
            + "machine's IP under Network Access. To use a local database instead, set "
            + 'MONGO_URI=mongodb://127.0.0.1:27017/libreport in Backend/.env.\n'
        );
      }
      fail('seed', `${step.label} step failed.`);
    }
    log('seed', `${step.label} ok`);
  }

  // bootstrap-dev.js deliberately exits 0 even when the CSV import fails, so
  // report the real count rather than trusting its exit code.
  const books = await countBooks();
  if (books === null) return;
  if (books === 0) {
    log('seed', 'warning: no books in the catalog — check the import output above');
  } else {
    log('seed', `catalog holds ${books} book${books === 1 ? '' : 's'}`);
  }
}

// --- main -------------------------------------------------------------------

(async () => {
  ensureEnv();
  loadEnv();

  const mongo = await startDatabase();
  await bootstrapData();

  const frontendPort = await pickFrontendPort();
  const children = [];
  let shuttingDown = false;

  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      try { if (!child.killed) child.kill('SIGTERM'); } catch {}
    }
    if (mongo) {
      // doCleanup:false keeps .mongo-data/ so the next run has the same data.
      try { await mongo.stop({ doCleanup: false }); } catch {}
      log('db', 'mongod stopped (data kept)');
    }
    process.exit(code);
  };

  process.on('SIGINT', () => { shutdown(0); });
  process.on('SIGTERM', () => { shutdown(0); });

  const start = (scope, cmd, args, env = {}) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      cwd: ROOT,
      env: { ...process.env, ...env },
      windowsHide: true
    });
    child.on('exit', (code) => {
      if (shuttingDown) return;
      if (typeof code === 'number' && code !== 0) {
        process.stderr.write(`[${scope}] exited with code ${code}; shutting down.\n`);
        shutdown(code);
      }
    });
    children.push(child);
    return child;
  };

  start('backend', 'npm', ['--prefix', 'Backend', 'run', 'dev'], {
    // Without this the backend silently spawns its own in-memory database on a
    // connection hiccup and writes to a different DB than the seed steps touched.
    AUTO_MEMORY_DB: 'false',
    USE_MEMORY_DB: 'false'
  });

  start('frontend', 'npm', ['--prefix', 'Frontend', 'run', 'start'], {
    PORT: String(frontendPort || 3000),
    BROWSER: process.env.BROWSER || 'none'
  });

  const health = await runToCompletion('node', [path.join('scripts', 'wait-for-health.js')], { quiet: true });
  if (health.code !== 0) {
    process.stderr.write(health.output);
    await shutdown(1);
    return;
  }

  const url = `http://localhost:${frontendPort || 3000}`;
  process.stdout.write(
    `\n  Admin portal: ${url}/signin\n`
      + `  ID ${process.env.ADMIN_ID || DEV_ENV.ADMIN_ID}  ·  password ${process.env.ADMIN_PASSWORD || DEV_ENV.ADMIN_PASSWORD}\n`
      + `  Student portal: ${url}/student\n`
      + `  API: http://localhost:${process.env.BACKEND_PORT || 4000}/api/health\n\n`
      + '  Ctrl+C stops all three. Data persists in .mongo-data/.\n\n'
  );
})();
