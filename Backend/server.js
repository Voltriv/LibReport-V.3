const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const env = require('./utils/dotenv');
env.config({ path: path.join(__dirname, '.env') });
env.config({ path: path.join(__dirname, '..', '.env'), override: false });
const express = require('express');
const compression = require('compression');
const mongoose = require('mongoose');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const {
  isConfigured: isPushConfigured,
  getPublicKey: getPushPublicKey,
  upsertSubscription,
  removeSubscription,
  sendNotificationToUser
} = require('./utils/pushNotifications');

// Student/Admin ID format shared with models
const {
  STUDENT_ID_REGEX,
  USER_ROLE_VALUES,
  normalizeUserRole: normalizeRoleValue
} = require('./models/validators');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const app = express();
app.set('etag', 'strong');
// We sit behind a single reverse proxy (Nginx) in production, so trust the
// first hop for correct req.ip (needed for per-IP rate limiting below).
app.set('trust proxy', 1);
app.use(compression());
app.use(
  helmet({
    // This process only serves JSON/files, not HTML pages, so a CSP tuned
    // for documents would just add noise without protecting anything here.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

const CORS_ORIGINS = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (IS_PRODUCTION && !CORS_ORIGINS.length) {
  console.warn(
    'CORS_ORIGIN is not set in production; the API will accept requests from any origin. '
      + 'Set CORS_ORIGIN to your frontend URL(s) (comma-separated) to restrict this.'
  );
}
app.use(cors(CORS_ORIGINS.length ? { origin: CORS_ORIGINS, credentials: true } : {}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('tiny'));

// Brute-force protection for auth endpoints. Keyed by IP; trust proxy above
// ensures req.ip reflects the real client, not the Nginx hop.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' }
});

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOAD_DIR));

const MIME_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const STAFFING_LOOKBACK_DAYS = 7;
const DEFAULT_VISITS_PER_STAFF = 20;
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const FINE_RATE_PER_DAY = (() => {
  const raw = Number.parseFloat(process.env.FINE_RATE_PER_DAY ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
})();

let uploadBucket = null;
const uploadBucketEvents = new EventEmitter();
uploadBucketEvents.setMaxListeners(0);

function setUploadBucket(bucket) {
  if (bucket) {
    uploadBucket = bucket;
    uploadBucketEvents.emit('ready', bucket);
  } else {
    uploadBucket = null;
  }
}

function waitForUploadBucket(timeoutMs = 5000) {
  if (NO_DB) {
    return Promise.reject(new Error('Database disabled (NO_DB=true)'));
  }
  if (uploadBucket) {
    return Promise.resolve(uploadBucket);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('File storage is not ready yet'));
    }, timeoutMs);

    const onReady = (bucket) => {
      cleanup();
      resolve(bucket);
    };

    function cleanup() {
      clearTimeout(timer);
      uploadBucketEvents.removeListener('ready', onReady);
    }

    uploadBucketEvents.once('ready', onReady);
  });
}

function parseBase64Payload(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:')) {
    const comma = trimmed.indexOf(',');
    if (comma === -1) return null;
    const meta = trimmed.slice(5, comma); // skip "data:"
    const [mimePart, encoding] = meta.split(';');
    if (!encoding || encoding.toLowerCase() !== 'base64') return null;
    const data = trimmed.slice(comma + 1);
    if (!data) return null;
    try {
      const buffer = Buffer.from(data, 'base64');
      return { buffer, mime: (mimePart || '').toLowerCase() };
    } catch {
      return null;
    }
  }
  try {
    const buffer = Buffer.from(trimmed, 'base64');
    return { buffer, mime: '' };
  } catch {
    return null;
  }
}

function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'file';
  return name.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function extractFileIdFromPath(path) {
  if (!path || typeof path !== 'string') return null;
  const match = path.match(/\/api\/files\/([a-f0-9]{24})/i);
  return match ? match[1] : null;
}

async function freeSpaceForUploads() {
  try {
    const bucket =
      uploadBucket ||
      (await waitForUploadBucket(5000).catch(() => null));
    if (!bucket || !mongoose.connection?.db) return false;

    const filesCollection = mongoose.connection.db.collection('uploads.files');
    const oldest = await filesCollection.find({}).sort({ uploadDate: 1 }).limit(1).toArray();
    if (!oldest.length) return false;

    const file = oldest[0];
    await bucket.delete(file._id);

    const fileIdString = file._id.toString();
    await Book.updateMany(
      {
        $or: [
          { pdfFileId: file._id },
          { pdfPath: { $regex: fileIdString, $options: 'i' } }
        ]
      },
      {
        $unset: {
          pdfFileId: '',
          pdfPath: '',
          pdfMime: '',
          pdfOriginalName: ''
        }
      }
    );

    return true;
  } catch (err) {
    console.error('Failed to free upload space', err);
    return false;
  }
}

function coerceDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    const time = raw.getTime();
    return Number.isNaN(time) ? null : new Date(time);
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) return null;
    const date = new Date(parsed);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (raw && typeof raw === 'object') {
    if ('$date' in raw) {
      return coerceDate(raw.$date);
    }
    if (typeof raw.toDate === 'function') {
      try {
        return coerceDate(raw.toDate());
      } catch {
        return null;
      }
    }
    if (typeof raw.valueOf === 'function') {
      const value = raw.valueOf();
      if (value !== raw) {
        return coerceDate(value);
      }
    }
  }
  return null;
}

function resolveLoanStatusMeta(loan, options = {}) {
  const { now = new Date(), activeLabel = 'active' } = options;
  const resolvedNow = coerceDate(now) || new Date();
  const returnedAt = coerceDate(loan && loan.returnedAt);
  if (returnedAt) {
    return { key: 'returned', label: 'returned' };
  }
  const dueAt = coerceDate(loan && loan.dueAt);
  if (dueAt && dueAt.getTime() < resolvedNow.getTime()) {
    return { key: 'overdue', label: 'overdue' };
  }
  const label = typeof activeLabel === 'string' && activeLabel.trim() ? activeLabel : 'active';
  return { key: 'active', label };
}

function normalizeUserStatus(rawStatus) {
  const value = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : '';
  if (value === 'disabled' || value === 'inactive') return 'disabled';
  if (value === 'pending') return 'pending';
  return 'active';
}

const USER_ROLE_DEFAULT = USER_ROLE_VALUES[0];

function parseUserRole(rawRole) {
  const normalized = normalizeRoleValue(rawRole);
  if (normalized && USER_ROLE_VALUES.includes(normalized)) {
    return normalized;
  }
  return null;
}

function resolveUserRole(rawRole, fallback = USER_ROLE_DEFAULT) {
  const normalized = parseUserRole(rawRole);
  if (normalized) return normalized;
  if (typeof fallback !== 'undefined') {
    const fallbackNormalized = parseUserRole(fallback);
    if (fallbackNormalized) return fallbackNormalized;
  }
  return USER_ROLE_DEFAULT;
}

function buildRoleFilter(...roles) {
  const values = new Set();
  for (const role of roles) {
    if (role === undefined || role === null) continue;
    const normalized = parseUserRole(role);
    if (normalized) values.add(normalized);
    const raw = String(role).trim();
    if (raw) {
      values.add(raw);
      const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1);
      values.add(capitalized);
    }
  }
  if (!values.size) {
    return { role: { $exists: true } };
  }
  return { role: { $in: Array.from(values) } };
}

async function removeStoredFile(stored) {
  if (!stored) return;
  const entry =
    typeof stored === 'string'
      ? { storedPath: stored }
      : stored && typeof stored === 'object'
      ? stored
      : null;
  if (!entry) return;

  const fileId = entry.fileId || entry.gridFsId || entry.id;
  const bucket =
    uploadBucket ||
    (await waitForUploadBucket(5000).catch(() => null));
  if (fileId && bucket) {
    try {
      const objectId =
        typeof fileId === 'string' ? new mongoose.Types.ObjectId(fileId) : fileId;
      await bucket.delete(objectId);
      return;
    } catch (err) {
      if (!err || err.code !== 'FileNotFound') {
        console.warn('Failed to delete GridFS file:', err?.message || err);
      }
    }
  }

  const storedPath = entry.storedPath;
  if (!storedPath) return;
  const prefix = '/uploads/';
  let relative = storedPath;
  if (storedPath.startsWith(prefix)) {
    relative = storedPath.slice(prefix.length);
  }
  relative = relative.replace(/^\/+/, '');
  if (!relative || relative.includes('..')) return;
  const target = path.join(UPLOAD_DIR, relative);
  try {
    await fsp.unlink(target);
  } catch {}
}

async function storeBase64File({
  base64,
  originalName,
  allowedMime = [],
  maxBytes = 5 * 1024 * 1024,
  subDir = ''
}) {
  const parsed = parseBase64Payload(base64);
  if (!parsed) throw new Error('Invalid file data provided');
  const { buffer } = parsed;
  const bucket =
    uploadBucket ||
    (await waitForUploadBucket(5000).catch(() => null));
  if (!bucket) {
    throw new Error('File storage is not ready. Please try again shortly.');
  }
  const mime = (parsed.mime || '').toLowerCase();
  const normalizedAllowed = allowedMime.map((m) => m.toLowerCase());
  if (maxBytes && buffer.length > maxBytes) {
    throw new Error(`File is too large. Max size is ${Math.round(maxBytes / (1024 * 1024))}MB`);
  }
  if (normalizedAllowed.length) {
    if (mime) {
      if (!normalizedAllowed.includes(mime)) {
        throw new Error('Unsupported file type');
      }
    } else {
      const fromName = originalName ? path.extname(originalName).toLowerCase() : '';
      const fallbackMime = fromName === '.pdf' ? 'application/pdf' : '';
      if (fallbackMime && !normalizedAllowed.includes(fallbackMime)) {
        throw new Error('Unsupported file type');
      }
    }
  }

  let ext = '';
  if (originalName) {
    ext = path.extname(originalName).toLowerCase();
  }
  if (!ext && mime && MIME_EXTENSIONS[mime]) {
    ext = MIME_EXTENSIONS[mime];
  }
  if (!ext && normalizedAllowed.includes('application/pdf')) {
    ext = '.pdf';
  }
  if (!ext && mime.startsWith('image/')) {
    ext = '.png';
  }

  const safeName = sanitizeFilename(originalName || 'file');
  const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext || ''}`;

  const contentType =
    mime ||
    (ext === '.pdf'
      ? 'application/pdf'
      : ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : '');

  const fileId = new mongoose.Types.ObjectId();
  await new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStreamWithId(fileId, fileName, {
      contentType: contentType || undefined,
      metadata: {
        originalName: safeName || fileName,
        category: subDir ? sanitizeFilename(subDir) : undefined,
        mime: contentType || mime || 'application/octet-stream',
        uploadedAt: new Date()
      }
    });
    uploadStream.on('error', reject);
    uploadStream.on('finish', resolve);
    uploadStream.end(buffer);
  });

  return {
    storedPath: `/api/files/${fileId.toString()}`,
    originalName: safeName || fileName,
    fileId,
    mime: contentType || mime || 'application/octet-stream'
  };
}

function parseIntField(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${fieldName} must be a number`);
  }
  return Math.max(0, Math.trunc(num));
}

function parseTagsInput(raw, fallback) {
  const list = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item !== undefined && item !== null) list.push(String(item));
    }
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed) {
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item !== undefined && item !== null) list.push(String(item));
            }
          }
        } catch {
          list.push(trimmed);
        }
      } else {
        for (const piece of trimmed.split(',')) {
          if (piece.trim()) list.push(piece.trim());
        }
      }
    }
  }
  if (fallback) list.push(String(fallback));
  const unique = new Set();
  const out = [];
  for (const item of list) {
    const val = item.trim();
    if (val && !unique.has(val.toLowerCase())) {
      unique.add(val.toLowerCase());
      out.push(val);
    }
  }
  return out;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const VALID_LIBRARY_DAYS = [1, 2, 3, 4, 5, 6];
const DEFAULT_LIBRARY_HOURS = VALID_LIBRARY_DAYS.map((dayOfWeek) => ({
  dayOfWeek,
  open: '08:00',
  close: '17:00'
}));

function readNumericQueryParam(value, options = {}) {
  const { defaultValue, min, max, integer = false, name = 'value' } = options;
  const hasValue = !(value === undefined || value === null || value === '');
  let candidate;
  if (hasValue) {
    candidate = Number(value);
  } else if (defaultValue !== undefined) {
    candidate = Number(defaultValue);
  } else {
    throw new Error(`${name} is required`);
  }

  if (!Number.isFinite(candidate)) {
    throw new Error(`${name} must be a number`);
  }

  let result = integer ? Math.trunc(candidate) : candidate;

  if (min !== undefined && result < min) {
    result = min;
  }
  if (max !== undefined && result > max) {
    result = max;
  }

  return result;
}

function buildStaffingRecommendations(hourlyBuckets = [], dayBuckets = [], options = {}) {
  const lookbackDays = Math.max(1, options.lookbackDays ?? STAFFING_LOOKBACK_DAYS);
  const visitsPerStaff = Math.max(1, options.visitsPerStaff ?? DEFAULT_VISITS_PER_STAFF);

  const totalVisits = hourlyBuckets.reduce((acc, item) => acc + Number(item?.count || 0), 0);
  const avgDailyVisits = totalVisits / lookbackDays;

  const peakHours = hourlyBuckets
    .filter((item) => Number.isFinite(item?.hour) && item.count > 0)
    .map((item) => {
      const hour = Number(item.hour);
      const avg = Number(item.count || 0) / lookbackDays;
      const padded = String(hour).padStart(2, '0');
      const endHour = (hour + 1) % 24;
      return {
        hour,
        label: `${padded}:00 - ${String(endHour).padStart(2, '0')}:00`,
        avgVisits: Number(avg.toFixed(1)),
        recommendedStaff: Math.max(1, Math.ceil(avg / visitsPerStaff))
      };
    })
    .sort((a, b) => b.avgVisits - a.avgVisits)
    .slice(0, 3);

  const approxWeeks = Math.max(1, Math.round(lookbackDays / 7) || 1);
  const busyDays = dayBuckets
    .filter((item) => Number.isFinite(item?.dow))
    .map((item) => {
      const dow = Number(item.dow);
      const idx = ((dow || 1) - 1 + 7) % 7;
      const avg = Number(item.count || 0) / approxWeeks;
      return {
        dow: idx,
        label: DAY_LABELS[idx],
        avgVisits: Number(avg.toFixed(1))
      };
    })
    .sort((a, b) => b.avgVisits - a.avgVisits)
    .slice(0, 3);

  const recommendations = [];
  if (peakHours.length > 0) {
    const top = peakHours[0];
    recommendations.push(
      `Plan for at least ${top.recommendedStaff} staff between ${top.label} to handle roughly ${top.avgVisits} visits.`
    );
  }
  if (busyDays.length > 0) {
    const labels = busyDays.map((item) => item.label);
    const formatted =
      labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels.slice(-1)}`;
    recommendations.push(`Expect higher footfall on ${formatted}. Consider staggered breaks those days.`);
  }
  if (avgDailyVisits > visitsPerStaff * 3) {
    recommendations.push(
      `Average daily visits (~${Number(avgDailyVisits.toFixed(1))}) exceed the safe capacity of a ${visitsPerStaff}-visit staffing band. Evaluate adding coverage during peaks.`
    );
  }

  return {
    lookbackDays,
    visitsPerStaff,
    averageDailyVisits: Number(avgDailyVisits.toFixed(1)),
    totalVisits,
    peakHours,
    busyDays,
    recommendations
  };
}

// --- DB connect
const { resolveMongoConfig } = require('./db/uri');
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
const MEMORY_SERVER_VERSION =
  process.env.MONGO_MEMORY_SERVER_VERSION ||
  process.env.MONGO_MEMORY_VERSION ||
  '7.0.14';
const MEMORY_SERVER_DOWNLOAD_DIR = process.env.MONGO_MEMORY_DOWNLOAD_DIR || process.env.MONGOMS_DOWNLOAD_DIR;
const MEMORY_SERVER_SYSTEM_BINARY =
  process.env.MONGO_MEMORY_SYSTEM_BINARY ||
  process.env.MONGOMS_SYSTEM_BINARY;
const MEMORY_SERVER_OS = (() => {
  const dist =
    process.env.MONGO_MEMORY_OS_DIST ||
    process.env.MONGO_MEMORY_OS ||
    process.env.MONGOMS_OS_DIST ||
    process.env.MONGOMS_OS ||
    '';
  const release =
    process.env.MONGO_MEMORY_OS_RELEASE ||
    process.env.MONGO_MEMORY_OS_VERSION ||
    process.env.MONGOMS_OS_RELEASE ||
    process.env.MONGOMS_OS_VERSION ||
    process.env.MONGO_MEMORY_OS_FALLBACK_RELEASE ||
    '';
  if (dist || release) {
    return {
      dist: (dist || 'ubuntu').toLowerCase(),
      release: release || '20.04'
    };
  }
  return undefined;
})();
const MEMORY_SERVER_SKIP_MD5 = String(
  process.env.MONGO_MEMORY_SKIP_MD5 ||
    process.env.MONGOMS_SKIP_MD5 ||
    process.env.MONGO_MEMORY_DISABLE_MD5 ||
    ''
)
  .toLowerCase()
  .trim() === 'true';

function buildMemoryServerOptions() {
  const binary = { version: MEMORY_SERVER_VERSION };
  if (MEMORY_SERVER_DOWNLOAD_DIR) {
    binary.downloadDir = MEMORY_SERVER_DOWNLOAD_DIR;
  }
  if (MEMORY_SERVER_SYSTEM_BINARY) {
    binary.systemBinary = MEMORY_SERVER_SYSTEM_BINARY;
  }
  if (MEMORY_SERVER_OS) {
    binary.os = MEMORY_SERVER_OS;
  }
  if (MEMORY_SERVER_SKIP_MD5) {
    binary.skipMD5 = true;
    binary.checkMD5 = false;
  }
  return { binary };
}

if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET environment variable. Set Backend/.env JWT_SECRET before starting the backend.');
  process.exit(1);
}

let MONGO_URI = MONGO_URI_INIT;
if (!MONGO_URI && !NO_DB && !USE_MEMORY_DB) {
  console.error('Missing MONGO_URI (or MONGODB_URI) in environment');
  process.exit(1);
}

let DB_READY = false;

function initUploadBucket() {
  if (NO_DB) return;
  const db = mongoose.connection && mongoose.connection.db;
  if (!db) return;
  try {
    const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
    setUploadBucket(bucket);
  } catch (err) {
    console.error('Failed to initialize GridFS bucket:', err?.message || err);
  }
}

mongoose.connection.on('connected', initUploadBucket);
mongoose.connection.on('disconnected', () => {
  setUploadBucket(null);
});

async function startMemoryDatabase(reason) {
  try {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const mem = await MongoMemoryServer.create(buildMemoryServerOptions());
    MONGO_URI = mem.getUri();
    await mongoose.connect(MONGO_URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 10000, family: 4 });
    initUploadBucket();
    DB_READY = true;
    if (reason) {
      console.warn(`MongoDB connection failed (${reason}). Started in-memory database "${DB_NAME}" for development.`);
    } else {
      console.log(`MongoMemoryServer started. Using in-memory DB "${DB_NAME}"`);
    }
    await ensureDefaultAdmin();
  } catch (err) {
    const details = err?.stack || err?.message || String(err);
    console.error('Failed to start in-memory MongoDB:', details);
    console.error(
      'Tips: specify MONGO_MEMORY_VERSION, MONGO_MEMORY_OS_RELEASE (e.g. 20.04), or MONGO_MEMORY_SYSTEM_BINARY to use an existing mongod binary. '
        + 'Set USE_MEMORY_DB=false to skip the in-memory fallback.'
    );
    process.exit(1);
  }
}

async function connectMongo() {
  if (NO_DB) {
    console.warn('NO_DB=true; skipping MongoDB connection. All DB-backed routes will return 503.');
    return;
  }

  if (USE_MEMORY_DB) {
    await startMemoryDatabase();
    return;
  }

  if (!MONGO_URI) {
    console.error('Missing MONGO_URI (or MONGODB_URI) in environment');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI, {
      dbName: DB_NAME,
      serverSelectionTimeoutMS: 10000,
      family: 4
    });
    initUploadBucket();
    DB_READY = true;
    console.log(`MongoDB connected to database "${DB_NAME}"`);
    await ensureDefaultAdmin();
  } catch (err) {
    const code = err && (err.code || err.codeName || err.name);
    console.error('Failed to connect to MongoDB:', code ? `${code}: ${err.message}` : err.message);
    console.error('Tip: If using Atlas/Compass, ensure your password is URL-encoded and add authSource=admin if needed.');
    if (AUTO_MEMORY_FALLBACK) {
      const label = code || err?.message || 'unknown error';
      await startMemoryDatabase(label);
    } else {
      process.exit(1);
    }
  }
}

connectMongo().catch((err) => {
  console.error('Fatal MongoDB initialization error:', err?.message || err);
  process.exit(1);
});

// --- User model
const {
  User,
  Admin,
  Faculty,
  Book,
  Loan,
  Visit,
  Hours,
  PasswordReset,
  BorrowRequest
} = require('./models');
// Models loaded from ./models (legacy inline schema removed)

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function resolveLoanDuration(daysRaw) {
  try {
    return readNumericQueryParam(daysRaw, {
      name: 'days',
      defaultValue: DEFAULT_LOAN_DAYS,
      min: 1,
      max: 180,
      integer: true
    });
  } catch (err) {
    throw new HttpError(400, err.message);
  }
}

async function borrowBookCore({ borrowerId, bookId, daysRaw, enforceUniqueLoan }) {
  if (!mongoose.Types.ObjectId.isValid(String(borrowerId))) {
    throw new HttpError(400, 'userId must be a valid identifier');
  }
  if (!mongoose.Types.ObjectId.isValid(String(bookId))) {
    throw new HttpError(400, 'bookId must be a valid identifier');
  }

  const userObjectId = new mongoose.Types.ObjectId(String(borrowerId));
  const bookObjectId = new mongoose.Types.ObjectId(String(bookId));

  const user = await User.findById(userObjectId).lean();
  if (!user) {
    throw new HttpError(404, 'User or Book not found');
  }

  if (enforceUniqueLoan) {
    const existingLoan = await Loan.findOne({
      userId: user._id,
      bookId: bookObjectId,
      returnedAt: null
    }).lean();
    if (existingLoan) {
      throw new HttpError(400, 'You already have this book borrowed');
    }
  }

  const chosenDays = resolveLoanDuration(daysRaw);
  const dueAt = new Date(Date.now() + chosenDays * 24 * 60 * 60 * 1000);

  const book = await Book.findOneAndUpdate(
    { _id: bookObjectId, availableCopies: { $gt: 0 } },
    { $inc: { availableCopies: -1 } },
    { new: true }
  );
  if (!book) {
    const exists = await Book.exists({ _id: bookObjectId });
    if (!exists) {
      throw new HttpError(404, 'User or Book not found');
    }
    throw new HttpError(400, 'No available copies');
  }

  let loanDoc;
  try {
    loanDoc = await Loan.create({ userId: user._id, bookId: book._id, dueAt });
  } catch (err) {
    await Book.updateOne({ _id: book._id }, { $inc: { availableCopies: 1 } });
    throw new HttpError(500, err?.message || 'Failed to create loan');
  }

  return { user, book, loan: loanDoc };
}

function sendError(res, err, fallbackMessage) {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  res.status(status).json({ error: err?.message || fallbackMessage });
}

function normalizeBorrowRequestAggregate(doc) {
  if (!doc) return null;
  const user = doc.user || {};
  const book = doc.book || {};
  const processedBy = doc.processedByUser || {};
  return {
    id: String(doc._id),
    status: doc.status,
    requestType: doc.requestType || 'borrow',
    requestedAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    processedAt: doc.processedAt ? doc.processedAt.toISOString() : null,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
    dueAt: doc.dueAt ? doc.dueAt.toISOString() : null,
    daysRequested: typeof doc.daysRequested === 'number' ? doc.daysRequested : null,
    message: doc.message || '',
    adminNote: doc.adminNote || '',
    loanId: doc.loanId ? String(doc.loanId) : null,
    user:
      user && user._id
        ? {
            id: String(user._id),
            name: user.fullName || user.name || user.email || '',
            email: user.email || '',
            studentId: user.studentId || ''
          }
        : null,
    book:
      book && book._id
        ? {
            id: String(book._id),
            title: book.title || '',
            author: book.author || '',
            code: book.bookCode || ''
          }
        : null,
    processedBy:
      processedBy && processedBy._id
        ? {
            id: String(processedBy._id),
            name: processedBy.fullName || processedBy.name || processedBy.email || '',
            email: processedBy.email || ''
          }
        : null
  };
}

async function aggregateBorrowRequests(match = {}, options = {}) {
  const pipeline = [{ $match: match }];
  if (options.sort) {
    pipeline.push({ $sort: options.sort });
  } else {
    pipeline.push({ $sort: { createdAt: -1 } });
  }
  pipeline.push(
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'books', localField: 'bookId', foreignField: '_id', as: 'book' } },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'admins', localField: 'processedBy', foreignField: '_id', as: 'processedByUser' } },
    { $unwind: { path: '$processedByUser', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        status: 1,
        createdAt: 1,
        updatedAt: 1,
        processedAt: 1,
        dueAt: 1,
        daysRequested: 1,
        message: 1,
        adminNote: 1,
        requestType: 1,
        loanId: 1,
        user: '$user',
        book: '$book',
        processedByUser: '$processedByUser'
      }
    }
  );
  if (typeof options.limit === 'number') {
    pipeline.push({ $limit: options.limit });
  }
  const docs = await BorrowRequest.aggregate(pipeline).exec();
  return docs.map((doc) => normalizeBorrowRequestAggregate(doc));
}

// Separate Admin collection (loaded from ./models)

async function ensureDefaultAdmin() {
  if (IS_PRODUCTION && !process.env.ADMIN_PASSWORD) {
    console.error(
      'Refusing to bootstrap a default admin in production without ADMIN_PASSWORD set. '
        + 'Set ADMIN_EMAIL, ADMIN_ID and a strong ADMIN_PASSWORD in Backend/.env, or create the first '
        + 'admin via POST /api/auth/admin-signup with ALLOW_ADMIN_SIGNUP=true (temporarily).'
    );
    process.exit(1);
  }

  const rawEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const email = rawEmail ? String(rawEmail).trim().toLowerCase() : '';
  const adminId = String(process.env.ADMIN_ID || process.env.ADMIN_STUDENT_ID || '03-2324-032224').trim();
  const fullName = String(process.env.ADMIN_NAME || 'Librarian').trim() || 'Librarian';
  const password = process.env.ADMIN_PASSWORD || 'Password123';

  const lookups = [];
  if (adminId) lookups.push({ adminId });
  if (email) lookups.push({ email });

  const existing = lookups.length ? await Admin.findOne({ $or: lookups }).lean() : null;
  if (existing) {
    const updates = {};
    if (email && !existing.email) updates.email = email;
    if (existing.role !== 'librarian') updates.role = 'librarian';
    if (adminId && existing.adminId !== adminId && STUDENT_ID_REGEX.test(adminId)) {
      updates.adminId = adminId;
    }
    if (Object.keys(updates).length) {
      await Admin.updateOne({ _id: existing._id }, { $set: updates });
    }
    return;
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const toCreate = {
    adminId,
    fullName,
    role: 'librarian',
    passwordHash
  };
  if (email) toCreate.email = email;

  try {
    await Admin.create(toCreate);
    console.log(`Created default admin (librarian) with Admin ID ${adminId}`);
  } catch (err) {
    if (err && (err.code === 11000 || err.code === 11001)) {
      console.warn('Default admin already exists, skipping bootstrap account creation.');
    } else {
      throw err;
    }
  }
}

// Additional models loaded from ./models

//

//

//

// Password reset tokens model loaded from ./models

// --- Health
app.get('/api/health', async (_req, res) => {
  const dbReady = NO_DB ? false : (mongoose.connection.readyState === 1 || DB_READY);
  return res.status(200).json({ ok: true, db: dbReady, noDbMode: NO_DB, time: new Date().toISOString() });
});

// API root index for human checks
app.get(['/api', '/api/'], (_req, res) => {
  res.json({
    ok: true,
    name: 'LibReport API',
    health: '/api/health',
    auth: {
      signup: { method: 'POST', path: '/api/auth/signup' },
      login: { method: 'POST', path: '/api/auth/login' },
      adminSignup: { method: 'POST', path: '/api/auth/admin-signup' }
    },
    time: new Date().toISOString()
  });
});

// Friendly hints for common mistaken GET requests to POST-only endpoints
app.get('/api/auth/signup', (_req, res) => {
  res.status(405).json({ error: 'Method Not Allowed. Use POST /api/auth/signup' });
});
app.get('/api/auth/login', (_req, res) => {
  res.status(405).json({ error: 'Method Not Allowed. Use POST /api/auth/login' });
});

// In NO_DB mode, short-circuit all DB-backed routes with 503 Service Unavailable
if (NO_DB) {
  app.use((req, res, next) => {
    const allow = req.path === '/api' || req.path === '/api/' || req.path === '/api/health';
    if (allow) return next();
    return res.status(503).json({ error: 'Database disabled (NO_DB=true)' });
  });
}

// --- Micro-cache for read-heavy GET endpoints (15s TTL)
const microCache = new Map();
const TTL_MS = 15_000;
function cacheKey(req) { return `${req.method}:${req.originalUrl}`; }
function cacheable(path) {
  return (
    path.startsWith('/api/books/library') ||
    path.startsWith('/api/reports/') ||
    path === '/api/health' ||
    path.startsWith('/api/books/lookup') ||
    path.startsWith('/api/hours') ||
    path.startsWith('/api/dashboard') ||
    path.startsWith('/api/heatmap/visits')
  );
}
app.use((req, res, next) => {
  if (req.method !== 'GET' || !cacheable(req.path)) return next();
  const key = cacheKey(req);
  const hit = microCache.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) {
    res.set('X-Micro-Cache', 'HIT');
    return res.status(hit.status).json(hit.body);
  }
  const json = res.json.bind(res);
  res.json = (body) => {
    try {
      microCache.set(key, { body, status: res.statusCode || 200, expires: now + TTL_MS });
      res.set('X-Micro-Cache', 'MISS');
    } catch {}
    return json(body);
  };
  next();
});

// --- Admin-only global guard for API (except health and auth)
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  const open =
    req.path === '/api' ||
    req.path === '/api/' ||
    req.path === '/api/health' ||
    req.path.startsWith('/api/auth/') ||
    req.path === '/api/files' ||
    req.path.startsWith('/api/files/');
  if (open) return next();

  // Routes that any authenticated user (students or librarians) can access
  const sharedAuthPaths = [
    '/api/books/library',
    '/api/books/lookup',
    '/api/hours'
  ];
  if (sharedAuthPaths.some((p) => req.path.startsWith(p)) || (req.path.startsWith('/api/books/') && req.path.endsWith('/pdf'))) {
    return authRequired(req, res, next);
  }

  // Student specific APIs
  if (req.path.startsWith('/api/student/')) {
    return studentRequired(req, res, next);
  }

  if (!NO_DB && !(mongoose.connection.readyState === 1 || DB_READY)) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  return adminRequired(req, res, next);
});
// --- Auth helpers ---
function signToken(user) {
  const safeRole = resolveUserRole(user?.role);
  return jwt.sign({ sub: String(user._id), email: user.email, role: safeRole }, JWT_SECRET, { expiresIn: '7d' });
}

// Tokens live for 7 days, so signature alone is not enough: an account
// disabled after its token was issued must lose access immediately.
async function accountIsDisabled(sub) {
  if (NO_DB || !sub || !mongoose.isValidObjectId(sub)) return false;
  if (!(mongoose.connection.readyState === 1 || DB_READY)) return false;
  const projection = { status: 1 };
  const found =
    (await Admin.findById(sub, projection).lean())
    || (await User.findById(sub, projection).lean())
    || (await Faculty.findById(sub, projection).lean());
  if (!found) return false;
  return normalizeUserStatus(found.status) === 'disabled';
}

function authRequired(req, res, next) {
  let claims;
  try {
    const header = req.headers.authorization || '';
    const [, token] = header.split(' ');
    if (!token) return res.status(401).json({ error: 'missing token' });
    claims = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }

  req.user = claims;
  accountIsDisabled(claims.sub)
    .then((disabled) => {
      if (disabled) return res.status(401).json({ error: 'Account is disabled' });
      return next();
    })
    .catch(next);
}

function adminRequired(req, res, next) {
  return authRequired(req, res, () => {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'librarian' && role !== 'librarian_staff') {
      return res.status(403).json({ error: 'admin role required' });
    }
    return next();
  });
}

// Stricter admin middleware: only full admins and librarians
// Used for managing admin accounts so librarian_staff cannot access
function elevatedAdminRequired(req, res, next) {
  return authRequired(req, res, () => {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'librarian') {
      return res.status(403).json({ error: 'librarian or admin role required' });
    }
    return next();
  });
}

function studentRequired(req, res, next) {
  return authRequired(req, res, () => {
    const role = req.user?.role;

    if (role !== 'student' && role !== 'librarian' && role !== 'admin' && role !== 'librarian_staff') {

      return res.status(403).json({ error: 'student role required' });
    }
    return next();
  });
}

// --- Auth: Student Signup
app.post('/api/auth/signup', authRateLimiter, async (req, res) => {
  try {
    if (!NO_DB && !(mongoose.connection.readyState === 1 || DB_READY)) {
      return res.status(503).json({ error: 'Database not ready' });
    }
    const { studentId, email, fullName, department, password, confirmPassword } = req.body || {};
    if (!studentId || !email || !fullName || !department || !password || !confirmPassword) {
      return res.status(400).json({ error: 'studentId, email, fullName, department, password, confirmPassword required' });
    }
    if (String(password) !== String(confirmPassword)) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (String(password).length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 chars and contain letters and numbers' });
    }

    const studentIdNorm = String(studentId).trim();
    const emailNorm = String(email).trim().toLowerCase();
    const fullNameNorm = String(fullName).trim();
    const departmentNorm = typeof department === 'string' ? department.trim() : '';

    if (!STUDENT_ID_REGEX.test(studentIdNorm)) {
      return res.status(400).json({ error: 'Student ID must match 00-0000-000000 pattern' });

    }
    if (!validator.isEmail(emailNorm)) {
      return res.status(400).json({ error: 'Email must be valid' });
    }
    if (!/^[A-Za-z .'-]+$/.test(fullNameNorm)) {
      return res.status(400).json({ error: 'Full name may contain letters, spaces, apostrophes, hyphens, and periods only' });
    }
    if (!departmentNorm) {
      return res.status(400).json({ error: 'Department is required' });
    }

    const existing = await User.findOne({
      $or: [
        { studentId: studentIdNorm },
        { email: emailNorm }
      ]
    }).lean();
    if (existing) {
      return res.status(409).json({ error: 'studentId or email already exists' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const doc = await User.create({
      studentId: studentIdNorm,
      email: emailNorm,
      fullName: fullNameNorm,
      name: fullNameNorm,
      department: departmentNorm,
      passwordHash,
      role: 'student',
      status: 'active'
    });
    const token = signToken(doc);
    return res.status(201).json({
      token,
      user: {
        id: String(doc._id),
        studentId: doc.studentId,
        email: doc.email,
        fullName: doc.fullName,
        role: resolveUserRole(doc.role, 'student'),
        department: doc.department
      }
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Signup failed' });
  }
});
// --- Admin Signup (enabled only if no admins yet, or ALLOW_ADMIN_SIGNUP=true)
app.post('/api/auth/admin-signup', authRateLimiter, async (req, res) => {
  try {
    const allow = String(process.env.ALLOW_ADMIN_SIGNUP || '').toLowerCase() === 'true';
    const existing = await Admin.estimatedDocumentCount();
    if (!allow && existing > 0) return res.status(403).json({ error: 'Admin signup is disabled' });

    const { adminId, fullName, email, password, confirmPassword } = req.body || {};
    if (!adminId || !fullName || !password || !confirmPassword) return res.status(400).json({ error: 'adminId, fullName, password, confirmPassword required' });
    if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
    if (String(password).length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return res.status(400).json({ error: 'Password must be at least 8 chars and contain letters and numbers' });

    const adminIdNorm = String(adminId).trim();
    const emailNorm = email ? String(email).trim().toLowerCase() : undefined;
    const fullNameNorm = String(fullName).trim();
    if (!STUDENT_ID_REGEX.test(adminIdNorm)) return res.status(400).json({ error: 'Admin ID must match 00-0000-000000 pattern' });
    if (email && !validator.isEmail(emailNorm)) return res.status(400).json({ error: 'Email must be valid' });

    const exists = await Admin.findOne({ $or: [ { adminId: adminIdNorm }, emailNorm ? { email: emailNorm } : null ].filter(Boolean) }).lean();
    if (exists) return res.status(409).json({ error: 'adminId or email already exists' });

    const passwordHash = await bcrypt.hash(String(password), 10);
    const doc = await Admin.create({ adminId: adminIdNorm, email: emailNorm, fullName: fullNameNorm, role: 'librarian', passwordHash });
    const token = signToken(doc);
    return res.status(201).json({
      token,
      user: {
        id: String(doc._id),
        studentId: doc.adminId,
        email: doc.email,
        fullName: doc.fullName,
        role: resolveUserRole(doc.role, 'librarian')
      }
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

});

// --- Auth: Login (studentId or email + password)
app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  const { password, studentId } = req.body || {};
  if (!studentId || !password) return res.status(400).json({ error: 'studentId and password required' });
  if (!NO_DB && !(mongoose.connection.readyState === 1 || DB_READY)) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const lookup = String(studentId).trim();
  let account = null;
  let isAdmin = false;
  let isFaculty = false;

  // Numeric ID pattern first
  if (STUDENT_ID_REGEX.test(lookup)) {
    account = await Admin.findOne({ adminId: lookup });
    if (account) isAdmin = true;

    if (!account) {
      account = await Faculty.findOne({ facultyId: lookup });
      if (account) isFaculty = true;
    }
    if (!account) account = await User.findOne({ studentId: lookup });
  }

  // Email fallback
  if (!account && lookup.includes('@')) {
    const email = lookup.toLowerCase();
    account = await Admin.findOne({ email });
    if (account) isAdmin = true;

    if (!account) {
      account = await Faculty.findOne({ email });
      if (account) isFaculty = true;
    }
    if (!account) account = await User.findOne({ email });
  }

  // Try dashed & raw numeric variants
  if (!account) {
    const digitsOnly = lookup.replace(/[^0-9]/g, '');
    if (digitsOnly.length === 12) {
      const dashed = `${digitsOnly.slice(0, 2)}-${digitsOnly.slice(2, 6)}-${digitsOnly.slice(6)}`;
      account = await Admin.findOne({ adminId: dashed }); if (account) isAdmin = true;
      if (!account) { account = await Faculty.findOne({ facultyId: dashed }); if (account) isFaculty = true; }
      if (!account) account = await User.findOne({ studentId: dashed });
    }
    if (!account) {
      account = await Admin.findOne({ adminId: digitsOnly }); if (account) isAdmin = true;
      if (!account) { account = await Faculty.findOne({ facultyId: digitsOnly }); if (account) isFaculty = true; }
      if (!account) account = await User.findOne({ studentId: digitsOnly });
    }
  }

  if (!account) return res.status(401).json({ error: 'invalid credentials' });

  const ok = await bcrypt.compare(String(password), account.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  // Checked after the password so a wrong password on a disabled account still
  // reads as "invalid credentials" and does not disclose that the account exists.
  if (normalizeUserStatus(account.status) === 'disabled') {
    return res.status(403).json({ error: 'Account is disabled' });
  }

  const role = resolveUserRole(account.role, isAdmin ? 'librarian' : isFaculty ? 'faculty' : 'student');
  const baseAccount = typeof account.toObject === 'function' ? account.toObject() : account;
  const token = signToken({ ...baseAccount, role });

  const payload = {
    id: String(account._id),
    studentId: account.adminId || account.studentId || account.facultyId,
    email: account.email,
    fullName: account.fullName,
    role,
    department: account.department
  };

  return res.json({ token, user: payload });
});

// Current user info
app.get('/api/auth/me', authRequired, async (req, res) => {
  let admin = await Admin.findById(req.user.sub).lean();
  if (admin) {
    return res.json({
      id: String(admin._id),
      studentId: admin.adminId,
      email: admin.email,
      fullName: admin.fullName,
      role: resolveUserRole(admin.role, 'librarian')
    });
  }
  const user = await User.findById(req.user.sub).lean();
  if (user) {
    return res.json({
      id: String(user._id),
      studentId: user.studentId,
      email: user.email,
      fullName: user.fullName,
      role: resolveUserRole(user.role, 'student'),
      department: user.department || ''
    });
  }
  const faculty = await Faculty.findById(req.user.sub).lean();
  if (faculty) {
    return res.json({
      id: String(faculty._id),
      studentId: faculty.facultyId,
      email: faculty.email,
      fullName: faculty.fullName,
      role: resolveUserRole(faculty.role, 'faculty')
    });
  }
  return res.status(404).json({ error: 'not found' });
});

// --- Student self-service endpoints
app.get('/api/student/me', studentRequired, async (req, res) => {
  const user = await User.findById(req.user.sub).lean();
  if (!user) return res.status(404).json({ error: 'not found' });
  return res.json({
    id: String(user._id),
    studentId: user.studentId,
    email: user.email,
    fullName: user.fullName,
    department: user.department || '',
    status: user.status,
    role: resolveUserRole(user.role, 'student'),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  });
});

app.patch('/api/student/me', studentRequired, async (req, res) => {
  const { fullName, department } = req.body || {};
  const update = {};

  if (typeof fullName !== 'undefined') {
    const trimmedName = String(fullName).trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (trimmedName.length > 120) {
      return res.status(400).json({ error: 'Full name is too long' });
    }
    update.fullName = trimmedName;
    update.name = trimmedName;
  }

  if (typeof department !== 'undefined') {
    const trimmedDepartment = String(department).trim();
    if (trimmedDepartment.length > 120) {
      return res.status(400).json({ error: 'Department name is too long' });
    }
    update.department = trimmedDepartment;
  }

  if (!Object.keys(update).length) {
    return res.status(400).json({ error: 'No changes submitted' });
  }

  update.updatedAt = new Date();

  const user = await User.findByIdAndUpdate(
    req.user.sub,
    { $set: update },
    { new: true, runValidators: true, context: 'query' }
  ).lean();

  if (!user) return res.status(404).json({ error: 'not found' });

  return res.json({
    id: String(user._id),
    studentId: user.studentId,
    email: user.email,
    fullName: user.fullName,
    department: user.department || '',
    status: user.status,
    role: resolveUserRole(user.role, 'student'),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  });
});

// --- Admins (librarians) CRUD
// Only accessible by librarian/admin (not librarian_staff)
app.get('/api/admins', elevatedAdminRequired, async (req, res) => {
  const q = String(req.query.q || '').trim();
  let filter = {};
  if (q) {
    const safeQuery = escapeRegex(q);
    filter = {
      $or: [
        { adminId: new RegExp(safeQuery, 'i') },
        { fullName: new RegExp(safeQuery, 'i') },
        { email: new RegExp(safeQuery, 'i') }
      ]
    };
  }
  const items = await Admin.find(filter)
    .select('adminId fullName email role status createdAt')
    .limit(200)
    .sort({ createdAt: -1 })
    .lean();
  const formatted = items.map((doc) => ({
    ...doc,
    role: resolveUserRole(doc.role, 'librarian_staff')
  }));
  res.json(formatted);
});

app.post('/api/admins', elevatedAdminRequired, async (req, res) => {
  try {
    const { adminId, email, fullName, password, role } = req.body || {};
    if (!adminId || !fullName || !password) return res.status(400).json({ error: 'adminId, fullName, password required' });
    const adminIdNorm = String(adminId).trim();
    const emailNorm = email ? String(email).trim().toLowerCase() : undefined;
    const fullNameNorm = String(fullName).trim();
    if (!STUDENT_ID_REGEX.test(adminIdNorm)) {
      return res.status(400).json({ error: 'adminId must match 00-0000-000000 pattern' });
    }
    const exists = await Admin.findOne({ $or: [ { adminId: adminIdNorm }, emailNorm ? { email: emailNorm } : null ].filter(Boolean) });
    if (exists) return res.status(409).json({ error: 'adminId or email already exists' });
    const allowedRoles = new Set(['librarian', 'librarian_staff']);
    const parsedRole = parseUserRole(role);
    const normalizedRole = parsedRole && allowedRoles.has(parsedRole) ? parsedRole : 'librarian_staff';
    const passwordHash = await bcrypt.hash(String(password), 10);
    const doc = await Admin.create({ adminId: adminIdNorm, email: emailNorm, fullName: fullNameNorm, role: normalizedRole, passwordHash });
    res.status(201).json({
      id: String(doc._id),
      adminId: doc.adminId,
      fullName: doc.fullName,
      email: doc.email,
      role: resolveUserRole(doc.role, normalizedRole)
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.patch('/api/admins/:id', elevatedAdminRequired, async (req, res) => {
  try {
    const update = {};
    if (req.body.fullName) update.fullName = String(req.body.fullName);
    if (req.body.email !== undefined) update.email = req.body.email ? String(req.body.email).toLowerCase() : undefined;
    if (req.body.status) update.status = String(req.body.status);
    if (req.body.role) {
      const allowedRoles = new Set(['librarian', 'librarian_staff']);
      const parsedRole = parseUserRole(req.body.role);
      if (!parsedRole || !allowedRoles.has(parsedRole)) {
        return res.status(400).json({ error: 'invalid role' });
      }
      update.role = parsedRole;
    }
    if (req.body.newPassword) update.passwordHash = await bcrypt.hash(String(req.body.newPassword), 10);
    const doc = await Admin.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({
      id: String(doc._id),
      adminId: doc.adminId,
      fullName: doc.fullName,
      email: doc.email,
      role: resolveUserRole(doc.role, update.role),
      status: doc.status
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/admins/:id', elevatedAdminRequired, async (req, res) => {
  const out = await Admin.findByIdAndDelete(req.params.id).lean();
  if (!out) return res.status(404).json({ error: 'Not found' });
  res.status(204).send();
});

// --- Faculty management
app.get('/api/faculty', adminRequired, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = {};
  if (q) {
    const safe = escapeRegex(q);
    filter.$or = [
      { fullName: new RegExp(safe, 'i') },
      { email: new RegExp(safe, 'i') },
      { facultyId: new RegExp(safe, 'i') },
      { department: new RegExp(safe, 'i') }
    ];
  }
  const items = await Faculty.find(filter)
    .select('fullName email facultyId department status createdAt')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json(items);
});

app.post('/api/faculty', adminRequired, async (req, res) => {
  try {
    const { facultyId, fullName, email, department, password, confirmPassword } = req.body || {};
    if (!facultyId || !fullName || !department || !password || !confirmPassword) {
      return res.status(400).json({ error: 'facultyId, fullName, department, password, confirmPassword required' });
    }
    if (String(password) !== String(confirmPassword)) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (String(password).length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 chars and contain letters and numbers' });
    }

    const facultyIdNorm = String(facultyId).trim();
    const fullNameNorm = String(fullName).trim();
    const departmentNorm = String(department).trim();
    const emailNorm = email ? String(email).trim().toLowerCase() : undefined;

    if (!STUDENT_ID_REGEX.test(facultyIdNorm)) {
      return res.status(400).json({ error: 'Faculty ID must match 00-0000-000000 pattern' });
    }
    if (!/^[A-Za-z .'-]+$/.test(fullNameNorm)) {
      return res.status(400).json({ error: 'Full name may contain letters, spaces, apostrophes, hyphens, and periods only' });
    }
    if (!departmentNorm) {
      return res.status(400).json({ error: 'Department is required' });
    }
    if (emailNorm && !validator.isEmail(emailNorm)) {
      return res.status(400).json({ error: 'Email must be valid' });
    }

    const [existingFaculty, userCollision, adminCollision] = await Promise.all([
      Faculty.findOne({
        $or: [
          { facultyId: facultyIdNorm },
          emailNorm ? { email: emailNorm } : null
        ].filter(Boolean)
      }).lean(),
      User.findOne({
        $or: [
          { studentId: facultyIdNorm },
          emailNorm ? { email: emailNorm } : null
        ].filter(Boolean)
      }).lean(),
      Admin.findOne({
        $or: [
          { adminId: facultyIdNorm },
          emailNorm ? { email: emailNorm } : null
        ].filter(Boolean)
      }).lean()
    ]);

    if (existingFaculty) {
      return res.status(409).json({ error: 'Faculty ID or email already exists' });
    }
    if (userCollision || adminCollision) {
      return res.status(409).json({ error: 'ID or email already assigned to another account' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const doc = await Faculty.create({
      facultyId: facultyIdNorm,
      fullName: fullNameNorm,
      email: emailNorm,
      department: departmentNorm,
      passwordHash,
      status: 'active'
    });

    return res.status(201).json({
      id: String(doc._id),
      facultyId: doc.facultyId,
      fullName: doc.fullName,
      email: doc.email,
      department: doc.department,
      status: doc.status
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Create failed' });
  }
});

app.patch('/api/faculty/:id', adminRequired, async (req, res) => {
  try {
    const doc = await Faculty.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const update = {};
    if (req.body.fullName !== undefined) {
      const fullNameNorm = String(req.body.fullName).trim();
      if (!/^[A-Za-z .'-]+$/.test(fullNameNorm)) {
        return res.status(400).json({ error: 'Full name may contain letters, spaces, apostrophes, hyphens, and periods only' });
      }
      update.fullName = fullNameNorm;
    }
    if (req.body.department !== undefined) {
      const deptNorm = String(req.body.department).trim();
      if (!deptNorm) return res.status(400).json({ error: 'Department is required' });
      update.department = deptNorm;
    }
    if (req.body.status !== undefined) {
      const allowed = ['active', 'disabled', 'pending'];
      if (!allowed.includes(req.body.status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      update.status = req.body.status;
    }
    if (req.body.email !== undefined) {
      const emailNorm = req.body.email ? String(req.body.email).trim().toLowerCase() : undefined;
      if (emailNorm && !validator.isEmail(emailNorm)) {
        return res.status(400).json({ error: 'Email must be valid' });
      }
      if (emailNorm !== doc.email) {
        const conflict = await Faculty.findOne({ _id: { $ne: doc._id }, email: emailNorm }).lean();
        if (conflict) return res.status(409).json({ error: 'Email already exists' });
        const otherCollision = await Promise.all([
          User.findOne({ email: emailNorm }).lean(),
          Admin.findOne({ email: emailNorm }).lean()
        ]);
        if (otherCollision.some(Boolean)) {
          return res.status(409).json({ error: 'Email already assigned to another account' });
        }
      }
      update.email = emailNorm;
    }
    if (req.body.newPassword) {
      const next = String(req.body.newPassword);
      if (next.length < 8 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
        return res.status(400).json({ error: 'Password must be at least 8 chars and contain letters and numbers' });
      }
      update.passwordHash = await bcrypt.hash(next, 10);
    }

    Object.assign(doc, update);
    await doc.save();

    return res.json({
      id: String(doc._id),
      facultyId: doc.facultyId,
      fullName: doc.fullName,
      email: doc.email,
      department: doc.department,
      status: doc.status
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Update failed' });
  }
});

// Request password reset (returns token for demo; normally emailed)
app.post('/api/auth/request-reset', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user) return res.status(404).json({ error: 'user not found' });
  const token = crypto.randomBytes(16).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await PasswordReset.create({ userId: user._id, tokenHash, expiresAt });
  // For demo we return the token; in production, send by email.
  return res.json({ ok: true, uid: String(user._id), token, expiresAt });
});

// Perform password reset
app.post('/api/auth/reset', async (req, res) => {
  const { uid, token, newPassword } = req.body || {};
  if (!uid || !token || !newPassword) return res.status(400).json({ error: 'uid, token, newPassword required' });
  if (String(newPassword).length < 8) return res.status(400).json({ error: 'password must be at least 8 chars' });
  let userId;
  try { userId = new mongoose.Types.ObjectId(String(uid)); } catch { return res.status(400).json({ error: 'invalid uid' }); }
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const rec = await PasswordReset.findOne({ userId, tokenHash, used: false, expiresAt: { $gt: new Date() } });
  if (!rec) return res.status(400).json({ error: 'invalid or expired token' });
  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  await User.findByIdAndUpdate(userId, { passwordHash });
  await PasswordReset.updateOne({ _id: rec._id }, { $set: { used: true, usedAt: new Date() } });
  await PasswordReset.updateMany({ userId, used: false }, { $set: { used: true, usedAt: new Date() } });
  return res.json({ ok: true });
});

// --- Dashboard
app.get('/api/dashboard', authRequired, async (_req, res) => {
  // start-of-day (for "visitsToday")
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  // run counts + top books in parallel
  const activeStatusFilter = { status: { $ne: 'disabled' } };
  const disabledStatusFilter = { status: 'disabled' };
  const studentRoleFilter = buildRoleFilter('student');
  const facultyRoleFilter = buildRoleFilter('faculty');

  const countsPromise = Promise.all([
    User.countDocuments({ ...studentRoleFilter, ...activeStatusFilter }), // active students
    User.countDocuments({ ...studentRoleFilter, ...disabledStatusFilter }), // disabled students
    User.countDocuments({ ...facultyRoleFilter, ...activeStatusFilter }), // active faculty
    User.countDocuments({ ...facultyRoleFilter, ...disabledStatusFilter }), // disabled faculty
    Faculty.countDocuments(), // total faculty records (legacy directory)
    Book.countDocuments(), // books in catalog
    Loan.countDocuments({ returnedAt: null }), // activeLoans
    Loan.countDocuments({ returnedAt: null, dueAt: { $lt: now } }), // overdue loans
    Visit.countDocuments({ enteredAt: { $gte: startOfDay } }) // visitsToday
  ]);

  const topBooksPipeline = [
    { $group: { _id: '$bookId', borrows: { $sum: 1 } } },
    { $sort: { borrows: -1 } },
    { $limit: 5 },
    { $lookup: { from: 'books', localField: '_id', foreignField: '_id', as: 'book' } },
    { $unwind: '$book' },
    { $project: { _id: 0, bookId: '$_id', title: '$book.title', author: '$book.author', borrows: 1 } }
  ];

  const [counts, topBooks] = await Promise.all([
    countsPromise,
    Loan.aggregate(topBooksPipeline).allowDiskUse(true)
  ]);

  const [
    activeStudents,
    disabledStudents,
    activeFaculty,
    disabledFaculty,
    facultyDirectoryTotal,
    books,
    activeLoans,
    overdue,
    visitsToday
  ] = counts;

  const totalFacultyAccounts = activeFaculty + disabledFaculty;
  const facultyCount = Math.max(totalFacultyAccounts, facultyDirectoryTotal);
  const activeUsers = activeStudents + activeFaculty;
  const disabledUsers = disabledStudents + disabledFaculty;
  const totalUsers = activeUsers + disabledUsers;

  res.json({
    counts: {
      users: activeUsers,
      disabledUsers,
      students: activeStudents,
      faculty: facultyCount,
      books,
      activeLoans,
      overdue,
      visitsToday,
      totalUsers
    },
    topBooks
  });
});


// --- Usage Heatmaps (visits)
app.get('/api/heatmap/visits', authRequired, async (req, res) => {
  let days;
  try {
    days = readNumericQueryParam(req.query.days, {
      name: 'days',
      defaultValue: 30,
      min: 1,
      integer: true
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const branch = req.query.branch;
  const match = { enteredAt: { $gte: since } };
  if (branch) match.branch = String(branch);

  const data = await Visit.aggregate([
    { $match: match },
    { $addFields: { dow: { $dayOfWeek: '$enteredAt' }, hour: { $hour: '$enteredAt' } } },
    { $group: { _id: { dow: '$dow', hour: '$hour' }, count: { $sum: 1 } } },
    { $project: { _id: 0, dow: '$_id.dow', hour: '$_id.hour', count: 1 } },
    { $sort: { dow: 1, hour: 1 } }
  ]);
  res.json({ since, items: data });
});

// --- Tracker: visit enter by studentId or barcode
app.post('/api/visit/enter', async (req, res) => {
  const { studentId, barcode, branch = 'Main' } = req.body || {};
  if (!studentId && !barcode) return res.status(400).json({ error: 'studentId or barcode required' });

  const normalizedStudentId = studentId ? String(studentId).trim() : null;
  const normalizedBarcode = barcode ? String(barcode).trim() : null;

  let user = null;
  if (normalizedStudentId) {
    user = await User.findOne({ studentId: normalizedStudentId }).lean();
  } else if (normalizedBarcode) {
    user = await User.findOne({ barcode: normalizedBarcode }).lean();
  }

  const now = new Date();
  const orFilters = [];
  if (user && user._id) orFilters.push({ userId: user._id });
  if (normalizedStudentId) orFilters.push({ studentId: normalizedStudentId });
  if (normalizedBarcode) orFilters.push({ barcode: normalizedBarcode });
  if (!orFilters.length) return res.status(400).json({ error: 'invalid payload' });

  const dupe = await Visit.findOne({
    $or: orFilters,
    enteredAt: { $gt: new Date(now.getTime() - 2 * 60 * 1000) }
  }).lean();

  if (!dupe) {
    await Visit.create({
      userId: user ? user._id : undefined,
      studentId: normalizedStudentId || (user ? user.studentId : undefined),
      barcode: normalizedBarcode || undefined,
      branch,
      enteredAt: now
    });
  }

  const displayName = user?.fullName || normalizedStudentId || normalizedBarcode || 'Unknown';
  res.json({ ok: true, deduped: !!dupe, user: { id: user?._id ? String(user._id) : null, fullName: displayName } });
});

// --- Tracker: visit exit (marks most recent active visit)
app.post('/api/visit/exit', async (req, res) => {
  const { studentId, barcode } = req.body || {};
  if (!studentId && !barcode) return res.status(400).json({ error: 'studentId or barcode required' });
  const filter = studentId ? { studentId: String(studentId) } : { barcode: String(barcode) };
  const doc = await Visit.findOneAndUpdate({ ...filter, exitedAt: null }, { exitedAt: new Date() }, { sort: { enteredAt: -1 }, new: true });
  if (!doc) return res.status(404).json({ error: 'active visit not found' });
  res.json({ ok: true, id: String(doc._id), exitedAt: doc.exitedAt });
});

// --- Recent visits feed (for tracker)
app.get('/api/visits/recent', authRequired, async (req, res) => {
  let minutes;
  try {
    minutes = readNumericQueryParam(req.query.minutes, {
      name: 'minutes',
      defaultValue: 60,
      min: 1,
      integer: true
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const since = new Date(Date.now() - minutes * 60 * 1000);
  const items = await Visit.aggregate([
    { $match: { enteredAt: { $gte: since } } },
    { $sort: { enteredAt: -1 } },
    { $limit: 50 },
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $project: { _id: 0, studentId: 1, barcode: 1, branch: 1, enteredAt: 1, exitedAt: 1, name: '$user.fullName' } }
  ]);
  res.json({ items });
});

// Tracker dashboard stats (visits + loans snapshot)
app.get('/api/tracker/stats', adminRequired, async (req, res) => {
  let hours;
  try {
    hours = readNumericQueryParam(req.query.hours ?? req.query.range ?? req.query.window, {
      name: 'hours',
      defaultValue: 24,
      min: 1,
      max: 24 * 14
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);

  const staffingWindowStart = new Date(now.getTime() - STAFFING_LOOKBACK_DAYS * MILLIS_PER_DAY);

  const [
    inboundRange,
    outboundRange,
    inboundToday,
    outboundToday,
    inboundTotal,
    outboundTotal,
    overdue,
    activeVisits,
    activeLoans,
    hourlyBuckets,
    dayBuckets
  ] = await Promise.all([
    Visit.countDocuments({ enteredAt: { $gte: since } }),
    Visit.countDocuments({ exitedAt: { $ne: null, $gte: since } }),
    Visit.countDocuments({ enteredAt: { $gte: startOfDay } }),
    Visit.countDocuments({ exitedAt: { $ne: null, $gte: startOfDay } }),
    Visit.countDocuments(),
    Visit.countDocuments({ exitedAt: { $ne: null } }),
    Loan.countDocuments({ returnedAt: null, dueAt: { $lt: now } }),
    Visit.countDocuments({ exitedAt: null }),
    Loan.countDocuments({ returnedAt: null }),
    Visit.aggregate([
      { $match: { enteredAt: { $gte: staffingWindowStart } } },
      { $group: { _id: { hour: { $hour: '$enteredAt' } }, count: { $sum: 1 } } },
      { $project: { _id: 0, hour: '$_id.hour', count: 1 } },
      { $sort: { hour: 1 } }
    ]),
    Visit.aggregate([
      { $match: { enteredAt: { $gte: staffingWindowStart } } },
      { $group: { _id: { dow: { $dayOfWeek: '$enteredAt' } }, count: { $sum: 1 } } },
      { $project: { _id: 0, dow: '$_id.dow', count: 1 } },
      { $sort: { dow: 1 } }
    ])
  ]);

  const staffing = {
    ...buildStaffingRecommendations(hourlyBuckets, dayBuckets, {
      lookbackDays: STAFFING_LOOKBACK_DAYS,
      visitsPerStaff: DEFAULT_VISITS_PER_STAFF
    }),
    window: { since: staffingWindowStart.toISOString(), days: STAFFING_LOOKBACK_DAYS }
  };

  res.json({
    inbound: inboundRange,
    outbound: outboundRange,
    overdue,
    active: activeVisits,
    activeLoans,
    range: { hours, since: since.toISOString() },
    today: { inbound: inboundToday, outbound: outboundToday, startOfDay: startOfDay.toISOString() },
    totals: { inbound: inboundTotal, outbound: outboundTotal },
    staffing
  });
});

// Recent loan activity for tracker quick log
app.get('/api/tracker/logs', adminRequired, async (req, res) => {
  let limit;
  let days;
  try {
    limit = readNumericQueryParam(req.query.limit, {
      name: 'limit',
      defaultValue: 25,
      min: 1,
      max: 100,
      integer: true
    });
    days = readNumericQueryParam(req.query.days, {
      name: 'days',
      defaultValue: 30,
      min: 1,
      max: 180,
      integer: true
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const docs = await Loan.aggregate([
    { $match: { borrowedAt: { $gte: since } } },
    { $sort: { borrowedAt: -1 } },
    { $limit: limit },
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'books', localField: 'bookId', foreignField: '_id', as: 'book' } },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        borrowedAt: 1,
        dueAt: 1,
        returnedAt: 1,
        userName: '$user.fullName',
        studentId: '$user.studentId',
        bookTitle: '$book.title'
      }
    }
  ]).exec();

  const now = new Date();
  const items = docs.map((doc) => {
    let status = 'Borrowed';
    if (doc.returnedAt) status = 'Returned';
    else if (doc.dueAt && doc.dueAt < now) status = 'Overdue';
    return {
      id: String(doc._id),
      status,
      borrowedAt: doc.borrowedAt,
      dueAt: doc.dueAt,
      returnedAt: doc.returnedAt,
      material: doc.bookTitle || 'Unknown Material',
      user: doc.userName || doc.studentId || 'Unknown Borrower'
    };
  });

  res.json({ items });
});

// --- Public library listing (auth), supports q and limit
app.get('/api/books/library', authRequired, async (req, res) => {
  const q = String(req.query.q || '').trim();
  let limit;
  let skip;
  try {
    limit = readNumericQueryParam(req.query.limit, {
      name: 'limit',
      defaultValue: 24,
      min: 1,
      max: 100,
      integer: true
    });
    skip = readNumericQueryParam(req.query.skip, {
      name: 'skip',
      defaultValue: 0,
      min: 0,
      integer: true
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const tag = String(req.query.tag || '').trim();
  const withPdf = String(req.query.withPdf || '').toLowerCase() === 'true';

  const filter = {};
  if (q) {
    const escaped = escapeRegex(q);
    const regex = new RegExp(escaped, 'i');
    filter.$or = [{ title: regex }, { author: regex }, { bookCode: regex }, { isbn: regex }];
  }
  if (tag) {
    const escapedTag = escapeRegex(tag);
    const tagRegex = new RegExp(`^${escapedTag}$`, 'i');
    filter.$and = filter.$and || [];
    filter.$and.push({ $or: [{ department: tagRegex }, { genre: tagRegex }, { tags: tagRegex }] });
  }
  if (withPdf) {
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { pdfPath: { $exists: true, $nin: [null, ''] } },
        { pdfFileId: { $exists: true, $ne: null } }
      ]
    });
  }

  const docs = await Book.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const role = String(req.user?.role || '').toLowerCase();
  const allowPdf = role === 'admin' || role === 'librarian' || role === 'librarian_staff';

  const items = docs.map((doc) => {
    const {
      pdfPath,
      pdfFileId,
      pdfOriginalName,
      pdfMime,
      coverImageFileId,
      coverImageOriginalName,
      __v,
      ...rest
    } = doc;

    const hasPdf = Boolean(pdfPath || pdfFileId);

    return {
      ...rest,
      coverImagePath: doc.coverImagePath || null,
      imageUrl: doc.coverImagePath || null,
      pdfUrl: allowPdf && pdfPath ? pdfPath : null,
      hasPdf
    };
  });

  res.json({ items });
});

app.get('/api/books/:id/pdf', authRequired, async (req, res) => {
  if (NO_DB) return res.status(503).json({ error: 'Database disabled (NO_DB=true)' });

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    return res.status(400).json({ error: 'invalid book id' });
  }

  const book = await Book.findById(id).select('title pdfFileId pdfPath pdfMime').lean();
  if (!book || (!book.pdfFileId && !book.pdfPath)) {
    return res.status(404).json({ error: 'PDF not found' });
  }

  const bucket = uploadBucket || (await waitForUploadBucket(5000).catch(() => null));
  if (!bucket) return res.status(503).json({ error: 'File storage is not ready yet' });

  let fileId = null;
  if (book.pdfFileId) {
    try {
      fileId = new mongoose.Types.ObjectId(String(book.pdfFileId));
    } catch {
      fileId = null;
    }
  }
  if (!fileId && book.pdfPath) {
    const extracted = extractFileIdFromPath(book.pdfPath);
    if (extracted && mongoose.Types.ObjectId.isValid(extracted)) {
      fileId = new mongoose.Types.ObjectId(extracted);
    }
  }
  if (!fileId) return res.status(404).json({ error: 'PDF file not found' });

  res.set('Content-Type', book.pdfMime || 'application/pdf');
  const safeName = sanitizeFilename(book.title || 'DigitalCopy');
  res.set('Content-Disposition', `inline; filename="${safeName}.pdf"`);

  const stream = bucket.openDownloadStream(fileId);
  stream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || 'Failed to read file' });
    } else {
      res.destroy(err);
    }
  });
  stream.pipe(res);
});

// --- Books CRUD (Admin)
app.post('/api/books', adminRequired, async (req, res) => {
  const {
    title,
    author,
    isbn,
    bookCode,
    department,
    genre,
    tags,
    totalCopies,
    availableCopies,
    coverImageData,
    coverImageName,
    pdfData,
    pdfName
  } = req.body || {};

  try {
    const normalizedTitle = String(title || '').trim();
    const normalizedAuthor = String(author || '').trim();
    const normalizedCode = String(bookCode || '').trim();
    if (!normalizedTitle || !normalizedAuthor || !normalizedCode) {
      return res.status(400).json({ error: 'title, author, and bookCode are required' });
    }

    const totalParsed = parseIntField(totalCopies, 'totalCopies');
    const totalValue = totalParsed === null ? 1 : totalParsed;
    const availableParsed = parseIntField(availableCopies, 'availableCopies');
    let availableValue = availableParsed === null ? totalValue : availableParsed;
    if (availableValue > totalValue) availableValue = totalValue;

    const normalizedDepartment = typeof department === 'string' ? department.trim() : '';
    const normalizedGenre = typeof genre === 'string' ? genre.trim() : '';
    const primaryTag = normalizedGenre || normalizedDepartment;
    const tagList = parseTagsInput(tags, primaryTag);

    const payload = {
      title: normalizedTitle,
      author: normalizedAuthor,
      isbn: isbn ? String(isbn).trim() : undefined,
      bookCode: normalizedCode,
      department: normalizedDepartment || undefined,
      genre: normalizedGenre || undefined,
      totalCopies: totalValue,
      availableCopies: availableValue,
      tags: tagList
    };

    const storedUploads = [];
    try {
      if (coverImageData) {
        const coverInfo = await storeBase64File({
          base64: coverImageData,
          originalName: coverImageName,
          allowedMime: ['image/png', 'image/jpeg', 'image/webp'],
          maxBytes: 5 * 1024 * 1024,
          subDir: 'covers'
        });
        payload.coverImagePath = coverInfo.storedPath;
        payload.coverImageOriginalName = coverInfo.originalName;
        payload.coverImageFileId = coverInfo.fileId;
        payload.coverImageMime = coverInfo.mime;
        storedUploads.push(coverInfo);
      }
      if (pdfData) {
        const pdfInfo = await storeBase64File({
          base64: pdfData,
          originalName: pdfName,
          allowedMime: ['application/pdf'],
          maxBytes: 25 * 1024 * 1024,
          subDir: 'pdfs'
        });
        payload.pdfPath = pdfInfo.storedPath;
        payload.pdfOriginalName = pdfInfo.originalName;
        payload.pdfFileId = pdfInfo.fileId;
        payload.pdfMime = pdfInfo.mime;
        storedUploads.push(pdfInfo);
      }

      const book = await Book.create(payload);
      res.status(201).json(book);
    } catch (err) {
      for (const stored of storedUploads) {
        await removeStoredFile(stored);
      }
      throw err;
    }
  } catch (e) {
    if (e && (e.code === 11000 || e.code === 11001)) {
      const field = e?.keyPattern ? Object.keys(e.keyPattern)[0] : null;
      if (field === 'bookCode') {
        return res.status(409).json({ error: 'Book code already exists. Please choose a unique code.' });
      }
    }
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/books', adminRequired, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = {};
  const andConditions = [];
  if (q) {
    const escaped = escapeRegex(q);
    const regex = new RegExp(escaped, 'i');
    andConditions.push({ $or: [{ title: regex }, { author: regex }, { bookCode: regex }] });
  }
  const tag = String(req.query.tag || '').trim();
  if (tag) {
    const escaped = escapeRegex(tag);
    const tagRegex = new RegExp(`^${escaped}$`, 'i');
    andConditions.push({ $or: [{ department: tagRegex }, { genre: tagRegex }, { tags: tagRegex }] });
  }
  if (andConditions.length === 1) {
    Object.assign(filter, andConditions[0]);
  } else if (andConditions.length > 1) {
    filter.$and = andConditions;
  }
  const items = await Book.find(filter).sort({ createdAt: -1, _id: -1 }).limit(400).lean();
  res.json(items);
});

// Registered before '/api/books/:id' — Express matches in order, and the
// param route would otherwise swallow 'lookup' and throw a CastError.
app.get('/api/books/lookup', authRequired, async (req, res) => {
  const { isbn, q, code } = req.query || {};
  const filter = {};
  if (isbn) filter.isbn = String(isbn);
  if (code) filter.bookCode = String(code);
  if (q) {
    const escaped = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { title: new RegExp(escaped, 'i') },
      { author: new RegExp(escaped, 'i') },
      { bookCode: new RegExp(escaped, 'i') }
    ];
  }
  const items = await Book.find(filter).limit(20).lean();
  res.json({ items });
});

app.get('/api/books/:id', adminRequired, async (req, res) => {
  const item = await Book.findById(req.params.id).lean();
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.patch('/api/books/:id', adminRequired, async (req, res) => {
  const {
    title,
    author,
    isbn,
    bookCode,
    department,
    genre,
    tags,
    totalCopies,
    availableCopies,
    coverImageData,
    coverImageName,
    pdfData,
    pdfName,
    coverRemoved
  } = req.body || {};

  let newCover;
  let newPdf;
  let oldCoverPath;
  let oldCoverFileId;
  let oldPdfPath;
  let oldPdfFileId;
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ error: 'Not found' });

    if (title !== undefined) {
      const trimmed = String(title).trim();
      if (!trimmed) throw new Error('title cannot be empty');
      book.title = trimmed;
    }
    if (author !== undefined) {
      const trimmed = String(author).trim();
      if (!trimmed) throw new Error('author cannot be empty');
      book.author = trimmed;
    }
    if (isbn !== undefined) {
      const trimmed = String(isbn).trim();
      book.isbn = trimmed || undefined;
    }
    if (bookCode !== undefined) {
      const trimmed = String(bookCode).trim();
      if (!trimmed) throw new Error('bookCode cannot be empty');
      book.bookCode = trimmed;
    }

    let nextDepartment = book.department;
    if (department !== undefined) {
      const trimmed = typeof department === 'string' ? department.trim() : '';
      nextDepartment = trimmed || undefined;
      book.department = nextDepartment;
    }

    let nextGenre = book.genre;
    if (genre !== undefined) {
      const trimmed = typeof genre === 'string' ? genre.trim() : '';
      nextGenre = trimmed || undefined;
      book.genre = nextGenre;
    }

    if (totalCopies !== undefined || availableCopies !== undefined) {
      let totalValue = book.totalCopies;
      let availableValue = book.availableCopies;
      if (totalCopies !== undefined) {
        const parsed = parseIntField(totalCopies, 'totalCopies');
        if (parsed !== null) totalValue = parsed;
      }
      if (availableCopies !== undefined) {
        const parsed = parseIntField(availableCopies, 'availableCopies');
        if (parsed !== null) availableValue = parsed;
      }
      if (availableValue > totalValue) availableValue = totalValue;
      book.totalCopies = totalValue;
      book.availableCopies = availableValue;
    }

    const removeCoverOnly = Boolean(coverRemoved && !coverImageData);
    if (removeCoverOnly && book.coverImagePath) {
      oldCoverPath = book.coverImagePath;
      oldCoverFileId = book.coverImageFileId;
      book.coverImagePath = undefined;
      book.coverImageOriginalName = undefined;
      book.coverImageFileId = undefined;
      book.coverImageMime = undefined;
    }

    if (coverImageData) {
      newCover = await storeBase64File({
        base64: coverImageData,
        originalName: coverImageName,
        allowedMime: ['image/png', 'image/jpeg', 'image/webp'],
        maxBytes: 5 * 1024 * 1024,
        subDir: 'covers'
      });
      oldCoverPath = book.coverImagePath;
      oldCoverFileId = book.coverImageFileId;
      book.coverImagePath = newCover.storedPath;
      book.coverImageOriginalName = newCover.originalName;
      book.coverImageFileId = newCover.fileId;
      book.coverImageMime = newCover.mime;
    }
    if (pdfData) {
      newPdf = await storeBase64File({
        base64: pdfData,
        originalName: pdfName,
        allowedMime: ['application/pdf'],
        maxBytes: 25 * 1024 * 1024,
        subDir: 'pdfs'
      });
      oldPdfPath = book.pdfPath;
      oldPdfFileId = book.pdfFileId;
      book.pdfPath = newPdf.storedPath;
      book.pdfOriginalName = newPdf.originalName;
      book.pdfFileId = newPdf.fileId;
      book.pdfMime = newPdf.mime;
    }

    const fallbackTag = nextGenre || nextDepartment;

    if (tags !== undefined) {
      book.tags = parseTagsInput(tags, fallbackTag);
    } else if (genre !== undefined || department !== undefined) {
      book.tags = parseTagsInput([], fallbackTag);
    }

    await book.save();

    if (removeCoverOnly && oldCoverPath) {
      await removeStoredFile({ storedPath: oldCoverPath, fileId: oldCoverFileId });
    }
    if (newCover && oldCoverPath && oldCoverPath !== newCover.storedPath) {
      await removeStoredFile({ storedPath: oldCoverPath, fileId: oldCoverFileId });
    }
    if (newPdf && oldPdfPath && oldPdfPath !== newPdf.storedPath) {
      await removeStoredFile({ storedPath: oldPdfPath, fileId: oldPdfFileId });
    }

    res.json(book.toObject());
  } catch (e) {
    if (newCover) await removeStoredFile(newCover);
    if (newPdf) await removeStoredFile(newPdf);
    if (e && (e.code === 11000 || e.code === 11001)) {
      const field = e?.keyPattern ? Object.keys(e.keyPattern)[0] : null;
      if (field === 'bookCode') {
        return res.status(409).json({ error: 'Book code already exists. Please choose a unique code.' });
      }
    }
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/books/:id', adminRequired, async (req, res) => {
  const out = await Book.findByIdAndDelete(req.params.id).lean();
  if (!out) return res.status(404).json({ error: 'Not found' });
  if (out.coverImagePath || out.coverImageFileId) {
    await removeStoredFile({ storedPath: out.coverImagePath, fileId: out.coverImageFileId });
  }
  if (out.pdfPath || out.pdfFileId) {
    await removeStoredFile({ storedPath: out.pdfPath, fileId: out.pdfFileId });
  }
  res.status(204).send();
});

app.get(['/api/files/:id', '/api/files/:id/:name'], async (req, res) => {
  if (NO_DB) return res.status(503).json({ error: 'Database disabled (NO_DB=true)' });

  const bucket =
    uploadBucket ||
    (await waitForUploadBucket(5000).catch(() => null));
  if (!bucket) return res.status(503).json({ error: 'File storage is not ready yet' });

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid file identifier' });
  }

  const fileId = new mongoose.Types.ObjectId(id);
  try {
    const filesCollection = mongoose.connection.db.collection('uploads.files');
    const fileDoc = await filesCollection.findOne({ _id: fileId });
    if (!fileDoc) return res.status(404).json({ error: 'File not found' });

    const contentType = fileDoc.contentType || fileDoc.metadata?.mime || 'application/octet-stream';
    res.set('Content-Type', contentType);

    const download = String(req.query.download || '').toLowerCase();
    const shouldDownload = download === '1' || download === 'true';
    if (shouldDownload) {
      const rawName =
        req.params.name ||
        fileDoc.metadata?.originalName ||
        fileDoc.filename ||
        `file-${id}`;
      const headerName = sanitizeFilename(rawName) || `file-${id}`;
      res.set(
        'Content-Disposition',
        `attachment; filename="${headerName}"`
      );
    }

    const stream = bucket.openDownloadStream(fileId);
    stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Failed to read file' });
      } else {
        res.destroy(err);
      }
    });
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Unexpected error' });
  }
});

// --- Loans
const STUDENT_NOTIFICATION_ICON = '/logo192.png';
const STUDENT_NOTIFICATION_BADGE = '/logo192.png';

function getStudentNotificationUrl(type) {
  switch (type) {
    case 'pending':
    case 'approved':
      return '/student/borrow-requests';
    case 'overdue':
      return '/student/overdue-books';
    case 'returned':
      return '/student/borrowing-history';
    default:
      return '/student/account';
  }
}

function formatNotificationDate(raw) {
  const date = coerceDate(raw);
  if (!date) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function dispatchStudentNotification(userId, payload) {
  if (!isPushConfigured()) return;
  if (!userId) return;
  const type = payload?.type || 'status';
  const title = payload?.title || 'LibReport Library';
  const body = payload?.body || '';
  const notificationPayload = {
    title,
    body,
    icon: payload?.icon || STUDENT_NOTIFICATION_ICON,
    badge: payload?.badge || STUDENT_NOTIFICATION_BADGE,
    tag: payload?.tag || `lr-${type}-${Date.now()}`,
    data: {
      url: payload?.url || getStudentNotificationUrl(type),
      type,
      ...payload?.data
    }
  };
  sendNotificationToUser(userId, notificationPayload).catch((err) => {
    console.error('[push] Dispatch error:', err?.message || err);
  });
}

async function markLoanAsReturned(loan) {
  if (!loan) {
    return { ok: false, status: 404, message: 'Active loan not found' };
  }
  if (loan.returnedAt) {
    return { ok: false, status: 400, message: 'Already returned' };
  }

  loan.returnedAt = new Date();
  loan.overdueNotifiedAt = null;
  await loan.save();
  if (loan.bookId) {
    await Book.findByIdAndUpdate(loan.bookId, { $inc: { availableCopies: 1 } });
  }

  return { ok: true, loan };
}

app.post('/api/loans/borrow', adminRequired, async (req, res) => {
  const { userId, bookId, days: daysRaw } = req.body || {};
  if (!userId || !bookId) return res.status(400).json({ error: 'userId and bookId required' });
  try {
    const { loan } = await borrowBookCore({
      borrowerId: userId,
      bookId,
      daysRaw,
      enforceUniqueLoan: false
    });
    res.status(201).json(loan);
  } catch (err) {
    sendError(res, err, 'Failed to create loan');
  }
});

// Student borrow requests
app.get('/api/student/notifications/public-key', studentRequired, (req, res) => {
  if (!isPushConfigured()) {
    return res.json({ enabled: false, publicKey: '' });
  }
  res.json({ enabled: true, publicKey: getPushPublicKey() });
});

app.post('/api/student/notifications/subscribe', studentRequired, async (req, res) => {
  if (!isPushConfigured()) {
    return res.status(503).json({ error: 'Push notifications are not configured on the server.' });
  }
  const result = await upsertSubscription({ userId: req.user.sub, body: req.body });
  if (!result.ok) {
    const status = result.reason === 'invalid-subscription' ? 400 : 500;
    return res.status(status).json({ error: 'Unable to store notification subscription.' });
  }
  res.status(201).json({ ok: true });
});

app.delete('/api/student/notifications/subscribe', studentRequired, async (req, res) => {
  const endpoint = req.body?.endpoint || req.query?.endpoint;
  if (endpoint) {
    await removeSubscription({ userId: req.user.sub, endpoint });
  }
  res.status(204).send();
});

app.post('/api/student/borrow-requests', studentRequired, async (req, res) => {
  const { bookId, days: daysRaw, note } = req.body || {};
  if (!bookId) return res.status(400).json({ error: 'bookId required' });
  if (!mongoose.Types.ObjectId.isValid(String(bookId))) {
    return res.status(400).json({ error: 'bookId must be a valid identifier' });
  }

  const userId = String(req.user.sub);
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'invalid user id' });
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const bookObjectId = new mongoose.Types.ObjectId(String(bookId));

  const book = await Book.findById(bookObjectId).lean();
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const activeLoan = await Loan.findOne({
    userId: userObjectId,
    bookId: bookObjectId,
    returnedAt: null
  }).lean();
  if (activeLoan) {
    return res.status(400).json({ error: 'You already have this book borrowed' });
  }

  const pending = await BorrowRequest.findOne({
    userId: userObjectId,
    bookId: bookObjectId,
    status: 'pending',
    requestType: 'borrow'
  }).lean();
  if (pending) {
    return res.status(400).json({ error: 'You already have a pending request for this book' });
  }

  let chosenDays;
  try {
    chosenDays = resolveLoanDuration(daysRaw);
  } catch (err) {
    return res.status(err?.status || 400).json({ error: err.message });
  }

  const trimmedNote = note ? String(note).trim().slice(0, 500) : '';

  let request;
  try {
    request = await BorrowRequest.create({
      userId: userObjectId,
      bookId: bookObjectId,
      daysRequested: chosenDays,
      message: trimmedNote,
      requestType: 'borrow'
    });
  } catch (err) {
    const message = String(err?.message || '').toLowerCase();
    if (message.includes('space quota')) {
      const freed = await freeSpaceForUploads();
      if (freed) {
        request = await BorrowRequest.create({
          userId: userObjectId,
          bookId: bookObjectId,
          daysRequested: chosenDays,
          message: trimmedNote,
          requestType: 'borrow'
        });
      } else {
        return res.status(507).json({
          error: 'Library storage is full. Please contact an administrator.'
        });
      }
    } else {
      throw err;
    }
  }

  const estimatedDueAt = new Date(Date.now() + chosenDays * 24 * 60 * 60 * 1000);

  res.status(201).json({
    id: String(request._id),
    status: request.status,
    requestType: request.requestType,
    requestedAt: request.createdAt ? request.createdAt.toISOString() : null,
    daysRequested: request.daysRequested,
    estimatedDueAt: estimatedDueAt.toISOString()
  });

  dispatchStudentNotification(req.user.sub, {
    type: 'pending',
    title: 'Borrow request submitted',
    body: `Your request for "${book.title || 'a library item'}" is now pending librarian review.`,
    data: {
      bookId: String(book._id),
      requestId: String(request._id)
    }
  });
});

app.get('/api/student/borrow-requests', studentRequired, async (req, res) => {
  const userId = String(req.user.sub || '');
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'invalid user id' });
  }

  const requests = await aggregateBorrowRequests({ userId: new mongoose.Types.ObjectId(userId) });
  res.json({ items: requests });
});

// Student self-service borrowing
app.post('/api/student/borrow', studentRequired, async (req, res) => {
  const { bookId, days: daysRaw } = req.body || {};
  if (!bookId) return res.status(400).json({ error: 'bookId required' });
  try {
    const { book, loan } = await borrowBookCore({
      borrowerId: req.user.sub,
      bookId,
      daysRaw,
      enforceUniqueLoan: true
    });
    res.status(201).json({
      id: loan._id,
      bookId: book._id,
      title: book.title,
      author: book.author,
      borrowedAt: loan.borrowedAt,
      dueAt: loan.dueAt
    });
  } catch (err) {
    sendError(res, err, 'Failed to create loan');
  }
});

// Student self-service renew
app.post('/api/student/renew', studentRequired, async (req, res) => {
  const { bookId, days: daysRaw, note } = req.body || {};
  if (!bookId) return res.status(400).json({ error: 'bookId required' });
  if (!mongoose.Types.ObjectId.isValid(String(bookId))) {
    return res.status(400).json({ error: 'bookId must be a valid identifier' });
  }

  const userId = String(req.user.sub || '');
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'invalid user id' });
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const bookObjectId = new mongoose.Types.ObjectId(String(bookId));

  const loan = await Loan.findOne({
    userId: userObjectId,
    bookId: bookObjectId,
    returnedAt: null
  });
  if (!loan) return res.status(404).json({ error: 'Active loan not found' });

  const pending = await BorrowRequest.findOne({
    userId: userObjectId,
    bookId: bookObjectId,
    status: 'pending',
    requestType: 'renewal'
  }).lean();
  if (pending) {
    return res.status(400).json({ error: 'You already have a pending renewal request for this book' });
  }

  let chosenDays;
  try {
    chosenDays = resolveLoanDuration(daysRaw);
  } catch (err) {
    return res.status(err?.status || 400).json({ error: err.message });
  }

  const trimmedNote = note ? String(note).trim().slice(0, 500) : '';

  const now = new Date();
  const baseDate = loan.dueAt && loan.dueAt > now ? loan.dueAt : now;
  const estimatedDueAt = new Date(baseDate.getTime() + chosenDays * 24 * 60 * 60 * 1000);

  const request = await BorrowRequest.create({
    userId: userObjectId,
    bookId: bookObjectId,
    loanId: loan._id,
    daysRequested: chosenDays,
    message: trimmedNote,
    requestType: 'renewal'
  });

  res.status(201).json({
    message: 'Renewal request submitted',
    currentDueAt: loan.dueAt instanceof Date ? loan.dueAt.toISOString() : loan.dueAt,
    request: {
      id: String(request._id),
      status: request.status,
      requestType: request.requestType,
      requestedAt: request.createdAt ? request.createdAt.toISOString() : new Date().toISOString(),
      daysRequested: request.daysRequested,
      estimatedDueAt: estimatedDueAt.toISOString()
    }
  });
});

app.get('/api/loans/requests', adminRequired, async (req, res) => {
  const statusRaw = String(req.query?.status || '').trim().toLowerCase();
  const match = {};
  if (statusRaw && statusRaw !== 'all' && ['pending', 'approved', 'rejected', 'cancelled'].includes(statusRaw)) {
    match.status = statusRaw;
  }

  const requests = await aggregateBorrowRequests(match);
  res.json({ items: requests });
});

app.post('/api/loans/requests/:id/approve', adminRequired, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    return res.status(400).json({ error: 'Invalid request id' });
  }

  const request = await BorrowRequest.findById(id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') {
    return res.status(400).json({ error: 'Request has already been processed' });
  }

  const { days: daysRaw, note } = req.body || {};
  let chosenDays;
  try {
    const fallback = request.daysRequested ?? undefined;
    chosenDays = resolveLoanDuration(typeof daysRaw === 'undefined' ? fallback : daysRaw);
  } catch (err) {
    return res.status(err?.status || 400).json({ error: err.message });
  }

  const borrowerId = request.userId;
  const bookId = request.bookId;
  const isRenewal = request.requestType === 'renewal';

  let loan;
  if (isRenewal) {
    loan = await Loan.findOne({ userId: borrowerId, bookId, returnedAt: null });
    if (!loan) {
      request.status = 'cancelled';
      request.processedAt = new Date();
      if (mongoose.Types.ObjectId.isValid(String(req.user?.sub))) {
        request.processedBy = new mongoose.Types.ObjectId(String(req.user.sub));
      }
      request.adminNote = 'Automatically cancelled: no active loan was available to renew.';
      await request.save();
      return res
        .status(409)
        .json({ error: 'No active loan found to renew. Request has been marked as cancelled.' });
    }

    const now = new Date();
    const baseDate = loan.dueAt && loan.dueAt > now ? loan.dueAt : now;
    loan.dueAt = new Date(baseDate.getTime() + chosenDays * 24 * 60 * 60 * 1000);
    await loan.save();
  } else {
    const existingLoan = await Loan.findOne({ userId: borrowerId, bookId, returnedAt: null }).lean();
    if (existingLoan) {
      request.status = 'cancelled';
      request.processedAt = new Date();
      if (mongoose.Types.ObjectId.isValid(String(req.user?.sub))) {
        request.processedBy = new mongoose.Types.ObjectId(String(req.user.sub));
      }
      request.adminNote = 'Automatically cancelled: borrower already has an active loan for this title.';
      await request.save();
      return res
        .status(409)
        .json({ error: 'Borrower already has this book checked out. Request has been marked as cancelled.' });
    }

    try {
      ({ loan } = await borrowBookCore({
        borrowerId,
        bookId,
        daysRaw: chosenDays,
        enforceUniqueLoan: true
      }));
    } catch (err) {
      return sendError(res, err, 'Failed to approve request');
    }
  }

  request.status = 'approved';
  request.daysRequested = chosenDays;
  request.loanId = loan._id;
  request.dueAt = loan.dueAt;
  request.processedAt = new Date();
  if (mongoose.Types.ObjectId.isValid(String(req.user?.sub))) {
    request.processedBy = new mongoose.Types.ObjectId(String(req.user.sub));
  }
  if (note) {
    request.adminNote = String(note).trim().slice(0, 500);
  }
  await request.save();

  const [details] = await aggregateBorrowRequests({ _id: request._id });
  res.json({
    message: isRenewal ? 'Renewal approved' : 'Request approved',
    request: details,
    loan: {
      id: String(loan._id),
      userId: String(loan.userId),
      bookId: String(loan.bookId),
      borrowedAt: loan.borrowedAt instanceof Date ? loan.borrowedAt.toISOString() : loan.borrowedAt,
      dueAt: loan.dueAt instanceof Date ? loan.dueAt.toISOString() : loan.dueAt
    }
  });

  const bookTitle = details?.book?.title || 'a library item';
  dispatchStudentNotification(request.userId, {
    type: 'approved',
    title: isRenewal ? 'Renewal approved' : 'Borrow request approved',
    body: isRenewal
      ? `Your renewal for "${bookTitle}" was approved. New due date: ${formatNotificationDate(loan.dueAt)}.`
      : `"${bookTitle}" is ready for pickup. Due date: ${formatNotificationDate(loan.dueAt)}.`,
    data: {
      bookId: String(request.bookId),
      requestId: String(request._id),
      loanId: String(loan._id),
      dueAt: loan.dueAt instanceof Date ? loan.dueAt.toISOString() : loan.dueAt
    }
  });
});

app.post('/api/loans/requests/:id/reject', adminRequired, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    return res.status(400).json({ error: 'Invalid request id' });
  }

  const request = await BorrowRequest.findById(id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') {
    return res.status(400).json({ error: 'Request has already been processed' });
  }

  const { note } = req.body || {};
  request.status = 'rejected';
  request.processedAt = new Date();
  if (mongoose.Types.ObjectId.isValid(String(req.user?.sub))) {
    request.processedBy = new mongoose.Types.ObjectId(String(req.user.sub));
  }
  if (note) {
    request.adminNote = String(note).trim().slice(0, 500);
  }
  await request.save();

  const [details] = await aggregateBorrowRequests({ _id: request._id });
  res.json({ message: 'Request rejected', request: details });
});

app.post('/api/loans/:id/renewal', adminRequired, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    return res.status(400).json({ error: 'Invalid loan id' });
  }

  const loan = await Loan.findById(id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (loan.returnedAt) {
    return res.status(400).json({ error: 'Loan has already been returned' });
  }

  const { days: daysRaw, dueAt: dueAtRaw } = req.body || {};
  let newDueAt;
  if (dueAtRaw) {
    const parsed = new Date(dueAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'dueAt must be a valid date' });
    }
    newDueAt = parsed;
  } else {
    let chosenDays;
    try {
      chosenDays = resolveLoanDuration(daysRaw);
    } catch (err) {
      return res.status(err?.status || 400).json({ error: err.message });
    }
    const now = new Date();
    const baseDate = loan.dueAt && loan.dueAt > now ? loan.dueAt : now;
    newDueAt = new Date(baseDate.getTime() + chosenDays * 24 * 60 * 60 * 1000);
  }

  loan.dueAt = newDueAt;
  await loan.save();

  await BorrowRequest.updateMany({ loanId: loan._id }, { $set: { dueAt: loan.dueAt } });

  res.json({
    message: 'Loan renewed successfully',
    loan: {
      id: String(loan._id),
      userId: String(loan.userId),
      bookId: String(loan.bookId),
      borrowedAt: loan.borrowedAt instanceof Date ? loan.borrowedAt.toISOString() : loan.borrowedAt,
      dueAt: loan.dueAt instanceof Date ? loan.dueAt.toISOString() : loan.dueAt
    }
  });
});

app.post('/api/loans/return', adminRequired, async (req, res) => {
  const { loanId, userId, bookId } = req.body || {};
  const query = loanId ? { _id: loanId } : { userId, bookId, returnedAt: null };
  if (!query._id && (!query.userId || !query.bookId)) {
    return res.status(400).json({ error: 'loanId or userId/bookId required' });
  }

  const loan = await Loan.findOne(query);
  const result = await markLoanAsReturned(loan);
  if (!result.ok) return res.status(result.status).json({ error: result.message });
  res.json(result.loan);
});

app.post('/api/loans/:id/return', adminRequired, async (req, res) => {
  const { id } = req.params;
  let loan;
  try {
    loan = await Loan.findById(id);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid loan id' });
  }

  const result = await markLoanAsReturned(loan);
  if (!result.ok) return res.status(result.status).json({ error: result.message });
  let returnedTitle = 'a library item';
  try {
    if (result.loan?.bookId) {
      const returnedBook = await Book.findById(result.loan.bookId).lean();
      if (returnedBook?.title) {
        returnedTitle = returnedBook.title;
      }
    }
  } catch (err) {
    console.error('Failed to load returned book title:', err?.message || err);
  }

  res.json(result.loan);

  if (result.loan?.userId) {
    dispatchStudentNotification(result.loan.userId, {
      type: 'returned',
      title: 'Book returned',
      body: `Your loan for "${returnedTitle}" has been marked as returned.`,
      data: {
        bookId: result.loan.bookId ? String(result.loan.bookId) : null,
        returnedAt: result.loan.returnedAt
      }
    });
  }
});

// Student self-service return
app.post('/api/student/return', studentRequired, async (req, res) => {
  const { bookId } = req.body || {};
  if (!bookId) return res.status(400).json({ error: 'bookId required' });
  
  const userId = req.user.sub;
  const loan = await Loan.findOne({ 
    userId: new mongoose.Types.ObjectId(userId), 
    bookId: new mongoose.Types.ObjectId(bookId), 
    returnedAt: null 
  });
  
  const result = await markLoanAsReturned(loan);
  if (!result.ok) return res.status(result.status).json({ error: result.message });

  let returnedTitle = 'a library item';
  try {
    if (result.loan?.bookId) {
      const returnedBook = await Book.findById(result.loan.bookId).lean();
      if (returnedBook?.title) {
        returnedTitle = returnedBook.title;
      }
    }
  } catch (err) {
    console.error('Failed to load returned book title:', err?.message || err);
  }
  
  res.status(200).json({
    message: 'Book returned successfully',
    bookId: bookId,
    returnedAt: result.loan.returnedAt
  });

  dispatchStudentNotification(userId, {
    type: 'returned',
    title: 'Book returned',
    body: `Thanks for returning "${returnedTitle}".`,
    data: {
      bookId: bookId,
      returnedAt: result.loan.returnedAt
    }
  });
});

app.delete('/api/loans/:id', adminRequired, async (req, res) => {
  let loan;
  try {
    loan = await Loan.findById(req.params.id);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid loan id' });
  }

  if (!loan) return res.status(404).json({ error: 'Loan not found' });

  const wasReturned = Boolean(loan.returnedAt);
  const bookId = loan.bookId;

  await Loan.deleteOne({ _id: loan._id });

  if (!wasReturned && bookId) {
    await Book.findByIdAndUpdate(bookId, { $inc: { availableCopies: 1 } });
  }

  return res.status(204).send();
});

// Active loans with user + book details (for Books Management UI)
app.get('/api/loans/active', adminRequired, async (_req, res) => {
  const now = new Date();
  const pipeline = [
    { $match: { returnedAt: null } },
    { $sort: { dueAt: 1, borrowedAt: -1 } },
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $lookup: { from: 'books', localField: 'bookId', foreignField: '_id', as: 'book' } },
    { $unwind: '$book' },
    { $project: {
        _id: 1,
        userId: 1,
        bookId: 1,
        borrowedAt: 1,
        dueAt: 1,
        returnedAt: 1,
        user: {
          _id: '$user._id',
          fullName: '$user.fullName',
          name: '$user.name',
          studentId: '$user.studentId'
        },
        book: {
          _id: '$book._id',
          title: '$book.title',
          bookCode: '$book.bookCode'
        }
      }
    }
  ];

  const docs = await Loan.aggregate(pipeline).exec();
  const items = docs.map((doc) => {
    const status = resolveLoanStatusMeta(doc, { now, activeLabel: 'On Time' });
    return {
      id: String(doc._id || doc.id || ''),
      bookId: doc.book?._id ? String(doc.book._id) : doc.bookId ? String(doc.bookId) : null,
      title: doc.book?.title || '',
      bookCode: doc.book?.bookCode || '',
      borrowerId: doc.user?._id ? String(doc.user._id) : doc.userId ? String(doc.userId) : null,
      borrowerName: doc.user?.fullName || doc.user?.name || '',
      borrowerStudentId: doc.user?.studentId || '',
      borrowedAt: coerceDate(doc.borrowedAt),
      dueAt: coerceDate(doc.dueAt),
      statusKey: status.key,
      statusLabel: status.label
    };
  });

  res.json({ items });
});

app.get('/api/loans/history', adminRequired, async (req, res) => {
  const now = new Date();
  let limit = 50;
  let page = 1;

  try {
    limit = readNumericQueryParam(req.query.limit, {
      name: 'limit',
      defaultValue: 50,
      min: 1,
      max: 200,
      integer: true
    });
  } catch {}

  try {
    page = readNumericQueryParam(req.query.page, {
      name: 'page',
      defaultValue: 1,
      min: 1,
      integer: true
    });
  } catch {}

  const rawStatus = String(req.query.status || '').trim().toLowerCase();
  let statusFilter = rawStatus;
  if (statusFilter === 'on_time' || statusFilter === 'on-time' || statusFilter === 'current') {
    statusFilter = 'active';
  }

  const matchStage = {};
  if (statusFilter === 'returned') {
    matchStage.returnedAt = { $ne: null };
  } else if (statusFilter === 'overdue') {
    matchStage.returnedAt = null;
    matchStage.dueAt = { $lt: now };
  } else if (statusFilter === 'active') {
    matchStage.returnedAt = null;
    matchStage.dueAt = { $gte: now };
  }

  const hasMatch = Object.keys(matchStage).length > 0;
  const total = await Loan.countDocuments(hasMatch ? matchStage : {});
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const skip = (safePage - 1) * limit;

  const pipeline = [];
  if (hasMatch) {
    pipeline.push({ $match: matchStage });
  }
  pipeline.push({ $sort: { borrowedAt: -1, _id: -1 } });
  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });
  pipeline.push({ $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } });
  pipeline.push({ $unwind: { path: '$user', preserveNullAndEmptyArrays: true } });
  pipeline.push({ $lookup: { from: 'books', localField: 'bookId', foreignField: '_id', as: 'book' } });
  pipeline.push({ $unwind: { path: '$book', preserveNullAndEmptyArrays: true } });
  pipeline.push({
    $project: {
      _id: 1,
      userId: 1,
      bookId: 1,
      borrowedAt: 1,
      dueAt: 1,
      returnedAt: 1,
      user: {
        _id: '$user._id',
        fullName: '$user.fullName',
        name: '$user.name',
        studentId: '$user.studentId'
      },
      book: {
        _id: '$book._id',
        title: '$book.title',
        bookCode: '$book.bookCode'
      }
    }
  });

  const docs = await Loan.aggregate(pipeline).exec();
  const items = docs.map((doc) => {
    const status = resolveLoanStatusMeta(doc, { now, activeLabel: 'Active' });
    const label =
      typeof status.label === 'string' && status.label.length
        ? status.label.charAt(0).toUpperCase() + status.label.slice(1)
        : 'Returned';
    return {
      id: String(doc._id || doc.id || ''),
      bookId: doc.book?._id ? String(doc.book._id) : doc.bookId ? String(doc.bookId) : null,
      title: doc.book?.title || '',
      bookCode: doc.book?.bookCode || '',
      borrowerId: doc.user?._id ? String(doc.user._id) : doc.userId ? String(doc.userId) : null,
      borrowerName: doc.user?.fullName || doc.user?.name || '',
      borrowerStudentId: doc.user?.studentId || '',
      borrowedAt: coerceDate(doc.borrowedAt),
      dueAt: coerceDate(doc.dueAt),
      returnedAt: coerceDate(doc.returnedAt),
      statusKey: status.key,
      statusLabel: label
    };
  });

  res.json({
    items,
    page: safePage,
    limit,
    total,
    status: statusFilter || 'all'
  });
});

app.get('/api/student/:id/borrowed', authRequired, async (req, res) => {
  let userId;
  try {
    userId = new mongoose.Types.ObjectId(String(req.params.id));
  } catch {
    return res.status(400).json({ error: 'invalid user id' });
  }

  const requesterRole = req.user?.role;
  const requesterId = String(req.user?.sub || '');
  const isAdmin = requesterRole === 'admin' || requesterRole === 'librarian';
  if (!isAdmin && requesterId !== String(userId)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const items = await Loan.aggregate([
    { $match: { userId, returnedAt: null } },
    { $lookup: { from: 'books', localField: 'bookId', foreignField: '_id', as: 'book' } },
    { $unwind: '$book' },
    { $project: { _id: 0, title: '$book.title', author: '$book.author', borrowedAt: 1, dueAt: 1 } }
  ]);
  res.json({ items });
});

// Student self-service borrowed books
app.get('/api/student/borrowed', studentRequired, async (req, res) => {
  const userId = req.user.sub;
  
  const items = await Loan.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), returnedAt: null } },
    { $lookup: { from: 'books', localField: 'bookId', foreignField: '_id', as: 'book' } },
    { $unwind: '$book' },
    { $project: { 
      _id: 1,
      bookId: '$book._id',
      title: '$book.title',
      author: '$book.author',
      bookCode: '$book.bookCode',
      borrowedAt: 1, 
      dueAt: 1 
    } }
  ]);
  res.json({ books: items });
});

// Student self-service overdue books
app.get('/api/student/overdue-books', studentRequired, async (req, res) => {
  const userId = req.user.sub;
  const now = new Date();
  
  const items = await Loan.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        returnedAt: null,
        dueAt: { $lt: now }
      } 
    },
    { $lookup: { from: 'books', localField: 'bookId', foreignField: '_id', as: 'book' } },
    { $unwind: '$book' },
    { 
      $project: { 
        _id: 1,
        bookId: '$book._id',
        title: '$book.title', 
        author: '$book.author',
        bookCode: '$book.bookCode',
        borrowedAt: 1, 
        dueAt: 1,
        daysOverdue: { $floor: { $divide: [{ $subtract: [now, '$dueAt'] }, 86400000] } }
      }
    }
  ]);

  const overdueLookup = new Map();
  const overdueIds = [];
  items.forEach((doc) => {
    if (!doc || !doc._id) return;
    const key = String(doc._id);
    overdueLookup.set(key, doc);
    overdueIds.push(doc._id);
  });

  if (isPushConfigured() && overdueIds.length) {
    const notifiedAt = new Date();
    const freshOverdue = await Loan.find({
      _id: { $in: overdueIds },
      overdueNotifiedAt: null
    })
      .select('_id bookId dueAt overdueNotifiedAt')
      .lean();

    for (const loanDoc of freshOverdue) {
      try {
        await Loan.updateOne({ _id: loanDoc._id }, { $set: { overdueNotifiedAt: notifiedAt } });
        const item = overdueLookup.get(String(loanDoc._id));
        const title = item?.title || item?.book?.title || 'a library item';
        const daysOverdue = item?.daysOverdue ?? 0;
        dispatchStudentNotification(userId, {
          type: 'overdue',
          title: 'Overdue reminder',
          body:
            daysOverdue > 1
              ? `"${title}" is overdue by ${daysOverdue} days. Please return or renew it as soon as possible.`
              : `"${title}" is overdue. Please return or renew it as soon as possible.`,
          data: {
            bookId: loanDoc.bookId ? String(loanDoc.bookId) : null,
            loanId: String(loanDoc._id),
            dueAt: loanDoc.dueAt
          }
        });
      } catch (err) {
        console.error('Failed to dispatch overdue notification:', err?.message || err);
      }
    }
  }
  
  // Add fine calculation (example: $1 per day overdue)
  const booksWithFines = items.map((book) => ({
    id: String(book._id || book.id || ''),
    bookId: book.bookId ? String(book.bookId) : null,
    title: book.title || '',
    author: book.author || '',
    bookCode: book.bookCode || '',
    borrowedAt: book.borrowedAt,
    dueAt: book.dueAt,
    daysOverdue: book.daysOverdue,
    fine: Math.max(0, Number(book.daysOverdue || 0) * 1.0)
  }));

  res.json({ books: booksWithFines });
});

// Student self-service borrowing history
app.get('/api/student/borrowing-history', studentRequired, async (req, res) => {
  const userId = req.user.sub;
  
  const items = await Loan.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $lookup: { from: 'books', localField: 'bookId', foreignField: '_id', as: 'book' } },
    { $unwind: '$book' },
    { $sort: { borrowedAt: -1 } },
    { 
      $project: { 
        _id: 1,
        bookId: '$book._id',
        title: '$book.title', 
        author: '$book.author',
        bookCode: '$book.bookCode',
        borrowedAt: 1, 
        dueAt: 1,
        returnedAt: 1,
        status: {
          $cond: {
            if: { $ne: ['$returnedAt', null] },
            then: 'Returned',
            else: {
              $cond: {
                if: { $lt: ['$dueAt', new Date()] },
                then: 'Overdue',
                else: 'Active'
              }
            }
          }
        }
      } 
    }
  ]);
  
  const history = items.map((item) => ({
    id: String(item._id || item.id || ''),
    bookId: item.bookId ? String(item.bookId) : null,
    title: item.title || '',
    author: item.author || '',
    bookCode: item.bookCode || '',
    borrowedAt: item.borrowedAt,
    dueAt: item.dueAt,
    returnedAt: item.returnedAt,
    status: item.status
  }));

  res.json({ history });
});

app.get('/api/student/visit-history', studentRequired, async (req, res) => {
  const rawId = String(req.user.sub || '');
  if (!mongoose.Types.ObjectId.isValid(rawId)) {
    return res.status(400).json({ error: 'invalid user id' });
  }

  let page = Number.parseInt(req.query.page, 10);
  let pageSize = Number.parseInt(req.query.pageSize, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 5;
  if (pageSize > 20) pageSize = 20;

  const userObjectId = new mongoose.Types.ObjectId(rawId);
  const filter = { userId: userObjectId };

  const total = await Visit.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil((total || 1) / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const skip = (safePage - 1) * pageSize;

  const visits = await Visit.find(filter)
    .sort({ enteredAt: -1, _id: -1 })
    .skip(skip)
    .limit(pageSize)
    .lean();

  const mapped = visits.map((doc) => {
    const enteredAt =
      doc.enteredAt instanceof Date ? doc.enteredAt.toISOString() : doc.enteredAt || null;
    const exitedAt =
      doc.exitedAt instanceof Date ? doc.exitedAt.toISOString() : doc.exitedAt || null;
    let durationMinutes = null;
    if (doc.enteredAt instanceof Date && doc.exitedAt instanceof Date) {
      const diff = doc.exitedAt.getTime() - doc.enteredAt.getTime();
      if (Number.isFinite(diff) && diff > 0) {
        durationMinutes = Math.max(1, Math.round(diff / 60000));
      }
    }
    return {
      id: String(doc._id),
      branch: doc.branch || 'Main',
      enteredAt,
      exitedAt,
      durationMinutes,
      isActive: !doc.exitedAt
    };
  });

  res.json({
    page: safePage,
    pageSize,
    total,
    totalPages,
    visits: mapped
  });
});

// --- Reports
app.get('/api/reports/top-books', authRequired, async (req, res) => {
  let limit;
  try {
    limit = readNumericQueryParam(req.query.limit, {
      name: 'limit',
      defaultValue: 10,
      min: 1,
      max: 50,
      integer: true
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const pipeline = [];
  const hasDaysFilter = !(req.query.days === undefined || req.query.days === null || req.query.days === '');
  if (hasDaysFilter) {
    let days;
    try {
      days = readNumericQueryParam(req.query.days, {
        name: 'days',
        min: 1,
        integer: true
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    pipeline.push({ $match: { borrowedAt: { $gte: since } } });
  }
  pipeline.push(
    { $group: { _id: '$bookId', borrows: { $sum: 1 } } },
    { $sort: { borrows: -1 } },
    { $limit: limit },
    { $lookup: { from: 'books', localField: '_id', foreignField: '_id', as: 'book' } },
    { $unwind: '$book' },
    { $project: { _id: 0, bookId: '$_id', title: '$book.title', author: '$book.author', borrows: 1 } }
  );
  const data = await Loan.aggregate(pipeline);
  res.json({ items: data });
});

app.get('/api/reports/overdue', authRequired, async (req, res) => {
  let limit;
  try {
    limit = readNumericQueryParam(req.query.limit, {
      name: 'limit',
      defaultValue: 100,
      min: 1,
      max: 500,
      integer: true
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const dueMatch = { returnedAt: null, dueAt: { $lt: new Date() } };
  const hasDaysFilter = !(req.query.days === undefined || req.query.days === null || req.query.days === '');
  if (hasDaysFilter) {
    let days;
    try {
      days = readNumericQueryParam(req.query.days, {
        name: 'days',
        min: 1,
        integer: true
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    dueMatch.dueAt.$gte = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }
  const items = await Loan.aggregate([
    { $match: dueMatch },
    { $sort: { dueAt: 1 } },
    { $limit: limit },
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
    { $lookup: { from: 'books', localField: 'bookId', foreignField: '_id', as: 'book' } },
    { $unwind: '$user' },
    { $unwind: '$book' },
    { $project: { _id: 0, user: '$user.fullName', title: '$book.title', dueAt: 1, borrowedAt: 1 } }
  ]);
  res.json({ items });
});

app.get('/api/reports/top-borrowers', authRequired, async (req, res) => {
  let limit;
  try {
    limit = readNumericQueryParam(req.query.limit, {
      name: 'limit',
      defaultValue: 10,
      min: 1,
      max: 50,
      integer: true
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const hasDaysFilter = !(req.query.days === undefined || req.query.days === null || req.query.days === '');
  let since = null;
  const match = { userId: { $ne: null } };
  if (hasDaysFilter) {
    try {
      const days = readNumericQueryParam(req.query.days, {
        name: 'days',
        min: 1,
        max: 365,
        integer: true
      });
      since = new Date(Date.now() - days * MILLIS_PER_DAY);
      match.borrowedAt = { $gte: since };
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const countMatch = { ...match };
  delete countMatch.lastBorrowedAt;

  const [rawItems, totalLoans] = await Promise.all([
    Loan.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$userId',
          borrows: { $sum: 1 },
          activeLoans: { $sum: { $cond: [{ $eq: ['$returnedAt', null] }, 1, 0] } },
          overdueLoans: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$returnedAt', null] }, { $lt: ['$dueAt', '$$NOW'] }] },
                1,
                0
              ]
            }
          },
          lastBorrowedAt: { $max: '$borrowedAt' }
        }
      },
      { $sort: { borrows: -1, _id: 1 } },
      { $limit: limit },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
    ]),
    Loan.countDocuments(countMatch)
  ]);

  const items = rawItems
    .filter((row) => row?._id)
    .map((row) => {
      const borrows = Number(row.borrows || 0);
      const activeLoans = Number(row.activeLoans || 0);
      const overdueLoans = Number(row.overdueLoans || 0);
      const share = totalLoans > 0 ? (borrows / totalLoans) * 100 : 0;
      return {
        userId: row._id ? String(row._id) : null,
        fullName: row.user?.fullName || row.user?.name || 'Unknown Borrower',
        studentId: row.user?.studentId || null,
        email: row.user?.email || null,
        department: row.user?.department || null,
        borrows,
        activeLoans,
        overdueLoans,
        lastBorrowedAt: row.lastBorrowedAt || null,
        share: Number(share.toFixed(1))
      };
    });

  const totalBorrows = items.reduce((acc, item) => acc + (item.borrows || 0), 0);

  res.json({
    since,
    totalLoans,
    totalBorrows,
    items
  });
});

app.get('/api/reports/genre-trends', authRequired, async (req, res) => {
  let days;
  let limit;
  try {
    days = readNumericQueryParam(req.query.days, {
      name: 'days',
      defaultValue: 90,
      min: 7,
      max: 365,
      integer: true
    });
    limit = readNumericQueryParam(req.query.limit, {
      name: 'limit',
      defaultValue: 12,
      min: 3,
      max: 50,
      integer: true
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const since = new Date(Date.now() - days * MILLIS_PER_DAY);
  const previousStart = new Date(since.getTime() - days * MILLIS_PER_DAY);

  const buildPipeline = (matchStage) => [
    { $match: matchStage },
    { $lookup: { from: 'books', localField: 'bookId', foreignField: '_id', as: 'book' } },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        topic: {
          $let: {
            vars: {
              genre: { $ifNull: ['$book.genre', ''] },
              department: { $ifNull: ['$book.department', ''] }
            },
            in: {
              $cond: [
                { $gt: [{ $strLenCP: '$$genre' }, 0] },
                '$$genre',
                {
                  $cond: [
                    { $gt: [{ $strLenCP: '$$department' }, 0] },
                    '$$department',
                    'Uncategorized'
                  ]
                }
              ]
            }
          }
        }
      }
    },
    {
      $group: {
        _id: '$topic',
        borrows: { $sum: 1 },
        activeLoans: { $sum: { $cond: [{ $eq: ['$returnedAt', null] }, 1, 0] } },
        lastBorrowedAt: { $max: '$borrowedAt' }
      }
    },
    {
      $project: {
        _id: 0,
        topic: '$_id',
        borrows: 1,
        activeLoans: 1,
        lastBorrowedAt: 1
      }
    },
    { $sort: { borrows: -1, topic: 1 } }
  ];

  const [current, previous, totalLoans] = await Promise.all([
    Loan.aggregate([...buildPipeline({ borrowedAt: { $gte: since } }), { $limit: limit }]),
    Loan.aggregate([
      ...buildPipeline({ borrowedAt: { $gte: previousStart, $lt: since } }),
      { $limit: limit }
    ]),
    Loan.countDocuments({ borrowedAt: { $gte: since } })
  ]);

  const previousMap = new Map(previous.map((row) => [row.topic, Number(row.borrows || 0)]));
  const totalBorrows = current.reduce((acc, row) => acc + Number(row.borrows || 0), 0);
  const totalActiveLoans = current.reduce((acc, row) => acc + Number(row.activeLoans || 0), 0);
  const shareDenominator = totalBorrows + totalActiveLoans || totalBorrows || totalLoans || 0;

  const items = current.map((row) => {
    const borrows = Number(row.borrows || 0);
    const activeLoans = Number(row.activeLoans || 0);
    const prev = previousMap.get(row.topic) || 0;
    // Include active loans as a demand multiplier so high-inflight topics surface prominently.
    const share = shareDenominator > 0 ? ((borrows + activeLoans) / shareDenominator) * 100 : 0;
    const growth =
      prev === 0 ? (borrows > 0 ? 100 : 0) : ((borrows - prev) / prev) * 100;
    return {
      topic: row.topic || 'Uncategorized',
      borrows,
      activeLoans,
      lastBorrowedAt: row.lastBorrowedAt || null,
      share: Number(share.toFixed(1)),
      growth: Number(growth.toFixed(1))
    };
  });

  res.json({
    since,
    previousWindow: { start: previousStart, end: since },
    totalLoans,
    totalBorrows,
    items
  });
});

app.get('/api/reports/underutilized', authRequired, async (req, res) => {
  let days;
  let limit;
  try {
    days = readNumericQueryParam(req.query.days, {
      name: 'days',
      defaultValue: 60,
      min: 7,
      max: 365,
      integer: true
    });
    limit = readNumericQueryParam(req.query.limit, {
      name: 'limit',
      defaultValue: 20,
      min: 5,
      max: 100,
      integer: true
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const since = new Date(Date.now() - days * MILLIS_PER_DAY);

  const basePipeline = [
    {
      $lookup: {
        from: 'loans',
        let: { bookId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$bookId', '$$bookId'] }
            }
          },
          {
            $group: {
              _id: null,
              lastBorrowedAt: { $max: '$borrowedAt' },
              borrowCount: { $sum: 1 },
              activeLoans: { $sum: { $cond: [{ $eq: ['$returnedAt', null] }, 1, 0] } }
            }
          }
        ],
        as: 'loanStats'
      }
    },
    {
      $addFields: {
        lastBorrowedAt: { $ifNull: [{ $arrayElemAt: ['$loanStats.lastBorrowedAt', 0] }, null] },
        borrowCount: { $ifNull: [{ $arrayElemAt: ['$loanStats.borrowCount', 0] }, 0] },
        activeLoans: { $ifNull: [{ $arrayElemAt: ['$loanStats.activeLoans', 0] }, 0] }
      }
    },
    {
      $addFields: {
        daysSinceBorrowed: {
          $cond: [
            { $or: [{ $eq: ['$lastBorrowedAt', null] }, { $not: ['$lastBorrowedAt'] }] },
            null,
            { $divide: [{ $subtract: ['$$NOW', '$lastBorrowedAt'] }, MILLIS_PER_DAY] }
          ]
        }
      }
    },
    {
      $match: {
        $or: [{ lastBorrowedAt: null }, { lastBorrowedAt: { $lt: since } }]
      }
    },
    {
      $project: {
        _id: 1,
        title: 1,
        author: 1,
        genre: 1,
        department: 1,
        bookCode: 1,
        totalCopies: 1,
        availableCopies: 1,
        borrowCount: 1,
        activeLoans: 1,
        lastBorrowedAt: 1,
        daysSinceBorrowed: 1
      }
    }
  ];

  const [itemsRaw, totalCountDocs] = await Promise.all([
    Book.aggregate([
      ...basePipeline,
      { $sort: { lastBorrowedAt: 1, title: 1 } },
      { $limit: limit }
    ]),
    Book.aggregate([...basePipeline, { $count: 'total' }])
  ]);

  const totalUnderutilized = totalCountDocs?.[0]?.total || 0;

  const items = itemsRaw.map((book) => {
    const daysSince =
      book.lastBorrowedAt && book.daysSinceBorrowed !== null && book.daysSinceBorrowed !== undefined
        ? Math.round(book.daysSinceBorrowed)
        : null;
    const daysIdleLabel = daysSince === null || daysSince === undefined ? 'Never' : String(daysSince);
    return {
      bookId: String(book._id),
      title: book.title || 'Untitled',
      author: book.author || '',
      genre: book.genre || null,
      department: book.department || null,
      bookCode: book.bookCode || null,
      totalCopies: book.totalCopies ?? null,
      availableCopies: book.availableCopies ?? null,
      borrowCount: Number(book.borrowCount || 0),
      activeLoans: Number(book.activeLoans || 0),
      lastBorrowedAt: book.lastBorrowedAt || null,
      daysSinceLastBorrowed: daysSince,
      daysIdle: daysIdleLabel,
      status: book.lastBorrowedAt ? 'Stale' : 'Never borrowed'
    };
  });

  const neverBorrowed = items.filter((item) => !item.lastBorrowedAt).length;
  const maxDays = items.reduce(
    (acc, item) => (item.daysSinceLastBorrowed ? Math.max(acc, item.daysSinceLastBorrowed) : acc),
    0
  );

  res.json({
    since,
    thresholdDays: days,
    totalUnderutilized,
    neverBorrowed,
    longestDormantDays: maxDays,
    items
  });
});

app.get('/api/reports/fines', authRequired, async (req, res) => {
  let limit;
  try {
    limit = readNumericQueryParam(req.query.limit, {
      name: 'limit',
      defaultValue: 25,
      min: 5,
      max: 200,
      integer: true
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const now = new Date();
  const result = await Loan.aggregate([
    { $match: { returnedAt: null, dueAt: { $lt: now } } },
    {
      $addFields: {
        overdueDays: {
          $max: [
            0,
            {
              $floor: {
                $divide: [{ $subtract: ['$$NOW', '$dueAt'] }, MILLIS_PER_DAY]
              }
            }
          ]
        }
      }
    },
    {
      $addFields: {
        fine: { $multiply: ['$overdueDays', FINE_RATE_PER_DAY] }
      }
    },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              totalOutstanding: { $sum: '$fine' },
              totalDays: { $sum: '$overdueDays' },
              loans: { $sum: 1 }
            }
          }
        ],
        items: [
          { $sort: { fine: -1 } },
          { $limit: limit },
          { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
          { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
          { $lookup: { from: 'books', localField: 'bookId', foreignField: '_id', as: 'book' } },
          { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              userId: '$userId',
              bookId: '$bookId',
              borrower: '$user.fullName',
              studentId: '$user.studentId',
              title: '$book.title',
              dueAt: 1,
              borrowedAt: 1,
              overdueDays: 1,
              fine: 1
            }
          }
        ]
      }
    }
  ]);

  const payload = result?.[0] || {};
  const summaryDoc = payload.summary?.[0] || { totalOutstanding: 0, totalDays: 0, loans: 0 };

  const items = (payload.items || []).map((row) => ({
    loanId: row._id ? String(row._id) : null,
    borrower: row.borrower || 'Unknown Borrower',
    studentId: row.studentId || null,
    title: row.title || 'Untitled',
    dueAt: row.dueAt || null,
    borrowedAt: row.borrowedAt || null,
    daysOverdueValue: Math.max(0, Number(row.overdueDays || 0)),
    fineValue: Math.max(0, Number(row.fine || 0))
  }));

  const formattedItems = items.map((item) => ({
    ...item,
    daysOverdue: item.daysOverdueValue.toString(),
    fine: item.fineValue.toFixed(2)
  }));

  const totals = {
    outstanding: Number(summaryDoc.totalOutstanding || 0),
    overdueLoans: Number(summaryDoc.loans || 0),
    averageFine:
      summaryDoc.loans > 0
        ? Number(((summaryDoc.totalOutstanding || 0) / summaryDoc.loans).toFixed(2))
        : 0,
    averageDaysOverdue:
      summaryDoc.loans > 0
        ? Number(((summaryDoc.totalDays || 0) / summaryDoc.loans).toFixed(1))
        : 0
  };

  res.json({
    ratePerDay: FINE_RATE_PER_DAY,
    totals,
    items: formattedItems
  });
});

// --- Hours
app.get('/api/hours', authRequired, async (req, res) => {
  const branch = String(req.query.branch || 'Main');
  await Hours.deleteMany({ branch, dayOfWeek: { $nin: VALID_LIBRARY_DAYS } });
  await Promise.all(
    DEFAULT_LIBRARY_HOURS.map(({ dayOfWeek, open, close }) =>
      // $setOnInsert, not $set: this seeds missing days only. With $set every
      // read would overwrite whatever an admin saved via PUT /api/hours/:branch/:day.
      Hours.updateOne(
        { branch, dayOfWeek },
        { $setOnInsert: { branch, dayOfWeek, open, close } },
        { upsert: true, runValidators: true }
      )
    )
  );
  const items = await Hours.find({ branch, dayOfWeek: { $in: VALID_LIBRARY_DAYS } })
    .sort({ dayOfWeek: 1 })
    .lean();
  res.json({ branch, items });
});

app.put('/api/hours/:branch/:day', adminRequired, async (req, res) => {
  const branch = String(req.params.branch);
  const day = Number(req.params.day);
  const { open, close } = req.body || {};
  if (!Number.isInteger(day) || !VALID_LIBRARY_DAYS.includes(day)) {
    return res.status(400).json({ error: 'Library hours are tracked for Monday through Saturday only' });
  }
  const nextOpen = open ? String(open) : '08:00';
  const nextClose = close ? String(close) : '17:00';
  const doc = await Hours.findOneAndUpdate(
    { branch, dayOfWeek: day },
    { branch, dayOfWeek: day, open: nextOpen, close: nextClose },
    { new: true, upsert: true, runValidators: true }
  ).lean();
  res.json(doc);
});

// --- Admin: users list + role update
app.get('/api/admin/users', adminRequired, async (req, res) => {
  const q = String(req.query.q || '').trim();
  let filter = {};
  if (q) {
    const safeQuery = escapeRegex(q);
    filter = {
      $or: [
        { fullName: new RegExp(safeQuery, 'i') },
        { email: new RegExp(safeQuery, 'i') },
        { studentId: new RegExp(safeQuery, 'i') }
      ]
    };
  }
  const items = await User.find(filter)
    .select('fullName email studentId role department status createdAt')
    .limit(200)
    .lean();
  const formatted = items.map((doc) => ({
    ...doc,
    role: resolveUserRole(doc.role, 'student')
  }));
  res.json(formatted);
});

app.post('/api/admin/users', adminRequired, async (req, res) => {
  try {
    const { studentId, email, fullName, department, password, confirmPassword, role, status } = req.body || {};
    if (!studentId || !email || !fullName || !department || !password || !confirmPassword) {
      return res.status(400).json({ error: 'studentId, email, fullName, department, password, confirmPassword required' });
    }
    if (String(password) !== String(confirmPassword)) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (String(password).length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 chars and contain letters and numbers' });
    }

    const studentIdNorm = String(studentId).trim();
    const emailNorm = String(email).trim().toLowerCase();
    const fullNameNorm = String(fullName).trim();
    const departmentNorm = typeof department === 'string' ? department.trim() : '';

    if (!STUDENT_ID_REGEX.test(studentIdNorm)) {
      return res.status(400).json({ error: 'Student ID must match 00-0000-000000 pattern' });
    }
    if (!validator.isEmail(emailNorm)) {
      return res.status(400).json({ error: 'Email must be valid' });
    }
    if (!/^[A-Za-z .'-]+$/.test(fullNameNorm)) {
      return res.status(400).json({ error: 'Full name may contain letters, spaces, apostrophes, hyphens, and periods only' });
    }
    if (!departmentNorm) {
      return res.status(400).json({ error: 'Department is required' });
    }

    const roleNorm = resolveUserRole(role, 'faculty');
    const statusNorm = normalizeUserStatus(status);

    const existing = await User.findOne({
      $or: [
        { studentId: studentIdNorm },
        { email: emailNorm }
      ]
    }).lean();
    if (existing) {
      return res.status(409).json({ error: 'studentId or email already exists' });
    }

    const existingAdmin = await Admin.findOne({
      $or: [
        { adminId: studentIdNorm },
        emailNorm ? { email: emailNorm } : null
      ].filter(Boolean)
    }).lean();
    if (existingAdmin) {
      return res.status(409).json({ error: 'studentId or email already exists' });
    }

    const existingFaculty = await Faculty.findOne({
      $or: [
        { facultyId: studentIdNorm },
        { email: emailNorm }
      ]
    }).lean();
    if (existingFaculty) {
      return res.status(409).json({ error: 'studentId or email already exists' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const doc = await User.create({
      studentId: studentIdNorm,
      email: emailNorm,
      fullName: fullNameNorm,
      name: fullNameNorm,
      department: departmentNorm,
      passwordHash,
      role: roleNorm,
      status: statusNorm
    });

    if (roleNorm === 'faculty') {
      await Faculty.findOneAndUpdate(
        { facultyId: studentIdNorm },
        {
          facultyId: studentIdNorm,
          email: emailNorm,
          fullName: fullNameNorm,
          department: departmentNorm,
          user: doc._id
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    res.status(201).json({
      id: String(doc._id),
      studentId: doc.studentId,
      email: doc.email,
      fullName: doc.fullName,
      role: resolveUserRole(doc.role, roleNorm),
      department: doc.department,
      status: doc.status,
      createdAt: doc.createdAt
    });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Unable to create user' });
  }
});

app.patch('/api/admin/users/:id/role', adminRequired, async (req, res) => {
  const { role } = req.body || {};
  if (!role) return res.status(400).json({ error: 'role required' });
  const parsedRole = parseUserRole(role);
  if (!parsedRole) return res.status(400).json({ error: 'invalid role' });
  const user = await User.findByIdAndUpdate(req.params.id, { role: parsedRole }, { new: true, runValidators: true }).lean();
  if (!user) return res.status(404).json({ error: 'Not found' });
  const userRole = resolveUserRole(user.role, parsedRole);
  if (userRole === 'faculty') {
    await Faculty.findOneAndUpdate(
      { facultyId: user.studentId },
      {
        facultyId: user.studentId,
        email: user.email,
        fullName: user.fullName,
        department: user.department || '',
        user: user._id
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } else {
    await Faculty.findOneAndDelete({ facultyId: user.studentId });
  }
  res.json({ id: String(user._id), role: userRole });
});

// --- Admin: toggle user status
app.patch('/api/admin/users/:id/status', adminRequired, async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'status required' });
  const normalizedStatus = normalizeUserStatus(status);
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { status: normalizedStatus },
    { new: true, runValidators: true }
  ).lean();
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: String(user._id), status: user.status });
});

app.patch('/api/admin/users/:id/department', adminRequired, async (req, res) => {
  const rawDepartment = req.body?.department;
  const department = typeof rawDepartment === 'string' ? rawDepartment.trim() : '';
  if (!department) return res.status(400).json({ error: 'department required' });

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });

  user.department = department;
  await user.save();

  const userRole = resolveUserRole(user.role, 'student');
  if (userRole === 'faculty') {
    await Faculty.findOneAndUpdate(
      { facultyId: user.studentId },
      { $set: { department } },
      { upsert: false }
    );
  }

  res.json({ id: String(user._id), department: user.department || '' });
});

app.patch('/api/admin/users/:id/password', adminRequired, async (req, res) => {
  const rawPassword = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
  if (rawPassword.length < 8) {
    return res
      .status(400)
      .json({ error: 'Password must be at least 8 characters long.' });
  }

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });

  user.password = await bcrypt.hash(rawPassword, 10);
  await user.save();

  res.json({ message: 'Password updated successfully.' });
});

app.delete('/api/admin/uploads/pdfs', adminRequired, async (req, res) => {
  if (NO_DB) return res.status(503).json({ error: 'Database disabled (NO_DB=true)' });

  const rawLimit = req.query.limit;
  const dryRun = String(req.query.dryRun || '').toLowerCase() === 'true';

  let limit = Number(rawLimit);
  if (!Number.isFinite(limit) || limit <= 0) limit = 0;

  const bucket = uploadBucket || (await waitForUploadBucket(5000).catch(() => null));
  if (!bucket || !mongoose.connection?.db) {
    return res.status(503).json({ error: 'File storage is not ready yet' });
  }

  const filesCollection = mongoose.connection.db.collection('uploads.files');
  const filter = {
    $or: [
      { contentType: 'application/pdf' },
      { 'metadata.mime': 'application/pdf' },
      { 'metadata.contentType': 'application/pdf' }
    ]
  };

  let cursor = filesCollection.find(filter).sort({ uploadDate: 1 });
  if (limit > 0) cursor = cursor.limit(limit);
  const files = await cursor.toArray();
  if (!files.length) {
    return res.json({ removed: 0, message: 'No PDF uploads found.' });
  }

  if (dryRun) {
    return res.json({
      removable: files.length,
      ids: files.map((file) => String(file._id)),
      totalSize: files.reduce((sum, file) => sum + (file.length || 0), 0)
    });
  }

  let removed = 0;
  let bookResets = 0;

  for (const file of files) {
    try {
      await bucket.delete(file._id);
      removed += 1;
    } catch (err) {
      console.error('Failed to delete upload', file._id, err);
      continue;
    }

    try {
      const updateResult = await Book.updateMany(
        {
          $or: [
            { pdfFileId: file._id },
            { pdfPath: { $regex: file._id.toString(), $options: 'i' } }
          ]
        },
        {
          $unset: {
            pdfFileId: '',
            pdfPath: '',
            pdfMime: '',
            pdfOriginalName: ''
          }
        }
      );
      bookResets += updateResult?.modifiedCount || 0;
    } catch (err) {
      console.error('Failed to clear book PDF references', file._id, err);
    }
  }

  res.json({ removed, bookResets });
});

// --- Lookups
app.get('/api/users/lookup', authRequired, async (req, res) => {
  const { studentId, email, barcode } = req.query || {};
  const filter = studentId ? { studentId: String(studentId) } : email ? { email: String(email).toLowerCase() } : barcode ? { barcode: String(barcode) } : null;
  if (!filter) return res.status(400).json({ error: 'studentId, email, or barcode required' });
  const user = await User.findOne(filter).select('fullName email studentId role status').lean();
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({
    ...user,
    role: resolveUserRole(user.role, 'student')
  });
});

// Static asset routes for legacy book files have been removed

// --- Error handler
// Registered last so it catches rejections from every route above (Express 5
// forwards async errors here). Without it Express replies with an HTML page
// that embeds the stack trace and absolute file paths, and the frontend — which
// reads err.response.data.error — has nothing to show the user.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (res.headersSent) return;

  if (err?.name === 'CastError') {
    return res.status(400).json({ error: `invalid ${err.path === '_id' ? 'id' : err.path}` });
  }
  if (err?.name === 'ValidationError') {
    const details = Object.values(err.errors || {}).map((e) => e.message);
    return res.status(400).json({ error: details.join('; ') || 'validation failed' });
  }
  if (err?.code === 11000 || err?.code === 11001) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    return res.status(409).json({ error: field ? `${field} already exists` : 'duplicate value' });
  }
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'malformed JSON body' });
  }

  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err?.stack || err);
  return res.status(500).json({ error: 'internal error' });
});

const PORT = process.env.BACKEND_PORT || 4000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
}

module.exports = {
  app,
  coerceDate,
  resolveLoanStatusMeta,
  buildStaffingRecommendations
};

