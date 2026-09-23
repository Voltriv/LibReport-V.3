const path = require('node:path');
const env = require('../utils/dotenv');
env.config({ path: path.join(__dirname, '..', '.env') });
env.config({ path: path.join(__dirname, '..', '..', '.env'), override: false });

function buildMongoUriFromParts() {
  const host = process.env.MONGO_HOST || 'localhost';
  const port = process.env.MONGO_PORT || '';
  const db = process.env.MONGO_DB || process.env.DB_NAME || 'libreport';
  const user = process.env.MONGO_USER;
  const pass = process.env.MONGO_PASS || process.env.MONGO_PASSWORD;
  const authDb = process.env.MONGO_AUTH_DB || process.env.MONGO_AUTHSOURCE || process.env.MONGO_AUTH_SOURCE;
  const tls = String(process.env.MONGO_TLS || '').toLowerCase() === 'true';
  const repl = process.env.MONGO_REPLICA || process.env.MONGO_REPLICA_SET;

  const credentials = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass || '')}@` : '';
  const hostPort = port ? `${host}:${port}` : host;
  const params = new URLSearchParams();
  if (authDb) params.set('authSource', authDb);
  if (tls) params.set('tls', 'true');
  if (repl) params.set('replicaSet', repl);
  const qs = params.toString();
  const suffix = qs ? `?${qs}` : '';
  return `mongodb://${credentials}${hostPort}/${db}${suffix}`;
}

function resolveMongoConfig() {
  // Prefer explicit connection string (works with Compass copy-paste)
  const explicit = (process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  let uri = explicit;
  let dbName = process.env.DB_NAME || 'libreport';

  if (!uri) {
    uri = buildMongoUriFromParts();
  } else {
    try {
      const u = new URL(uri);
      // For SRV URIs without db segment, prefer env DB_NAME
      if (u.pathname && u.pathname !== '/' && u.pathname !== '') {
        const seg = u.pathname.replace(/^\//, '');
        if (seg) dbName = seg;
      }
    } catch {
      // If invalid URL (e.g., mongodb+srv not parsed by WHATWG), leave dbName as env default
    }
  }

  return { uri, dbName };
}

module.exports = { resolveMongoConfig };

