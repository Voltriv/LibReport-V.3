// backend/scripts/seed.js
const path = require('node:path');
const env = require('../utils/dotenv');
env.config({ path: path.resolve(process.cwd(), '.env') });
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoConfig } = require('../db/uri');

const MEMORY_SERVER_VERSION =
  process.env.MONGO_MEMORY_SERVER_VERSION ||
  process.env.MONGO_MEMORY_VERSION ||
  '7.0.14';
const MEMORY_SERVER_DOWNLOAD_DIR = process.env.MONGO_MEMORY_DOWNLOAD_DIR || process.env.MONGOMS_DOWNLOAD_DIR;
const MEMORY_SERVER_SYSTEM_BINARY =
  process.env.MONGO_MEMORY_SYSTEM_BINARY ||
  process.env.MONGOMS_SYSTEM_BINARY;
const MEMORY_SERVER_OS = (() => {
  const dist =
    process.env.MONGO_MEMORY_OS_DIST ||
    process.env.MONGO_MEMORY_OS ||
    process.env.MONGOMS_OS_DIST ||
    process.env.MONGOMS_OS ||
    '';
  const release =
    process.env.MONGO_MEMORY_OS_RELEASE ||
    process.env.MONGO_MEMORY_OS_VERSION ||
    process.env.MONGOMS_OS_RELEASE ||
    process.env.MONGOMS_OS_VERSION ||
    process.env.MONGO_MEMORY_OS_FALLBACK_RELEASE ||
    '';
  if (dist || release) {
    return {
      dist: (dist || 'ubuntu').toLowerCase(),
      release: release || '20.04'
    };
  }
  return undefined;
})();
const MEMORY_SERVER_SKIP_MD5 = String(
  process.env.MONGO_MEMORY_SKIP_MD5 ||
    process.env.MONGOMS_SKIP_MD5 ||
    process.env.MONGO_MEMORY_DISABLE_MD5 ||
    ''
)
  .toLowerCase()
  .trim() === 'true';

function buildMemoryServerOptions() {
  const binary = { version: MEMORY_SERVER_VERSION };
  if (MEMORY_SERVER_DOWNLOAD_DIR) binary.downloadDir = MEMORY_SERVER_DOWNLOAD_DIR;
  if (MEMORY_SERVER_SYSTEM_BINARY) binary.systemBinary = MEMORY_SERVER_SYSTEM_BINARY;
  if (MEMORY_SERVER_OS) binary.os = MEMORY_SERVER_OS;
  if (MEMORY_SERVER_SKIP_MD5) {
    binary.skipMD5 = true;
    binary.checkMD5 = false;
  }
  return { binary };
}
let { uri, dbName } = resolveMongoConfig();
const USE_MEMORY_DB = String(process.env.USE_MEMORY_DB || '').toLowerCase() === 'true';
let mem;
let client;

async function ensureIndexes(db) {
  const safeCreate = async (collection, indexes) => {
    try {
      await db.collection(collection).createIndexes(indexes);
    } catch (err) {
      if (!(err && (err.code === 85 || err.codeName === 'IndexOptionsConflict'))) {
        throw err;
      }
    }
  };

  await safeCreate('books', [
    { key: { title: 'text', author: 'text' }, name: 'books_text' }
  ]);
  await safeCreate('loans', [
    { key: { userId: 1, returnedAt: 1 }, name: 'loans_user_returned' },
    { key: { dueAt: 1 }, name: 'loans_due' },
    { key: { bookId: 1 }, name: 'loans_book' }
  ]);
  await safeCreate('users', [
    { key: { role: 1, name: 1 }, name: 'users_role_name' }
  ]);
  await safeCreate('hours', [
    { key: { branch: 1, dayOfWeek: 1 }, name: 'hours_branch_dow', unique: true }
  ]);
}

function upsertsFromArray(arr, key = '_id') {
  return arr.map(doc => ({
    updateOne: { filter: { [key]: doc[key] }, update: { $set: doc }, upsert: true }
  }));
}

// New seed routine using ObjectId and adding visits
async function main() {
  if (USE_MEMORY_DB) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mem = await MongoMemoryServer.create(buildMemoryServerOptions());
    uri = mem.getUri();
  }
  if (!uri) throw new Error('MONGO_URI not set');
  client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // Clean collections for a predictable demo
  for (const name of ['users','books','loans','visits','hours','faculty','borrowrequests','notificationsubscriptions']) {
    await db.collection(name).deleteMany({});
  }

  // bcrypt hash for "Password123" (cost 10)
  const demoHash = '$2b$10$vr7A1FNcgAQR/PmKzjVfMuCUWccdXVQqeA9M8I/VeEiFxLzAVtYoO';
  const adminUser = { _id: new ObjectId(), adminId: '03-2324-032224', fullName: 'Librarian', role: 'librarian', email: 'admin@example.com', passwordHash: demoHash };
  await db.collection('admins').updateOne(
    { adminId: adminUser.adminId },
    {
      $set: {
        adminId: adminUser.adminId,
        fullName: adminUser.fullName,
        email: adminUser.email,
        role: adminUser.role,
        passwordHash: adminUser.passwordHash
      },
      $setOnInsert: { _id: adminUser._id }
    },
    { upsert: true, bypassDocumentValidation: true }
  );

  // A second admin at the lower privilege level, so the adminRequired vs
  // elevatedAdminRequired boundary has something to test against. Upserted
  // rather than wiped, matching the admin above -- admins may be real.
  const staffAdmin = { _id: new ObjectId(), adminId: '03-2324-032225', fullName: 'Desk Staff', role: 'librarian_staff', email: 'staff@example.com', passwordHash: demoHash };
  await db.collection('admins').updateOne(
    { adminId: staffAdmin.adminId },
    {
      $set: {
        adminId: staffAdmin.adminId,
        fullName: staffAdmin.fullName,
        email: staffAdmin.email,
        role: staffAdmin.role,
        passwordHash: staffAdmin.passwordHash,
        status: 'active'
      },
      $setOnInsert: { _id: staffAdmin._id }
    },
    { upsert: true, bypassDocumentValidation: true }
  );

  const bookDocs = [
    {
      _id: new ObjectId(),
      title: 'Clean Code',
      author: 'Robert C. Martin',
      isbn: '9780132350884',
      bookCode: 'BK-0001',
      department: 'CITE',
      genre: 'Software Engineering',
      tags: ['CITE', 'Software Engineering'],
      totalCopies: 3,
      availableCopies: 2
    },
    {
      _id: new ObjectId(),
      title: 'The Design of Everyday Things',
      author: 'Don Norman',
      isbn: '9780465050659',
      bookCode: 'BK-0002',
      department: 'CAHS',
      genre: 'Design',
      tags: ['CAHS', 'Design'],
      totalCopies: 2,
      availableCopies: 1
    },
    {
      _id: new ObjectId(),
      title: 'Introduction to Algorithms',
      author: 'Cormen et al.',
      isbn: '9780262046305',
      bookCode: 'BK-0003',
      department: 'CEA',
      genre: 'Computer Science',
      tags: ['CEA', 'Computer Science'],
      totalCopies: 5,
      availableCopies: 5
    }
  ];
  await db.collection('books').insertMany(bookDocs, { ordered: false, bypassDocumentValidation: true });

  const now = new Date();
  const userDocs = [
    {
      _id: new ObjectId(),
      studentId: '03-2324-00101',
      email: 'alice.villanueva@example.com',
      fullName: 'Alice Villanueva',
      barcode: 'LR-000101',
      passwordHash: demoHash,
      role: 'student',
      status: 'active',
      department: 'CAHS'
    },
    {
      _id: new ObjectId(),
      studentId: '03-2324-00102',
      email: 'ben.santos@example.com',
      fullName: 'Ben Santos',
      barcode: 'LR-000102',
      passwordHash: demoHash,
      role: 'student',
      status: 'active',
      department: 'CITE'
    },
    {
      _id: new ObjectId(),
      studentId: '03-2324-00103',
      email: 'cara.delacruz@example.com',
      fullName: 'Cara Dela Cruz',
      barcode: 'LR-000103',
      passwordHash: demoHash,
      role: 'faculty',
      status: 'active'
    },
    {
      // Disabled on purpose: accountIsDisabled is checked on every
      // authenticated request and had no fixture to exercise it.
      _id: new ObjectId(),
      studentId: '03-2324-00104',
      email: 'dana.reyes@example.com',
      fullName: 'Dana Reyes',
      barcode: 'LR-000104',
      passwordHash: demoHash,
      role: 'student',
      status: 'disabled',
      department: 'CITE'
    }
  ];
  await db.collection('users').insertMany(userDocs, { ordered: false, bypassDocumentValidation: true });

  // The faculty collection was wiped every run but never repopulated, so the
  // three /api/faculty routes always seeded to empty.
  const facultyDocs = [
    {
      _id: new ObjectId(),
      facultyId: '04-2324-000001',
      email: 'elena.marquez@example.com',
      fullName: 'Elena Marquez',
      department: 'CAHS',
      passwordHash: demoHash,
      status: 'active'
    },
    {
      _id: new ObjectId(),
      facultyId: '04-2324-000002',
      fullName: 'Noel Aguilar',
      department: 'CITE',
      passwordHash: demoHash,
      status: 'disabled'
    }
  ];
  await db.collection('faculty').insertMany(facultyDocs, { ordered: false, bypassDocumentValidation: true });

  const loanDocs = [
    {
      _id: new ObjectId(),
      userId: userDocs[0]._id,
      bookId: bookDocs[0]._id,
      borrowedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      dueAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      returnedAt: null
    },
    {
      _id: new ObjectId(),
      userId: userDocs[1]._id,
      bookId: bookDocs[1]._id,
      borrowedAt: new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000),
      dueAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      returnedAt: null
    },
    {
      _id: new ObjectId(),
      userId: userDocs[2]._id,
      bookId: bookDocs[2]._id,
      borrowedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      dueAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      returnedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
    }
  ];
  await db.collection('loans').insertMany(loanDocs, { ordered: false, bypassDocumentValidation: true });

  // Adjust available copies for active loans
  const activeByBook = loanDocs.reduce((acc, loan) => {
    if (!loan.returnedAt) acc.set(String(loan.bookId), (acc.get(String(loan.bookId)) || 0) + 1);
    return acc;
  }, new Map());
  for (const book of bookDocs) {
    const activeCount = activeByBook.get(String(book._id)) || 0;
    await db.collection('books').updateOne({ _id: book._id }, { $set: { availableCopies: Math.max(0, book.totalCopies - activeCount) } });
  }

  const visitDocs = [
    {
      _id: new ObjectId(),
      userId: userDocs[0]._id,
      studentId: userDocs[0].studentId,
      barcode: userDocs[0].barcode,
      branch: 'Main',
      enteredAt: new Date(now.getTime() - 90 * 60 * 1000),
      exitedAt: new Date(now.getTime() - 45 * 60 * 1000)
    },
    {
      _id: new ObjectId(),
      userId: userDocs[1]._id,
      studentId: userDocs[1].studentId,
      barcode: userDocs[1].barcode,
      branch: 'Main',
      enteredAt: new Date(now.getTime() - 30 * 60 * 1000),
      exitedAt: null
    },
    {
      _id: new ObjectId(),
      userId: userDocs[2]._id,
      studentId: userDocs[2].studentId,
      barcode: userDocs[2].barcode,
      branch: 'Downtown',
      enteredAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      exitedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000)
    }
  ];
  await db.collection('visits').insertMany(visitDocs, { ordered: false, bypassDocumentValidation: true });

  // Borrow requests had no fixture at all, which left the 15 student routes and
  // the request-approval handler seeding against empty collections. createdAt
  // and updatedAt are written explicitly: this seed goes through the raw driver,
  // so mongoose timestamps never fire, and the request list sorts on createdAt.
  const minutesAgo = (n) => new Date(now.getTime() - n * 60 * 1000);
  const borrowRequestDocs = [
    {
      _id: new ObjectId(),
      userId: userDocs[0]._id,
      bookId: bookDocs[1]._id,
      status: 'pending',
      requestType: 'borrow',
      daysRequested: 14,
      message: 'Needed for a term paper.',
      createdAt: minutesAgo(30),
      updatedAt: minutesAgo(30)
    },
    {
      _id: new ObjectId(),
      userId: userDocs[1]._id,
      bookId: loanDocs[1].bookId,
      loanId: loanDocs[1]._id,
      status: 'pending',
      requestType: 'renewal',
      daysRequested: 7,
      message: 'Still reading, please extend.',
      createdAt: minutesAgo(90),
      updatedAt: minutesAgo(90)
    },
    {
      _id: new ObjectId(),
      userId: userDocs[0]._id,
      bookId: loanDocs[0].bookId,
      loanId: loanDocs[0]._id,
      status: 'approved',
      requestType: 'borrow',
      daysRequested: 14,
      processedBy: adminUser._id,
      processedAt: minutesAgo(60 * 24 * 7),
      dueAt: loanDocs[0].dueAt,
      createdAt: minutesAgo(60 * 24 * 7 + 15),
      updatedAt: minutesAgo(60 * 24 * 7)
    },
    {
      _id: new ObjectId(),
      userId: userDocs[1]._id,
      bookId: bookDocs[2]._id,
      status: 'rejected',
      requestType: 'borrow',
      daysRequested: 30,
      adminNote: 'Reserved for reserve shelf this term.',
      processedBy: adminUser._id,
      processedAt: minutesAgo(60 * 24 * 3),
      createdAt: minutesAgo(60 * 24 * 3 + 20),
      updatedAt: minutesAgo(60 * 24 * 3)
    },
    {
      _id: new ObjectId(),
      userId: userDocs[0]._id,
      bookId: bookDocs[2]._id,
      status: 'cancelled',
      requestType: 'borrow',
      daysRequested: 14,
      createdAt: minutesAgo(60 * 24 * 5),
      updatedAt: minutesAgo(60 * 24 * 5 - 10)
    }
  ];
  await db.collection('borrowrequests').insertMany(borrowRequestDocs, { ordered: false, bypassDocumentValidation: true });

  // One push subscription so the notification routes have a row to read and
  // delete. The endpoint is a placeholder -- web-push is disabled in demo runs.
  const subscriptionDocs = [
    {
      _id: new ObjectId(),
      userId: userDocs[0]._id,
      endpoint: 'https://push.example.com/seed/alice',
      keys: { p256dh: 'seed-p256dh-key', auth: 'seed-auth-key' },
      userAgent: 'seed-script',
      lastUsedAt: minutesAgo(120),
      blockedAt: null,
      createdAt: minutesAgo(60 * 24),
      updatedAt: minutesAgo(120)
    }
  ];
  await db.collection('notificationsubscriptions').insertMany(subscriptionDocs, { ordered: false, bypassDocumentValidation: true });

  const branch = 'Main';
  const hours = [
    { dayOfWeek: 1, open: '08:00', close: '17:00' },
    { dayOfWeek: 2, open: '08:00', close: '17:00' },
    { dayOfWeek: 3, open: '08:00', close: '17:00' },
    { dayOfWeek: 4, open: '08:00', close: '17:00' },
    { dayOfWeek: 5, open: '08:00', close: '17:00' },
    { dayOfWeek: 6, open: '08:00', close: '17:00' }
  ].map(h => ({ _id: `${branch}-${h.dayOfWeek}`, branch, ...h }));
  await db.collection('hours').bulkWrite(upsertsFromArray(hours), { bypassDocumentValidation: true });

  await ensureIndexes(db);

  const counts = await Promise.all(
    ['users','faculty','books','hours','loans','visits','borrowrequests','notificationsubscriptions'].map(async c => [c, await db.collection(c).countDocuments()])
  );
  console.log('Seed complete:', Object.fromEntries(counts));
}

main().catch(e => { console.error('Seed error:', e); })
  .finally(async () => { try { if (client) await client.close(); } finally { if (mem) await mem.stop(); } });
