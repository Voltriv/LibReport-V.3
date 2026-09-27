// backend/scripts/reconcile-copies.js
//
// Repairs Book.availableCopies against the loans that actually exist.
//
// Why this is needed rather than just fixing the code: the return and delete paths
// used to read a loan, save it, then increment availableCopies unconditionally
// (findings N1 and N2). Two concurrent returns both passed the in-memory check and
// both incremented. The decrement path was already atomic and guarded by
// availableCopies > 0, so the error was one-directional -- counts only ever
// INFLATE. A book can therefore show copies available when every physical copy is
// out on loan, and nothing in the app has ever corrected it.
//
// The handlers are fixed now, so this is a one-off repair (and a useful periodic
// audit). It reports by default and only writes with --apply.
//
//   node scripts/reconcile-copies.js            # report drift, change nothing
//   node scripts/reconcile-copies.js --apply    # write the corrected counts
//
// Truth is defined as: availableCopies = totalCopies - (active loans for that book),
// clamped to [0, totalCopies]. An active loan is one with returnedAt: null.

const path = require('node:path');
const env = require('../utils/dotenv');
env.config({ path: path.resolve(process.cwd(), '.env') });
env.config({ path: path.resolve(process.cwd(), '..', '.env'), override: false });

const mongoose = require('mongoose');

const { resolveMongoConfig } = require('../db/uri');

const APPLY = process.argv.includes('--apply');

async function main() {
  const { uri, dbName } = resolveMongoConfig();
  if (!uri) {
    throw new Error('Missing MONGO_URI (or MONGODB_URI) in environment');
  }

  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10000, family: 4 });
  const { Book, Loan } = require('../models');

  const books = await Book.find({}, { title: 1, totalCopies: 1, availableCopies: 1 }).lean();

  // One grouped count rather than a query per book: this runs against production
  // data and a per-book round trip would be thousands of queries.
  const activeByBook = new Map();
  const grouped = await Loan.aggregate([
    { $match: { returnedAt: null } },
    { $group: { _id: '$bookId', active: { $sum: 1 } } }
  ]);
  for (const row of grouped) {
    if (row._id) activeByBook.set(String(row._id), row.active);
  }

  const drifted = [];
  for (const book of books) {
    const total = Number.isFinite(book.totalCopies) ? book.totalCopies : 0;
    const active = activeByBook.get(String(book._id)) || 0;
    const current = Number.isFinite(book.availableCopies) ? book.availableCopies : 0;

    let expected = total - active;
    if (expected < 0) expected = 0;
    if (expected > total) expected = total;

    if (current !== expected) {
      drifted.push({ book, current, expected, total, active });
    }
  }

  console.log(`Scanned ${books.length} books, ${grouped.length} with active loans.`);

  if (!drifted.length) {
    console.log('No drift: every availableCopies matches totalCopies - activeLoans.');
    return;
  }

  console.log(`\nDrift found in ${drifted.length} book(s):\n`);
  for (const { book, current, expected, total, active } of drifted) {
    const direction = current > expected ? 'INFLATED' : 'understated';
    console.log(
      `  ${String(book._id)}  ${direction.padEnd(11)} have=${current} want=${expected} `
        + `(total=${total}, active=${active})  ${book.title || '(untitled)'}`
    );
  }

  // Inflation is the signature of N1/N2. Understatement points at something else
  // -- a decrement that was never given back, or an edited totalCopies -- so it is
  // called out separately rather than silently lumped in.
  const inflated = drifted.filter((d) => d.current > d.expected).length;
  const understated = drifted.length - inflated;
  console.log(
    `\n${inflated} inflated (the signature of the return/delete race), ${understated} understated.`
  );

  if (!APPLY) {
    console.log('\nReport only. Re-run with --apply to write these corrections.');
    return;
  }

  let written = 0;
  for (const { book, expected } of drifted) {
    await Book.updateOne({ _id: book._id }, { $set: { availableCopies: expected } });
    written += 1;
  }
  console.log(`\nApplied: ${written} book(s) corrected.`);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('reconcile-copies failed:', err?.message || err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
