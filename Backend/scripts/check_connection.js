// Quick Atlas/local Mongo connectivity check.
// Prints DB/cluster info and collection counts for key collections.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), override: false });

const { MongoClient } = require('mongodb');
const { resolveMongoConfig } = require('../db/uri');

(async () => {
  const { uri, dbName } = resolveMongoConfig();
  if (!uri) {
    console.error('No MONGO_URI configured. Set Backend/.env MONGO_URI.');
    process.exit(1);
  }
  const redacted = uri.replace(/:\\?([^:@/?#]+)@/, ':****@');
  console.log('Connecting to:', redacted);
  console.log('DB Name:', dbName);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const admin = client.db(dbName).admin();
    const ping = await admin.ping();
    console.log('Ping:', ping);
    const serverInfo = await admin.serverInfo().catch(() => null);
    if (serverInfo) {
      console.log('MongoDB version:', serverInfo.version);
    }

    const db = client.db(dbName);
    const names = (await db.listCollections().toArray()).map(c => c.name).sort();
    console.log('Collections:', names.join(', ') || '(none)');

    const targets = ['users', 'faculty', 'admins', 'books', 'loans', 'visits', 'uploads.files', 'uploads.chunks'];
    for (const col of targets) {
      try {
        const count = await db.collection(col).estimatedDocumentCount();
        console.log(`${col}: ${count}`);
      } catch {
        // ignore missing collections
      }
    }
    console.log('Connection OK');
  } catch (e) {
    console.error('Connection failed:', e.message);
    // The three Atlas failure modes look alike in the raw driver message; name them.
    if (/bad auth|authentication failed/i.test(e.message)) {
      console.error('Hint: the cluster answered, so DNS and the IP access list are fine.');
      console.error('      MONGO_URI in Backend/.env has a stale or wrong password for this DB user.');
      console.error('      Reset it in Atlas > Database Access, then update MONGO_URI (percent-encode any @ : / ? # % chars).');
    } else if (/ServerSelection|ETIMEDOUT|ECONNREFUSED/i.test(e.message)) {
      console.error('Hint: never reached the cluster. Check the Atlas IP access list for this host, or that the cluster is not paused.');
    } else if (/ENOTFOUND|querySrv/i.test(e.message)) {
      console.error('Hint: the SRV record did not resolve. Check the cluster hostname in MONGO_URI.');
    }
    process.exit(2);
  } finally {
    await client.close().catch(() => {});
  }
})();

