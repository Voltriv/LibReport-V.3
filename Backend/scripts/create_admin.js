// Create the first admin, or reset an existing admin's password.
//   node scripts/create_admin.js --id 03-2324-032224 --name "Librarian" --email admin@school.edu
//   node scripts/create_admin.js --id 03-2324-032224 --reset
// Omit --password and a strong one is generated and printed once (it is never stored in plaintext).
const path = require('node:path');
const crypto = require('node:crypto');
const env = require('../utils/dotenv');
env.config({ path: path.resolve(process.cwd(), '.env') });
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const { resolveMongoConfig } = require('../db/uri');
const { STUDENT_ID_REGEX } = require('../models/validators');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(20);
  let pw = '';
  for (const b of bytes) pw += alphabet[b % alphabet.length];
  return `${pw}!7`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const adminId = String(args.id || process.env.ADMIN_ID || process.env.ADMIN_STUDENT_ID || '').trim();
  const fullName = String(args.name || process.env.ADMIN_NAME || 'Librarian').trim();
  const rawEmail = args.email || process.env.ADMIN_EMAIL || '';
  const email = rawEmail ? String(rawEmail).trim().toLowerCase() : '';
  const role = args.role === 'librarian_staff' ? 'librarian_staff' : 'librarian';
  const reset = Boolean(args.reset);

  if (!STUDENT_ID_REGEX.test(adminId)) {
    console.error('Admin ID must match the 00-0000-000000 pattern. Pass --id or set ADMIN_ID in Backend/.env.');
    process.exit(1);
  }

  const providedPassword = typeof args.password === 'string' ? args.password : process.env.ADMIN_PASSWORD;
  const password = providedPassword || generatePassword();
  if (providedPassword && String(providedPassword).length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const { uri, dbName } = resolveMongoConfig();
  if (!uri) {
    console.error('MONGO_URI is not set. Copy Backend/.env.example to Backend/.env first.');
    process.exit(1);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const admins = client.db(dbName).collection('admins');
    const lookups = [{ adminId }];
    if (email) lookups.push({ email });
    const existing = await admins.findOne({ $or: lookups });

    if (existing && !reset) {
      console.log(`Admin already exists (adminId ${existing.adminId}, role ${existing.role}). Re-run with --reset to set a new password.`);
      return;
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const now = new Date();
    const $set = { adminId, fullName, role, status: 'active', passwordHash, updatedAt: now };
    if (email) $set.email = email;
    await admins.updateOne(
      existing ? { _id: existing._id } : { adminId },
      { $set, $setOnInsert: { createdAt: now } },
      { upsert: true, bypassDocumentValidation: true }
    );

    console.log(existing ? 'Password reset for existing admin.' : 'Admin created.');
    console.log(`  Admin ID : ${adminId}`);
    console.log(`  Name     : ${fullName}`);
    if (email) console.log(`  Email    : ${email}`);
    console.log(`  Role     : ${role}`);
    if (!providedPassword) {
      console.log(`  Password : ${password}`);
      console.log('Store this now — it is hashed in the database and cannot be read back.');
    } else {
      console.log('  Password : (the value you supplied)');
    }
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('create_admin failed:', err.message);
  process.exit(2);
});
