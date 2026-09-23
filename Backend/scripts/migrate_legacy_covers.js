#!/usr/bin/env node
// Migrate legacy cover image paths like "book_images/..." into GridFS and update Book documents.
//
// Usage:
//   node scripts/migrate_legacy_covers.js --dir ./path/to/legacy/assets [--dry-run]
//
// Looks for each Book with coverImagePath that starts with "book_images" or 
// "/book_images" (and similar legacy prefixes). It will try the following to locate the file:
//   1) Join --dir with the legacy relative path (stripping any leading slash)
//   2) If not found, join --dir with just the basename of the file and search recursively
//
// When found, the image is uploaded to Mongo GridFS (bucket "uploads"), and the Book
// document is updated: coverImagePath, coverImageOriginalName, coverImageFileId, coverImageMime.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { resolveMongoConfig } = require('../db/uri');

function parseArgs(argv) {
  const out = { dir: process.env.MIGRATION_ASSETS_DIR || '', dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--dir') out.dir = argv[++i] || out.dir;
    else if (!out.dir) out.dir = a; // allow positional
  }
  return out;
}

async function fileExists(p) {
  try { await fsp.access(p, fs.constants.R_OK); return true; } catch { return false; }
}

async function* walk(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function guessMimeByExt(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

async function uploadToGridFS(bucket, absPath) {
  const fileId = new mongoose.Types.ObjectId();
  const baseName = sanitizeFilename(path.basename(absPath));
  const ext = path.extname(baseName);
  const randomName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const mime = guessMimeByExt(absPath);

  await new Promise((resolve, reject) => {
    const read = fs.createReadStream(absPath);
    const up = bucket.openUploadStreamWithId(fileId, randomName, {
      contentType: mime,
      metadata: { originalName: baseName, category: 'covers', mime, uploadedAt: new Date() }
    });
    read.on('error', reject);
    up.on('error', reject);
    up.on('finish', resolve);
    read.pipe(up);
  });

  return { storedPath: `/api/files/${fileId.toString()}`, originalName: baseName, fileId, mime };
}

async function findCandidate(baseDir, legacyPath) {
  const rel = String(legacyPath || '').replace(/^\/+/, '');
  if (!rel) return null;
  const direct = path.join(baseDir, rel);
  if (await fileExists(direct)) return direct;
  const base = path.basename(rel);
  const alt = path.join(baseDir, base);
  if (await fileExists(alt)) return alt;
  // fallback: walk for basename
  for await (const p of walk(baseDir)) {
    if (path.basename(p) === base) return p;
  }
  return null;
}

async function run() {
  const args = parseArgs(process.argv);
  if (!args.dir) {
    console.error('Provide --dir <path> where legacy files live or set MIGRATION_ASSETS_DIR');
    process.exit(2);
  }
  const baseDir = path.resolve(args.dir);
  if (!(await fileExists(baseDir))) {
    console.error(`Directory not readable: ${baseDir}`);
    process.exit(2);
  }

  const { uri, dbName } = resolveMongoConfig();
  await mongoose.connect(uri, { dbName });

  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  const Book = require('../models/Book');

  // Select any doc whose coverImagePath is present but not already an API URL
  // and not an absolute http(s) or data URI. This covers many legacy formats
  // including book_images/... and plain relative filenames.
  const candidates = await Book.find({
    coverImagePath: { $exists: true, $ne: '' },
    $and: [
      { coverImagePath: { $not: /^\s*\/api\/files\//i } },
      { coverImagePath: { $not: /^\s*(?:https?:)?\/\//i } },
      { coverImagePath: { $not: /^\s*data:/i } }
    ]
  }).lean();
  console.log(`Found ${candidates.length} book(s) with legacy cover paths`);

  let migrated = 0, missing = 0, skipped = 0;

  for (const b of candidates) {
    const legacyRaw = String(b.coverImagePath || '').trim();
    const legacy = legacyRaw.replace(/^\/+/, '');
    const abs = await findCandidate(baseDir, legacy);
    if (!abs) {
      missing++;
      console.warn(`Missing file for book "${b.title}" (${b._id}): ${legacy}`);
      continue;
    }
    if (args.dryRun) {
      console.log(`[dry-run] Would migrate cover for "${b.title}" from ${abs}`);
      migrated++;
      continue;
    }
    const stored = await uploadToGridFS(bucket, abs);
    await mongoose.connection.db.collection('books').updateOne(
      { _id: b._id },
      {
        $set: {
          coverImagePath: stored.storedPath,
          coverImageOriginalName: stored.originalName,
          coverImageFileId: stored.fileId,
          coverImageMime: stored.mime
        }
      }
    );
    migrated++;
  }

  console.log(`Done. Migrated: ${migrated}, missing: ${missing}, skipped: ${skipped}.`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Migration failed:', err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
