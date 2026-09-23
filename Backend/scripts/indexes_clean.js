// Audit and optionally drop obsolete/duplicate indexes so the DB matches our managed set.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const { MongoClient } = require('mongodb');
const { resolveMongoConfig } = require('../db/uri');

function parseArgs(argv) {
  const out = { apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply' || a === '-y') out.apply = true;
  }
  return out;
}

const MANAGED = {
  users: new Set([
    '_id_',
    'user_name',
    'user_role',
    'user_email_unique',
    'user_studentId_unique',
    'user_barcode_unique'
  ]),
  admins: new Set([
    '_id_',
    'admin_adminId_unique',
    'admin_email_unique'
  ]),
  faculty: new Set([
    '_id_',
    'faculty_facultyId',
    'faculty_email_unique',
    'faculty_department_status'
  ]),
  books: new Set([
    '_id_',
    'books_text',
    'books_bookCode_unique'
  ]),
  loans: new Set([
    '_id_',
    'loans_user_time',
    'loans_book_return',
    'loans_due'
  ]),
  visits: new Set([
    '_id_',
    'visits_user_time',
    'visits_barcode_time'
  ]),
  hours: new Set([
    '_id_',
    'hours_branch_dow'
  ])
};

// Allow GridFS standard indexes to be left alone
const GRIDFS_OK = new Set(['filename_1_uploadDate_1', 'files_id_1_n_1', '_id_']);

(async () => {
  const args = parseArgs(process.argv);
  const { uri, dbName } = resolveMongoConfig();
  if (!uri) { console.error('Missing MONGO_URI'); process.exit(1); }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const names = (await db.listCollections().toArray()).map(c => c.name).sort();
    const report = {};
    for (const coll of names) {
      const idx = await db.collection(coll).indexes();
      const managed = MANAGED[coll];
      const toDrop = [];
      for (const i of idx) {
        const name = i.name;
        if (managed) {
          if (!managed.has(name)) {
            toDrop.push(name);
          }
        } else if (coll.startsWith('uploads.')) {
          if (!GRIDFS_OK.has(name)) {
            // Leave unexpected GridFS indexes in place by default
          }
        }
      }
      if (toDrop.length) {
        report[coll] = toDrop;
        if (args.apply) {
          for (const d of toDrop) {
            try {
              await db.collection(coll).dropIndex(d);
              console.log(`Dropped index ${coll}.${d}`);
            } catch (e) {
              console.warn(`Could not drop ${coll}.${d}: ${e.message}`);
            }
          }
        }
      }
    }
    if (!args.apply) {
      if (Object.keys(report).length === 0) {
        console.log('All indexes are already managed. Nothing to drop.');
      } else {
        console.log('Obsolete indexes that would be dropped (run with --apply to proceed):');
        console.log(JSON.stringify(report, null, 2));
      }
    }
  } catch (e) {
    console.error('Index clean error:', e.message);
    process.exit(2);
  } finally {
    await client.close().catch(() => {});
  }
})();

