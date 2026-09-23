#!/usr/bin/env node
// Bulk-import Books from a CSV or JSON file into MongoDB, optionally uploading cover images
// and PDF attachments into GridFS.
//
// Usage:
//   node scripts/import_books.js ./books.csv
//   node scripts/import_books.js ./books.csv --dry-run
//   node scripts/import_books.js ./books.json
//
// CSV headers (case-insensitive):
//   title, author, isbn, bookCode, department, genre, tags, totalCopies, availableCopies,
//   coverImageFile, pdfFile, coverImageName, coverImageMime, pdfName, pdfMime
// - tags may be pipe- or comma-separated (e.g., "fiction|classic")
// - department is optional but recommended; include both for richer filtering
// - availableCopies defaults to totalCopies if omitted
// - coverImageFile / pdfFile accept absolute or relative paths (relative to the CSV file)
// - coverImageMime must be one of image/png, image/jpeg, or image/webp when provided
// - pdfMime must be application/pdf when provided
//
// Upsert rule:
// - If bookCode present: upsert by { bookCode }
// - Else if isbn present: upsert by { isbn }
// - Else: upsert by { title, author }

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { resolveMongoConfig } = require('../db/uri');

const IMAGE_MIME_ALLOW = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf'
};

function parseArgs(argv) {
  const args = { file: null, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (!args.file) args.file = a;
  }
  return args;
}

function detectFormat(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === '.json' ? 'json' : 'csv';
}

function splitCSV(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const headers = splitCSV(lines[0]).map((h) => h.toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCSV(lines[i]);
    const rec = { __row: i + 1 };
    headers.forEach((h, idx) => {
      rec[h] = vals[idx];
    });
    rows.push(rec);
  }
  return rows;
}

function normalizeMime(value) {
  if (!value) return '';
  const v = String(value).trim().toLowerCase();
  if (v === 'image/jpg') return 'image/jpeg';
  return v;
}

function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function toArrayTags(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return String(v)
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeRecord(rec, index) {
  const get = (k) =>
    rec[k] ??
    rec[k?.toLowerCase?.()] ??
    rec[k?.toUpperCase?.()];

  const title = (get('title') || '').trim();
  const author = (get('author') || '').trim();
  const isbn = (get('isbn') || '').trim();
  const bookCode = (get('bookCode') || get('bookcode') || '').trim();
  const department = (get('department') || get('dept') || '').trim();
  const genre = (get('genre') || '').trim();
  const rawTags = toArrayTags(get('tags'));
  const primaryTag = genre || department;
  const tags = rawTags.length ? rawTags : primaryTag ? [primaryTag] : [];
  const total = Number(get('totalCopies') ?? get('totalcopies'));
  const avail = Number(get('availableCopies') ?? get('availablecopies'));
  const totalCopies = Number.isFinite(total) && total >= 0 ? Math.trunc(total) : 1;
  let availableCopies = Number.isFinite(avail) && avail >= 0 ? Math.trunc(avail) : totalCopies;
  if (availableCopies > totalCopies) availableCopies = totalCopies;

  const coverFile = (get('coverImageFile') || get('coverfile') || get('cover') || '').trim();
  const coverName = (get('coverImageName') || get('covername') || '').trim();
  const coverMime = normalizeMime(get('coverImageMime') || get('covermime'));
  const pdfFile = (get('pdfFile') || get('pdffile') || get('pdf') || '').trim();
  const pdfName = (get('pdfName') || '').trim();
  const pdfMime = normalizeMime(get('pdfMime'));

  const rowNumber = Number.isFinite(rec.__row) ? rec.__row : index + 1;

  return {
    rowNumber,
    title,
    author,
    isbn,
    bookCode,
    department,
    genre: genre || '',
    tags,
    totalCopies,
    availableCopies,
    coverFile,
    coverName,
    coverMime,
    pdfFile,
    pdfName,
    pdfMime
  };
}

function resolveFilePath(baseDir, filePath) {
  if (!filePath) return '';
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

async function ensureReadableFile(absPath) {
  let stat;
  try {
    stat = await fsp.stat(absPath);
  } catch (err) {
    throw new Error(`File not found: ${absPath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Path is not a regular file: ${absPath}`);
  }
}

function guessMime(absPath, provided, fallback) {
  const normalized = normalizeMime(provided);
  if (normalized) return normalized;
  const ext = path.extname(absPath).toLowerCase();
  return MIME_BY_EXT[ext] || fallback || '';
}

async function storeFileFromDisk(bucket, absPath, options) {
  const { overrideName, overrideMime, subDir, allowedMimes, defaultMime } = options;
  await ensureReadableFile(absPath);
  const baseName = overrideName ? sanitizeFilename(overrideName) : sanitizeFilename(path.basename(absPath));
  const ext = path.extname(baseName) || path.extname(absPath);
  let mime = guessMime(absPath, overrideMime, defaultMime);
  if (!mime) mime = 'application/octet-stream';
  if (allowedMimes && allowedMimes.size && !allowedMimes.has(mime)) {
    throw new Error(`Unsupported MIME type "${mime}" for ${subDir} upload`);
  }

  const fileId = new mongoose.Types.ObjectId();
  const randomName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext || ''}`;

  await new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStreamWithId(fileId, randomName, {
      contentType: mime,
      metadata: {
        originalName: baseName || randomName,
        category: subDir,
        mime,
        uploadedAt: new Date()
      }
    });
    const readStream = fs.createReadStream(absPath);
    readStream.on('error', reject);
    uploadStream.on('error', reject);
    uploadStream.on('finish', resolve);
    readStream.pipe(uploadStream);
  });

  return {
    storedPath: `/api/files/${fileId.toString()}`,
    originalName: baseName || randomName,
    fileId,
    mime
  };
}

async function deleteStored(bucket, info) {
  if (!info) return;
  const rawId = info.fileId || info.gridFsId || info;
  if (!rawId) return;
  const id = typeof rawId === 'string' ? new mongoose.Types.ObjectId(rawId) : rawId;
  try {
    await bucket.delete(id);
  } catch (err) {
    if (!err || err.code !== 'FileNotFound') {
      console.warn(`Warning: failed to delete GridFS file ${id.toString()}: ${err?.message || err}`);
    }
  }
}

async function run() {
  const { file, dryRun } = parseArgs(process.argv);
  if (!file) {
    console.error('Usage: node scripts/import_books.js <file.csv|file.json> [--dry-run]');
    process.exit(1);
  }

  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(1);
  }
  const baseDir = path.dirname(abs);

  const fmt = detectFormat(abs);
  const text = fs.readFileSync(abs, 'utf8');
  const raw = fmt === 'json' ? JSON.parse(text) : parseCSV(text);
  if (!Array.isArray(raw) || !raw.length) {
    console.error('No rows detected in input file.');
    process.exit(1);
  }

  const normalized = raw.map((rec, idx) => normalizeRecord(rec, idx));
  const items = normalized.filter((r) => r.title && r.author);
  const skipped = normalized.length - items.length;
  if (!items.length) {
    console.error('No valid rows found. Need at least title and author per row.');
    process.exit(1);
  }

  const { uri, dbName } = resolveMongoConfig();
  await mongoose.connect(uri, { dbName, family: 4, serverSelectionTimeoutMS: 10000 });

  const Book =
    mongoose.models.Book ||
    mongoose.model(
      'Book',
      new mongoose.Schema(
        {
          title: { type: String, required: true, trim: true },
          author: { type: String, required: true, trim: true },
          isbn: { type: String, trim: true },
          bookCode: { type: String, trim: true },
          department: { type: String, trim: true },
          genre: { type: String, trim: true },
          tags: [{ type: String, trim: true }],
          totalCopies: { type: Number, default: 1, min: 0 },
          availableCopies: { type: Number, default: 1, min: 0 },
          coverImagePath: { type: String, trim: true },
          coverImageOriginalName: { type: String, trim: true },
          coverImageFileId: { type: mongoose.Schema.Types.ObjectId },
          coverImageMime: { type: String, trim: true },
          pdfPath: { type: String, trim: true },
          pdfOriginalName: { type: String, trim: true },
          pdfFileId: { type: mongoose.Schema.Types.ObjectId },
          pdfMime: { type: String, trim: true }
        },
        { timestamps: true }
      )
    );

  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });

  const stats = {
    total: items.length,
    skipped,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    coverUploaded: 0,
    pdfUploaded: 0,
    coverReplaced: 0,
    pdfReplaced: 0
  };

  for (const record of items) {
    const rowLabel = `Row ${record.rowNumber}`;
    const filter = record.bookCode
      ? { bookCode: record.bookCode }
      : record.isbn
      ? { isbn: record.isbn }
      : { title: record.title, author: record.author };

    const coverPath = record.coverFile ? resolveFilePath(baseDir, record.coverFile) : '';
    const pdfPath = record.pdfFile ? resolveFilePath(baseDir, record.pdfFile) : '';

    if (record.coverFile) {
      await ensureReadableFile(coverPath).catch((err) => {
        throw new Error(`${rowLabel}: ${err.message}`);
      });
      if (record.coverMime && !IMAGE_MIME_ALLOW.has(record.coverMime)) {
        throw new Error(
          `${rowLabel}: coverImageMime must be one of ${Array.from(IMAGE_MIME_ALLOW).join(', ')}`
        );
      }
    }
    if (record.pdfFile) {
      await ensureReadableFile(pdfPath).catch((err) => {
        throw new Error(`${rowLabel}: ${err.message}`);
      });
      if (record.pdfMime && record.pdfMime !== 'application/pdf') {
        throw new Error(`${rowLabel}: pdfMime must be "application/pdf" when provided`);
      }
    }

    const existing = await Book.findOne(filter).lean();
    if (dryRun) {
      const action = existing ? 'update' : 'insert';
      if (action === 'insert') stats.inserted++;
      else stats.updated++;
      const parts = [];
      if (record.coverFile) parts.push(`cover=${record.coverFile}`);
      if (record.pdfFile) parts.push(`pdf=${record.pdfFile}`);
      const suffix = parts.length ? ` with ${parts.join(' & ')}` : '';
      console.log(`[dry-run] ${rowLabel}: would ${action} "${record.title}"${suffix}`);
      continue;
    }

    const uploadsThisRow = [];
    const attachments = {};

    try {
      if (record.coverFile) {
        const storedCover = await storeFileFromDisk(bucket, coverPath, {
          overrideName: record.coverName,
          overrideMime: record.coverMime,
          subDir: 'covers',
          allowedMimes: IMAGE_MIME_ALLOW,
          defaultMime: 'image/png'
        });
        attachments.cover = storedCover;
        uploadsThisRow.push(storedCover);
        stats.coverUploaded++;
      }
      if (record.pdfFile) {
        const storedPdf = await storeFileFromDisk(bucket, pdfPath, {
          overrideName: record.pdfName,
          overrideMime: record.pdfMime || 'application/pdf',
          subDir: 'pdfs',
          allowedMimes: new Set(['application/pdf']),
          defaultMime: 'application/pdf'
        });
        attachments.pdf = storedPdf;
        uploadsThisRow.push(storedPdf);
        stats.pdfUploaded++;
      }

      const setOnInsert = { title: record.title, author: record.author };
      const setDoc = {
        tags: Array.isArray(record.tags) ? record.tags : [],
        totalCopies: record.totalCopies,
        availableCopies: record.availableCopies
      };
      if (record.isbn) setDoc.isbn = record.isbn;
      if (record.bookCode) setDoc.bookCode = record.bookCode;
      if (record.department) setDoc.department = record.department;
      if (record.genre) setDoc.genre = record.genre;

      if (attachments.cover) {
        setDoc.coverImagePath = attachments.cover.storedPath;
        setDoc.coverImageOriginalName = attachments.cover.originalName;
        setDoc.coverImageFileId = attachments.cover.fileId;
        setDoc.coverImageMime = attachments.cover.mime;
      }
      if (attachments.pdf) {
        setDoc.pdfPath = attachments.pdf.storedPath;
        setDoc.pdfOriginalName = attachments.pdf.originalName;
        setDoc.pdfFileId = attachments.pdf.fileId;
        setDoc.pdfMime = attachments.pdf.mime;
      }

      const updateResult = await Book.updateOne(
        filter,
        { $setOnInsert: setOnInsert, $set: setDoc },
        { upsert: true }
      );

      if (updateResult.upsertedCount) {
        stats.inserted++;
      } else if (updateResult.modifiedCount) {
        stats.updated++;
      } else {
        stats.unchanged++;
      }

      if (attachments.cover && existing && existing.coverImageFileId) {
        await deleteStored(bucket, existing.coverImageFileId);
        stats.coverReplaced++;
      }
      if (attachments.pdf && existing && existing.pdfFileId) {
        await deleteStored(bucket, existing.pdfFileId);
        stats.pdfReplaced++;
      }
    } catch (err) {
      for (const upload of uploadsThisRow) {
        await deleteStored(bucket, upload).catch(() => {});
      }
      const message = err && err.message ? err.message : String(err);
      const prefixed = message.startsWith(`${rowLabel}:`) ? message : `${rowLabel}: ${message}`;
      throw new Error(prefixed);
    }
  }

  console.log(
    `${dryRun ? 'Dry run complete.' : 'Done.'} Inserted ${stats.inserted}, updated ${
      stats.updated
    }, unchanged ${stats.unchanged}.`
  );
  if (stats.skipped) {
    console.log(`Skipped ${stats.skipped} row(s) without both title and author.`);
  }
  if (stats.coverUploaded || stats.pdfUploaded) {
    console.log(
      `Uploaded ${stats.coverUploaded} cover file(s) and ${stats.pdfUploaded} PDF file(s).`
    );
  }
  if (stats.coverReplaced || stats.pdfReplaced) {
    console.log(
      `Replaced ${stats.coverReplaced} existing cover(s) and ${stats.pdfReplaced} existing PDF(s).`
    );
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Import failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
