'use strict';

// Every value this process reads out of the environment, resolved once.
//
// Requiring this module has no side effects beyond reading process.env, so it is
// safe from anywhere -- but it must be required AFTER utils/dotenv has loaded the
// .env files, which server.js does at the top of its own imports.
//
// Deliberately no validation and no process.exit here: a module that kills the
// process cannot be tested, and deciding whether a missing JWT_SECRET is fatal
// belongs to the entry point, not to the thing that reads it (finding C2).

const path = require('node:path');

const { resolveMongoConfig } = require('./db/uri');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const { uri: MONGO_URI_INIT, dbName: DB_NAME } = resolveMongoConfig();
const JWT_SECRET = process.env.JWT_SECRET;
const NO_DB = String(process.env.NO_DB || process.env.BACKEND_NO_DB || '').toLowerCase() === 'true';
const USE_MEMORY_DB = String(process.env.USE_MEMORY_DB || process.env.BACKEND_INMEMORY_DB || '').toLowerCase() === 'true';
const defaultAutoMemory = process.env.NODE_ENV === 'production' ? 'false' : 'true';
const AUTO_MEMORY_FALLBACK =
  USE_MEMORY_DB ||
  String(
    process.env.AUTO_MEMORY_DB ||
      process.env.BACKEND_AUTO_MEMORY_DB ||
      process.env.BACKEND_AUTO_MEMORY ||
      defaultAutoMemory
  )
    .toLowerCase()
    .trim() !== 'false';

const CORS_ORIGINS = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const PORT = process.env.BACKEND_PORT || 4000;

// Legacy only: uploaded binaries live in the GridFS `uploads` bucket and are
// served by GET /api/files/:id. This path is kept so pre-GridFS files still
// resolve and can still be unlinked.
const UPLOAD_DIR = path.join(__dirname, 'uploads');

const MIME_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

const FINE_RATE_PER_DAY = (() => {
  const raw = Number.parseFloat(process.env.FINE_RATE_PER_DAY ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
})();

// Default borrowing period in days. Can be overridden via environment.
// Clamp to a safe range so misconfigured env vars don't break borrowing logic.
const LOAN_DAYS_FALLBACK = 28;
const DEFAULT_LOAN_DAYS = (() => {
  const raw = process.env.LOAN_DAYS_DEFAULT;
  if (raw === undefined || raw === null || raw === '') {
    return LOAN_DAYS_FALLBACK;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    return LOAN_DAYS_FALLBACK;
  }
  let days = Math.trunc(num);
  if (days < 1) days = 1;
  if (days > 180) days = 180;
  return days;
})();

const VALID_LIBRARY_DAYS = [1, 2, 3, 4, 5, 6];
const DEFAULT_LIBRARY_HOURS = VALID_LIBRARY_DAYS.map((dayOfWeek) => ({
  dayOfWeek,
  open: '08:00',
  close: '17:00'
}));

module.exports = {
  IS_PRODUCTION,
  MONGO_URI_INIT,
  DB_NAME,
  JWT_SECRET,
  NO_DB,
  USE_MEMORY_DB,
  AUTO_MEMORY_FALLBACK,
  CORS_ORIGINS,
  PORT,
  UPLOAD_DIR,
  MIME_EXTENSIONS,
  MILLIS_PER_DAY,
  FINE_RATE_PER_DAY,
  LOAN_DAYS_FALLBACK,
  DEFAULT_LOAN_DAYS,
  VALID_LIBRARY_DAYS,
  DEFAULT_LIBRARY_HOURS
};
