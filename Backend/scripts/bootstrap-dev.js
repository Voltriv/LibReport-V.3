// Run once before dev server: if no books exist, import the sample CSV
// Safe to run multiple times — it checks a marker doc and collection count.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const env = require('../utils/dotenv');
env.config({ path: path.join(__dirname, '..', '.env') });
env.config({ path: path.join(__dirname, '..', '..', '.env'), override: false });

async function main() {
  try {
    const useMem = String(process.env.USE_MEMORY_DB || '').toLowerCase() === 'true';
    if (useMem) {
      console.log('[bootstrap] USE_MEMORY_DB=true; skipping CSV import.');
      return;
    }
    const { resolveMongoConfig } = require('../db/uri');
    const { MongoClient } = require('mongodb');
    const { uri, dbName } = resolveMongoConfig();
    if (!uri) {
      console.warn('[bootstrap] No MONGO_URI configured; skipping CSV import.');
      return;
    }
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const db = client.db(dbName);

    // Skip if already imported or books exist
    const meta = await db.collection('appmeta').findOne({ _id: 'dev:bootstrap' });
    const booksCount = await db.collection('books').estimatedDocumentCount().catch(() => 0);
    if ((meta && meta.imported) || booksCount > 0) {
      console.log(`[bootstrap] Skip import (imported=${!!(meta && meta.imported)}, books=${booksCount}).`);
      await client.close();
      return;
    }

    // Import the bundled template CSV (with assets)
    const importer = path.join(__dirname, 'import_books.js');
    const csv = path.join(__dirname, '..', 'data', 'books.template.csv');
    console.log('[bootstrap] Importing sample catalog from', csv);
    try {
      execFileSync(process.execPath, [importer, csv], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
      await db.collection('appmeta').updateOne(
        { _id: 'dev:bootstrap' },
        { $set: { imported: true, at: new Date(), source: 'data/books.template.csv' } },
        { upsert: true }
      );
    } catch (err) {
      console.warn('[bootstrap] Import failed:', err?.message || String(err));
      // continue; server can still start
    } finally {
      await client.close().catch(() => {});
    }
  } catch (e) {
    console.warn('[bootstrap] Unexpected error:', e?.message || String(e));
  }
}

main();

