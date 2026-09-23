#!/usr/bin/env node
// Validate books in the database and report potential issues.
// Usage:
//   node scripts/books_validate.js

const mongoose = require('mongoose');
const { resolveMongoConfig } = require('../db/uri');

async function main() {
  const { uri, dbName } = resolveMongoConfig();
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10000, family: 4 });

  const Book = mongoose.models.Book || mongoose.model(
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
        createdAt: Date,
      },
      { timestamps: true }
    )
  );

  const total = await Book.countDocuments();
  console.log(`Books: ${total}`);

  // Duplicates by bookCode (ignoring null/blank)
  const dupBookCode = await Book.aggregate([
    { $match: { bookCode: { $exists: true, $ne: null, $ne: '' } } },
    { $group: { _id: '$bookCode', c: { $sum: 1 } } },
    { $match: { c: { $gt: 1 } } },
    { $sort: { c: -1 } },
    { $limit: 20 },
  ]);
  if (dupBookCode.length) {
    console.warn(`Duplicate bookCode entries (showing up to 20):`);
    dupBookCode.forEach((d) => console.warn(`  ${d._id}: ${d.c}`));
  } else {
    console.log('No duplicate bookCode values found.');
  }

  // Duplicates by ISBN
  const dupIsbn = await Book.aggregate([
    { $match: { isbn: { $exists: true, $ne: null, $ne: '' } } },
    { $group: { _id: '$isbn', c: { $sum: 1 } } },
    { $match: { c: { $gt: 1 } } },
    { $sort: { c: -1 } },
    { $limit: 20 },
  ]);
  if (dupIsbn.length) {
    console.warn(`Duplicate ISBN entries (showing up to 20):`);
    dupIsbn.forEach((d) => console.warn(`  ${d._id}: ${d.c}`));
  } else {
    console.log('No duplicate ISBN values found.');
  }

  // Duplicates by Title+Author
  const dupTitleAuthor = await Book.aggregate([
    { $group: { _id: { t: '$title', a: '$author' }, c: { $sum: 1 } } },
    { $match: { c: { $gt: 1 } } },
    { $sort: { c: -1 } },
    { $limit: 20 },
  ]);
  if (dupTitleAuthor.length) {
    console.warn(`Duplicate Title+Author combos (showing up to 20):`);
    dupTitleAuthor.forEach((d) => console.warn(`  ${d._id.t} | ${d._id.a}: ${d.c}`));
  } else {
    console.log('No duplicate Title+Author combos found.');
  }

  // Missing required-looking fields
  const missing = await Book.aggregate([
    { $match: { $or: [ { title: { $in: [null, ''] } }, { author: { $in: [null, ''] } } ] } },
    { $limit: 20 },
    { $project: { title: 1, author: 1 } },
  ]);
  if (missing.length) {
    console.warn('Found books with missing title or author (first 20):');
    missing.forEach((d) => console.warn(`  ${d._id}: title=${d.title} author=${d.author}`));
  }

  // Check index presence
  const idx = await mongoose.connection.db.collection('books').indexes();
  const hasBookCodeUnique = !!idx.find((i) => i.key && i.key.bookCode === 1 && i.unique);
  const hasText = !!idx.find((i) => i.weights && i.weights.title === 1 && i.weights.author === 1);
  console.log(`Indexes: unique(bookCode)=${hasBookCodeUnique ? 'yes' : 'no'}, text(title,author)=${hasText ? 'yes' : 'no'}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Validation failed:', err?.message || err);
  process.exit(1);
});

