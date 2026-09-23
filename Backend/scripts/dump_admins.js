const path = require('node:path');
const env = require('../utils/dotenv');
env.config({ path: path.resolve(process.cwd(), '.env') });
const { MongoClient } = require('mongodb');
const { resolveMongoConfig } = require('../db/uri');

(async () => {
  const { uri, dbName } = resolveMongoConfig();
  if (!uri) {
    console.error('MONGO_URI not set');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const items = await db
      .collection('admins')
      .find({}, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    console.log(JSON.stringify({ db: dbName, count: items.length, admins: items }, null, 2));
  } catch (e) {
    console.error('Dump error:', e.message);
    process.exit(2);
  } finally {
    await client.close().catch(() => {});
  }
})();

