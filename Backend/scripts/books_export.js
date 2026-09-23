#!/usr/bin/env node
// Export books to CSV or JSON
// Usage:
//   node scripts/books_export.js ./out.csv
//   node scripts/books_export.js ./out.json

const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { resolveMongoConfig } = require('../db/uri');

function toCSVRow(values) {
  return values
    .map((v) => {
      if (v === null || v === undefined) return '';
      const s = Array.isArray(v) ? v.join('|') : String(v);
      if (s.includes('"') || s.includes(',') || /\s/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    })
    .join(',');
}

async function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error('Usage: node scripts/books_export.js <out.csv|out.json>');
    process.exit(1);
  }
  const format = path.extname(outPath).toLowerCase() === '.json' ? 'json' : 'csv';

  const { uri, dbName } = resolveMongoConfig();
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10000, family: 4 });

  const Book =
    mongoose.models.Book ||
    mongoose.model(
      'Book',
      new mongoose.Schema(
        {
          title: String,
          author: String,
          isbn: String,
          bookCode: String,
          genre: String,
          tags: [String],
          totalCopies: Number,
          availableCopies: Number,
          coverImagePath: String,
          coverImageOriginalName: String,
          coverImageMime: String,
          pdfPath: String,
          pdfOriginalName: String,
          pdfMime: String,
        },
        { timestamps: true }
      )
    );

  const docs = await Book.find({}).lean();
  if (format === 'json') {
    fs.writeFileSync(outPath, JSON.stringify(docs, null, 2));
  } else {
    const header = [
      'title',
      'author',
      'isbn',
      'bookCode',
      'genre',
      'tags',
      'totalCopies',
      'availableCopies',
      'coverImagePath',
      'coverImageOriginalName',
      'coverImageMime',
      'pdfPath',
      'pdfOriginalName',
      'pdfMime',
    ];
    const lines = [header.join(',')];
    for (const d of docs) {
      lines.push(
        toCSVRow([
          d.title || '',
          d.author || '',
          d.isbn || '',
          d.bookCode || '',
          d.genre || '',
          Array.isArray(d.tags) ? d.tags.join('|') : '',
          Number.isFinite(d.totalCopies) ? d.totalCopies : '',
          Number.isFinite(d.availableCopies) ? d.availableCopies : '',
          d.coverImagePath || '',
          d.coverImageOriginalName || '',
          d.coverImageMime || '',
          d.pdfPath || '',
          d.pdfOriginalName || '',
          d.pdfMime || '',
        ])
      );
    }
    fs.writeFileSync(outPath, lines.join('\n'));
  }
  console.log(`Exported ${docs.length} books to ${outPath}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Export failed:', err?.message || err);
  process.exit(1);
});

