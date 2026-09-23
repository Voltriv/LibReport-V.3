// Quick check for admins collection and counts
const path = require('node:path');
const env = require('../utils/dotenv');
env.config({ path: path.resolve(process.cwd(), '.env') });
const { MongoClient } = require('mongodb');
const { resolveMongoConfig } = require('../db/uri');

(async () => {
  const { uri, dbName } = resolveMongoConfig();
  if (!uri) {
    console.error('MONGO_URI is not set.');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const colls = await db.listCollections({}, { nameOnly: true }).toArray();
    const names = colls.map(c => c.name).sort();
    const adminsCount = await db.collection('admins').countDocuments().catch(() => 0);
    const oneAdmin = await db.collection('admins').findOne({}, { projection: { _id: 0, adminId: 1, email: 1, fullName: 1, role: 1 } }).catch(() => null);
    console.log(JSON.stringify({ dbName, collections: names, adminsCount, sample: oneAdmin }, null, 2));
  } catch (e) {
    console.error('Check error:', e.message);
    process.exit(2);
  } finally {
    await client.close().catch(() => {});
  }
})();

