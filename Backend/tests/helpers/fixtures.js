'use strict';

// Deterministic fixture set for the characterization suite.
//
// Every route that takes a path parameter needs a real id to address, and the
// auth matrix needs one principal per role the guards distinguish. Kept separate
// from scripts/seed.js: that script owns demo data and runs its own connection,
// while this one writes through the already-connected mongoose models and hands
// back the ids the tests substitute into route paths.

const mongoose = require('mongoose');

const DAY_MS = 24 * 60 * 60 * 1000;

// A one-pixel PNG and a minimal PDF, stored in GridFS so GET /api/files/:id has
// something real to stream. The two content types matter: cover images must stay
// reachable without a token (they render in <img> tags), book PDFs must not.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAA//8DAwEAAgZ2gAAAAABJRU5ErkJggg==',
  'base64'
);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');

async function storeInGridFs(filename, contentType, bytes) {
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(filename, { contentType, metadata: { mime: contentType } });
    stream.on('error', reject);
    stream.on('finish', () => resolve(stream.id));
    stream.end(bytes);
  });
}

async function seedFixtures() {
  const { User, Admin, Faculty, Book, Loan, Visit, Hours, BorrowRequest, NotificationSubscription } =
    require('../../models');

  const now = Date.now();
  const daysAgo = (days) => new Date(now - days * DAY_MS);
  const daysAhead = (days) => new Date(now + days * DAY_MS);

  // bcrypt hash of "Password123", cost 10 -- matches scripts/seed.js so the
  // login route can be characterized with a credential that actually works.
  const passwordHash = '$2b$10$vr7A1FNcgAQR/PmKzjVfMuCUWccdXVQqeA9M8I/VeEiFxLzAVtYoO';

  const [librarian, staff] = await Admin.create([
    { adminId: '03-2324-030001', email: 'librarian@test.local', fullName: 'Test Librarian', role: 'librarian', passwordHash, status: 'active' },
    { adminId: '03-2324-030002', email: 'staff@test.local', fullName: 'Test Staff', role: 'librarian_staff', passwordHash, status: 'active' }
  ]);

  const [student, disabledStudent] = await User.create([
    { studentId: '03-2324-000001', email: 'student@test.local', fullName: 'Test Student', barcode: 'LR-T00001', passwordHash, role: 'student', status: 'active', department: 'CITE' },
    { studentId: '03-2324-000002', email: 'disabled@test.local', fullName: 'Disabled Student', barcode: 'LR-T00002', passwordHash, role: 'student', status: 'disabled', department: 'CITE' }
  ]);

  const [faculty] = await Faculty.create([
    { facultyId: '04-2324-000001', email: 'faculty@test.local', fullName: 'Test Faculty', department: 'CAHS', passwordHash, status: 'active' }
  ]);

  const coverFileId = await storeInGridFs('cover.png', 'image/png', PNG_BYTES);
  const pdfFileId = await storeInGridFs('book.pdf', 'application/pdf', PDF_BYTES);

  const [bookWithFiles, plainBook] = await Book.create([
    {
      title: 'Characterized Title',
      author: 'Test Author',
      isbn: '9780000000001',
      bookCode: 'CH-0001',
      department: 'CITE',
      genre: 'Reference',
      tags: ['test'],
      totalCopies: 3,
      availableCopies: 2,
      coverImagePath: `/api/files/${coverFileId}`,
      coverImageFileId: coverFileId,
      coverImageMime: 'image/png',
      pdfPath: `/api/files/${pdfFileId}`,
      pdfFileId,
      pdfMime: 'application/pdf'
    },
    {
      title: 'Plain Title',
      author: 'Other Author',
      bookCode: 'CH-0002',
      department: 'CAHS',
      genre: 'Fiction',
      totalCopies: 2,
      availableCopies: 2
    }
  ]);

  const [activeLoan, overdueLoan] = await Loan.create([
    { userId: student._id, bookId: bookWithFiles._id, borrowedAt: daysAgo(3), dueAt: daysAhead(11) },
    { userId: student._id, bookId: plainBook._id, borrowedAt: daysAgo(20), dueAt: daysAgo(4) },
    { userId: student._id, bookId: plainBook._id, borrowedAt: daysAgo(40), dueAt: daysAgo(26), returnedAt: daysAgo(24) }
  ]);

  // Explicit, distinct createdAt values: the request lists sort on createdAt, and
  // documents created in one call otherwise share a millisecond, which makes the
  // returned order differ between runs.
  const [pendingRequest] = await BorrowRequest.create([
    { userId: student._id, bookId: plainBook._id, status: 'pending', requestType: 'borrow', daysRequested: 14, message: 'characterization fixture', createdAt: daysAgo(1) },
    { userId: student._id, bookId: bookWithFiles._id, loanId: activeLoan._id, status: 'pending', requestType: 'renewal', daysRequested: 7, createdAt: daysAgo(2) },
    { userId: student._id, bookId: plainBook._id, status: 'rejected', requestType: 'borrow', daysRequested: 30, adminNote: 'no', processedBy: librarian._id, processedAt: daysAgo(2), createdAt: daysAgo(3) }
  ]);

  await Visit.create([
    { userId: student._id, studentId: student.studentId, barcode: student.barcode, branch: 'Main', enteredAt: daysAgo(0.05), exitedAt: null }
  ]);

  await Hours.create(
    [1, 2, 3, 4, 5].map((dayOfWeek) => ({ branch: 'Main', dayOfWeek, open: '08:00', close: '17:00' }))
  );

  await NotificationSubscription.create([
    { userId: student._id, endpoint: 'https://push.test.local/characterization', keys: { p256dh: 'test-p256dh', auth: 'test-auth' }, userAgent: 'characterization' }
  ]);

  return {
    librarian,
    staff,
    student,
    disabledStudent,
    faculty,
    bookWithFiles,
    plainBook,
    activeLoan,
    overdueLoan,
    pendingRequest,
    coverFileId,
    pdfFileId,
    credentials: { studentId: student.studentId, password: 'Password123' }
  };
}

module.exports = { seedFixtures };
