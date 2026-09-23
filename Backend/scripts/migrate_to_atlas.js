// Migrate/copy data from a source MongoDB (e.g., local Docker)
// to the target MongoDB (e.g., Atlas) using two connections.
// Safe by default: upserts by _id; optional --drop-target to replace.

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), override: false });

const { MongoClient } = require('mongodb');
const { spawnSync } = require('node:child_process');
const { resolveMongoConfig } = require('../db/uri');

function parseArgs(argv) {
  const out = { batch: 1000, dropTarget: false, collections: null, from: 'local', to: 'env', dryRun: false, autoDocker: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const val = argv[i + 1];
    if (a === '--source-uri') { out.sourceUri = val; i++; }
    else if (a === '--source-db') { out.sourceDb = val; i++; }
    else if (a === '--target-uri') { out.targetUri = val; i++; }
    else if (a === '--target-db') { out.targetDb = val; i++; }
    else if (a === '--batch') { out.batch = Math.max(1, parseInt(val, 10) || 1000); i++; }
    else if (a === '--drop-target') { out.dropTarget = true; }
    else if (a === '--collections') { out.collections = val.split(',').map(s => s.trim()).filter(Boolean); i++; }
    else if (a === '--from') { out.from = val; i++; }
    else if (a === '--to') { out.to = val; i++; }
    else if (a === '--dry-run') { out.dryRun = true; }
    else if (a === '--no-auto-docker') { out.autoDocker = false; }
  }
  return out;
}

function redact(uri) { return uri ? uri.replace(/:\\?([^:@/?#]+)@/, ':****@') : uri; }

async function ensureIndexes(db) {
  try {
    await db.collection('uploads.files').createIndex({ filename: 1, uploadDate: 1 });
    await db.collection('uploads.chunks').createIndex({ files_id: 1, n: 1 }, { unique: true });
  } catch {}
}

async function main() {
  const args = parseArgs(process.argv);

  // Resolve URIs and DB names
  let sourceUri = args.sourceUri;
  let sourceDb = args.sourceDb;
  if (!sourceUri) {
    if (args.from === 'local') {
      // Prefer 127.0.0.1 to avoid IPv6/::1 resolution issues on some systems
      sourceUri = `mongodb://${encodeURIComponent('libreport')}:${encodeURIComponent('libreport')}@127.0.0.1:27017/libreport?authSource=admin`;
      sourceDb = sourceDb || 'libreport';
    } else if (args.from === 'env') {
      const { uri, dbName } = resolveMongoConfig();
      sourceUri = uri; sourceDb = sourceDb || dbName;
    }
  }
  let targetUri = args.targetUri;
  let targetDb = args.targetDb;
  if (!targetUri) {
    if (args.to === 'env') {
      const { uri, dbName } = resolveMongoConfig();
      targetUri = uri; targetDb = targetDb || dbName;
    } else if (args.to === 'local') {
      // Prefer 127.0.0.1 to avoid IPv6/::1 resolution issues on some systems
      targetUri = `mongodb://${encodeURIComponent('libreport')}:${encodeURIComponent('libreport')}@127.0.0.1:27017/libreport?authSource=admin`;
      targetDb = targetDb || 'libreport';
    }
  }

  if (!sourceUri || !targetUri) {
    console.error('Missing connection URIs. Use --source-uri/--source-db and --target-uri/--target-db, or --from/--to.');
    process.exit(1);
  }

  if (!sourceDb) { const { dbName } = resolveMongoConfig(); sourceDb = dbName; }
  if (!targetDb) { const { dbName } = resolveMongoConfig(); targetDb = dbName; }

  if (redact(sourceUri) === redact(targetUri) && sourceDb === targetDb) {
    console.error('Source and target appear to be the same. Aborting.');
    process.exit(1);
  }

  console.log('Source:', redact(sourceUri), 'DB:', sourceDb);
  console.log('Target:', redact(targetUri), 'DB:', targetDb);
  if (args.dryRun) console.log('Dry run: no data will be written.');

  // If source looks local and not reachable, optionally try to auto-start Docker
  if (args.from === 'local' && args.autoDocker) {
    const probeClient = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 2000 });
    let needsStart = false;
    try {
      await probeClient.connect();
      await probeClient.db(sourceDb).command({ ping: 1 });
    } catch (e) {
      if ((e && e.message && /ECONNREFUSED/i.test(e.message)) || (e && e.code === 'ECONNREFUSED')) {
        needsStart = true;
      }
    } finally {
      await probeClient.close().catch(() => {});
    }
    if (needsStart) {
      console.log('Local Mongo appears down. Attempting to start Docker service "mongo"...');
      const rootCwd = path.join(__dirname, '..', '..');
      let started = false;
      for (const cmd of [['docker','compose','up','-d','mongo'], ['docker-compose','up','-d','mongo']]) {
        const res = spawnSync(cmd[0], cmd.slice(1), { cwd: rootCwd, stdio: 'inherit' });
        if (res && res.status === 0) { started = true; break; }
      }
      if (!started) {
        console.warn('Could not start Docker automatically. Ensure Docker is running and try again.');
      } else {
        // Wait for Mongo to accept connections
        const maxWaitMs = 30000;
        const start = Date.now();
        let ok = false;
        while (Date.now() - start < maxWaitMs) {
          const probe2 = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 2000 });
          try {
            await probe2.connect();
            await probe2.db(sourceDb).command({ ping: 1 });
            ok = true;
            await probe2.close();
            break;
          } catch {
            await new Promise(r => setTimeout(r, 1500));
          } finally {
            await probe2.close().catch(() => {});
          }
        }
        if (!ok) console.warn('Mongo did not become ready in time; migration may fail.');
      }
    }
  }

  const sourceClient = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 8000 });
  const targetClient = new MongoClient(targetUri, { serverSelectionTimeoutMS: 8000 });

  try {
    await sourceClient.connect();
    await targetClient.connect();
    const sdb = sourceClient.db(sourceDb);
    const tdb = targetClient.db(targetDb);

    const collectionsToCopy = [];
    const listed = await sdb.listCollections().toArray();
    for (const c of listed) {
      const name = c.name;
      if (name.startsWith('system.')) continue;
      collectionsToCopy.push(name);
    }
    collectionsToCopy.sort();

    const selected = args.collections ? collectionsToCopy.filter(n => args.collections.includes(n)) : collectionsToCopy;
    if (selected.length === 0) {
      console.log('No collections to copy.');
      return;
    }

    if (!args.dryRun) {
      await ensureIndexes(tdb);
    }

    for (const col of selected) {
      const sCol = sdb.collection(col);
      const tCol = tdb.collection(col);
      const estimated = await sCol.estimatedDocumentCount().catch(() => 0);
      console.log(`\n[${col}] copying ~${estimated} docs`);

      if (args.dropTarget && !args.dryRun) {
        try { await tCol.drop(); console.log(`[${col}] dropped target`); } catch {}
      }

      if (args.dryRun) { console.log(`[${col}] dry-run skip write`); continue; }

      const cursor = sCol.find({}, { noCursorTimeout: true }).batchSize(args.batch);
      let batch = [];
      let total = 0;
      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        batch.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
        if (batch.length >= args.batch) {
          await tCol.bulkWrite(batch, { ordered: false }).catch(e => {
            console.warn(`[${col}] bulkWrite warning:`, e.message);
          });
          total += batch.length;
          process.stdout.write(`\r[${col}] ${total}/${estimated || '?'}...`);
          batch = [];
        }
      }
      if (batch.length) {
        await tCol.bulkWrite(batch, { ordered: false }).catch(e => {
          console.warn(`[${col}] bulkWrite warning:`, e.message);
        });
        total += batch.length;
        process.stdout.write(`\r[${col}] ${total}/${estimated || '?'}...`);
      }
      process.stdout.write(`\r`);
      console.log(`[${col}] done (${total} docs)`);
    }

    console.log('\nMigration complete. Consider creating indexes on target:');
    console.log('  npm --prefix Backend run db:indexes');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(2);
  } finally {
    await sourceClient.close().catch(() => {});
    await targetClient.close().catch(() => {});
  }
}

main();

