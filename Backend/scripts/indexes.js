// backend/scripts/indexes.js
const path = require('node:path');
const env = require('../utils/dotenv');
env.config({ path: path.resolve(process.cwd(), '.env') });
const { MongoClient } = require('mongodb');
const { resolveMongoConfig } = require('../db/uri');

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
  if (MEMORY_SERVER_DOWNLOAD_DIR) binary.downloadDir = MEMORY_SERVER_DOWNLOAD_DIR;
  if (MEMORY_SERVER_SYSTEM_BINARY) binary.systemBinary = MEMORY_SERVER_SYSTEM_BINARY;
  if (MEMORY_SERVER_OS) binary.os = MEMORY_SERVER_OS;
  if (MEMORY_SERVER_SKIP_MD5) {
    binary.skipMD5 = true;
    binary.checkMD5 = false;
  }
  return { binary };
}

// Create indexes for collections used by the app. Supports real MongoDB
// or an in-memory MongoDB when USE_MEMORY_DB=true.
(async () => {
  let { uri, dbName } = resolveMongoConfig();
  const USE_MEMORY_DB = String(process.env.USE_MEMORY_DB || '').toLowerCase() === 'true';
  let mem;
  if (USE_MEMORY_DB) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mem = await MongoMemoryServer.create(buildMemoryServerOptions());
    uri = mem.getUri();
  }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);

    await db.collection('users').createIndexes([
      { key: { name: 1 }, name: 'user_name' },
      { key: { role: 1 }, name: 'user_role' },
      // email is required by schema; enforce global unique
      { key: { email: 1 }, name: 'user_email_unique', unique: true },
      // studentId is required by schema; enforce global unique
      { key: { studentId: 1 }, name: 'user_studentId_unique', unique: true },
      // optional barcode: avoid $ne in partials (not supported on some versions)
      { key: { barcode: 1 }, name: 'user_barcode_unique', unique: true, partialFilterExpression: { barcode: { $exists: true } } }
    ]);

    await db.collection('books').createIndexes([
      { key: { title: 'text', author: 'text' }, name: 'books_text' },
      { key: { bookCode: 1 }, name: 'books_bookCode_unique', unique: true, partialFilterExpression: { bookCode: { $exists: true } } }
    ]);

    await db.collection('loans').createIndexes([
      { key: { userId: 1, borrowedAt: -1 }, name: 'loans_user_time' },
      { key: { bookId: 1, returnedAt: 1 }, name: 'loans_book_return' },
      { key: { dueAt: 1 }, name: 'loans_due' }
    ]);

    await db.collection('visits').createIndexes([
      { key: { userId: 1, enteredAt: -1 }, name: 'visits_user_time' },
      { key: { barcode: 1, enteredAt: -1 }, name: 'visits_barcode_time' }
    ]);

    await db.collection('hours').createIndexes([
      { key: { branch: 1, dayOfWeek: 1 }, name: 'hours_branch_dow', unique: true }
    ]);

    // Admins: unique adminId and email (email sparse/partial unique)
    await db.collection('admins').createIndexes([
      { key: { adminId: 1 }, name: 'admin_adminId_unique', unique: true },
      { key: { email: 1 }, name: 'admin_email_unique', unique: true, partialFilterExpression: { email: { $exists: true } } }
    ]);

    await db.collection('faculty').createIndexes([
      { key: { facultyId: 1 }, name: 'faculty_facultyId_unique', unique: true },
      {
        key: { email: 1 },
        name: 'faculty_email_unique',
        unique: true,
        partialFilterExpression: { email: { $type: 'string', $exists: true, $ne: '' } }
      },
      { key: { department: 1, status: 1 }, name: 'faculty_department_status' }
    ]);

    console.log('Indexes created');
  } catch (e) {
    console.error('Index error:', e.message);
  } finally {
    await client.close();
    if (typeof mem !== 'undefined' && mem) { await mem.stop(); }
  }
})();
