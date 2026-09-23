// Normalize empty-string fields so unique partial indexes work across versions.
// - Unset empty strings for optional fields (barcode, admin.email, bookCode)
// - Report invalid/empty required fields (users.studentId, users.email)
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), override: false });
const { MongoClient } = require('mongodb');
const { resolveMongoConfig } = require('../db/uri');

(async () => {
  const { uri, dbName } = resolveMongoConfig();
  if (!uri) { console.error('Missing MONGO_URI'); process.exit(1); }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);

    const r1 = await db.collection('users').updateMany({ barcode: '' }, { $unset: { barcode: '' } });
    const r1b = await db.collection('users').updateMany({ email: '' }, { $unset: { email: '' } });
    const invalidUsers = await db.collection('users').find({ $or: [ { studentId: { $in: [null, ''] } }, { email: { $in: [null, ''] } } ] }).project({ _id: 1, studentId: 1, email: 1 }).limit(10).toArray();

    const r2 = await db.collection('admins').updateMany({ email: '' }, { $unset: { email: '' } });
    const r3 = await db.collection('books').updateMany({ bookCode: '' }, { $unset: { bookCode: '' } });

    console.log('Sanitized:', {
      usersClearedBarcode: r1.modifiedCount,
      usersClearedEmail: r1b.modifiedCount,
      adminsClearedEmail: r2.modifiedCount,
      booksClearedBookCode: r3.modifiedCount
    });
    if (invalidUsers.length) {
      console.warn('Users with missing/empty required fields (fix before indexing):');
      for (const u of invalidUsers) {
        console.warn({ id: String(u._id), studentId: u.studentId, email: u.email });
      }
    }
  } catch (e) {
    console.error('Sanitize error:', e.message);
    process.exit(2);
  } finally {
    await client.close().catch(() => {});
  }
})();

