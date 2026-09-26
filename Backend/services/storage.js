'use strict';

// Binary storage. Book covers and PDFs live in the GridFS `uploads` bucket and
// are served by GET /api/files/:id; the on-disk UPLOAD_DIR is legacy and only
// still read so pre-GridFS files resolve and can be unlinked.
//
// The bucket cannot be created at import time -- it needs an open mongoose
// connection -- so it is published here by db/connect once the connection opens,
// and consumers await waitForUploadBucket rather than assuming it exists.

const path = require('node:path');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const mongoose = require('mongoose');

const { NO_DB, UPLOAD_DIR, MIME_EXTENSIONS } = require('../config');

let uploadBucket = null;
const uploadBucketEvents = new EventEmitter();
uploadBucketEvents.setMaxListeners(0);

function setUploadBucket(bucket) {
  if (bucket) {
    uploadBucket = bucket;
    uploadBucketEvents.emit('ready', bucket);
  } else {
    uploadBucket = null;
  }
}

function getUploadBucket() {
  return uploadBucket;
}

// Creates the GridFS bucket against the live connection and publishes it. Called
// by db/connect once the connection opens, and again on reconnect.
function initUploadBucket() {
  if (NO_DB) return;
  const db = mongoose.connection && mongoose.connection.db;
  if (!db) return;
  try {
    const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
    setUploadBucket(bucket);
  } catch (err) {
    console.error('Failed to initialize GridFS bucket:', err?.message || err);
  }
}

function waitForUploadBucket(timeoutMs = 5000) {
  if (NO_DB) {
    return Promise.reject(new Error('Database disabled (NO_DB=true)'));
  }
  if (uploadBucket) {
    return Promise.resolve(uploadBucket);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('File storage is not ready yet'));
    }, timeoutMs);

    const onReady = (bucket) => {
      cleanup();
      resolve(bucket);
    };

    function cleanup() {
      clearTimeout(timer);
      uploadBucketEvents.removeListener('ready', onReady);
    }

    uploadBucketEvents.once('ready', onReady);
  });
}

// Accepts either a bare base64 string or a data: URL, and reports the declared
// mime only when the payload actually says base64 -- a data: URL with another
// encoding is rejected rather than silently mis-decoded.
function parseBase64Payload(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:')) {
    const comma = trimmed.indexOf(',');
    if (comma === -1) return null;
    const meta = trimmed.slice(5, comma); // skip "data:"
    const [mimePart, encoding] = meta.split(';');
    if (!encoding || encoding.toLowerCase() !== 'base64') return null;
    const data = trimmed.slice(comma + 1);
    if (!data) return null;
    try {
      const buffer = Buffer.from(data, 'base64');
      return { buffer, mime: (mimePart || '').toLowerCase() };
    } catch {
      return null;
    }
  }
  try {
    const buffer = Buffer.from(trimmed, 'base64');
    return { buffer, mime: '' };
  } catch {
    return null;
  }
}

function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'file';
  return name.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function extractFileIdFromPath(path) {
  if (!path || typeof path !== 'string') return null;
  const match = path.match(/\/api\/files\/([a-f0-9]{24})/i);
  return match ? match[1] : null;
}

// Evicts the oldest upload to make room, and clears the PDF fields of whatever
// Book pointed at it so the catalogue does not keep a dangling reference.
// Requires the Book model lazily: models/index pulls in mongoose schemas, and
// requiring it at module scope would make this file's load order matter.
async function freeSpaceForUploads() {
  try {
    const { Book } = require('../models');
    const bucket =
      uploadBucket ||
      (await waitForUploadBucket(5000).catch(() => null));
    if (!bucket || !mongoose.connection?.db) return false;

    const filesCollection = mongoose.connection.db.collection('uploads.files');
    const oldest = await filesCollection.find({}).sort({ uploadDate: 1 }).limit(1).toArray();
    if (!oldest.length) return false;

    const file = oldest[0];
    await bucket.delete(file._id);

    const fileIdString = file._id.toString();
    await Book.updateMany(
      {
        $or: [
          { pdfFileId: file._id },
          { pdfPath: { $regex: fileIdString, $options: 'i' } }
        ]
      },
      {
        $unset: {
          pdfFileId: '',
          pdfPath: '',
          pdfMime: '',
          pdfOriginalName: ''
        }
      }
    );

    return true;
  } catch (err) {
    console.error('Failed to free upload space', err);
    return false;
  }
}

// Deletes a stored binary by GridFS id when there is one, and otherwise falls
// back to the legacy on-disk path. The '..' check matters: storedPath comes from
// a database document, and joining it into UPLOAD_DIR unchecked would allow an
// unlink outside that directory.
async function removeStoredFile(stored) {
  if (!stored) return;
  const entry =
    typeof stored === 'string'
      ? { storedPath: stored }
      : stored && typeof stored === 'object'
      ? stored
      : null;
  if (!entry) return;

  const fileId = entry.fileId || entry.gridFsId || entry.id;
  const bucket =
    uploadBucket ||
    (await waitForUploadBucket(5000).catch(() => null));
  if (fileId && bucket) {
    try {
      const objectId =
        typeof fileId === 'string' ? new mongoose.Types.ObjectId(fileId) : fileId;
      await bucket.delete(objectId);
      return;
    } catch (err) {
      if (!err || err.code !== 'FileNotFound') {
        console.warn('Failed to delete GridFS file:', err?.message || err);
      }
    }
  }

  const storedPath = entry.storedPath;
  if (!storedPath) return;
  const prefix = '/uploads/';
  let relative = storedPath;
  if (storedPath.startsWith(prefix)) {
    relative = storedPath.slice(prefix.length);
  }
  relative = relative.replace(/^\/+/, '');
  if (!relative || relative.includes('..')) return;
  const target = path.join(UPLOAD_DIR, relative);
  try {
    await fsp.unlink(target);
  } catch {}
}

async function storeBase64File({
  base64,
  originalName,
  allowedMime = [],
  maxBytes = 5 * 1024 * 1024,
  subDir = ''
}) {
  const parsed = parseBase64Payload(base64);
  if (!parsed) throw new Error('Invalid file data provided');
  const { buffer } = parsed;
  const bucket =
    uploadBucket ||
    (await waitForUploadBucket(5000).catch(() => null));
  if (!bucket) {
    throw new Error('File storage is not ready. Please try again shortly.');
  }
  const mime = (parsed.mime || '').toLowerCase();
  const normalizedAllowed = allowedMime.map((m) => m.toLowerCase());
  if (maxBytes && buffer.length > maxBytes) {
    throw new Error(`File is too large. Max size is ${Math.round(maxBytes / (1024 * 1024))}MB`);
  }
  if (normalizedAllowed.length) {
    if (mime) {
      if (!normalizedAllowed.includes(mime)) {
        throw new Error('Unsupported file type');
      }
    } else {
      const fromName = originalName ? path.extname(originalName).toLowerCase() : '';
      const fallbackMime = fromName === '.pdf' ? 'application/pdf' : '';
      if (fallbackMime && !normalizedAllowed.includes(fallbackMime)) {
        throw new Error('Unsupported file type');
      }
    }
  }

  let ext = '';
  if (originalName) {
    ext = path.extname(originalName).toLowerCase();
  }
  if (!ext && mime && MIME_EXTENSIONS[mime]) {
    ext = MIME_EXTENSIONS[mime];
  }
  if (!ext && normalizedAllowed.includes('application/pdf')) {
    ext = '.pdf';
  }
  if (!ext && mime.startsWith('image/')) {
    ext = '.png';
  }

  const safeName = sanitizeFilename(originalName || 'file');
  const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext || ''}`;

  const contentType =
    mime ||
    (ext === '.pdf'
      ? 'application/pdf'
      : ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : '');

  const fileId = new mongoose.Types.ObjectId();
  await new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStreamWithId(fileId, fileName, {
      contentType: contentType || undefined,
      metadata: {
        originalName: safeName || fileName,
        category: subDir ? sanitizeFilename(subDir) : undefined,
        mime: contentType || mime || 'application/octet-stream',
        uploadedAt: new Date()
      }
    });
    uploadStream.on('error', reject);
    uploadStream.on('finish', resolve);
    uploadStream.end(buffer);
  });

  return {
    storedPath: `/api/files/${fileId.toString()}`,
    originalName: safeName || fileName,
    fileId,
    mime: contentType || mime || 'application/octet-stream'
  };
}

module.exports = {
  setUploadBucket,
  getUploadBucket,
  initUploadBucket,
  waitForUploadBucket,
  parseBase64Payload,
  sanitizeFilename,
  extractFileIdFromPath,
  freeSpaceForUploads,
  removeStoredFile,
  storeBase64File
};
