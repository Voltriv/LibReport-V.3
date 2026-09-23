'use strict';

// mongodb-memory-server option resolution for tests.
//
// This duplicates buildMemoryServerOptions in server.js (and in scripts/seed.js
// and scripts/indexes.js -- four verbatim copies in total). Unifying them into
// utils/memoryServer.js is a Phase 2 item; Phase 1 does not change behavior, so
// the copy stays for now.

const { MongoMemoryServer } = require('mongodb-memory-server');

function buildMemoryServerOptions() {
  const binary = {};
  if (process.env.MONGO_MEMORY_VERSION) {
    binary.version = process.env.MONGO_MEMORY_VERSION;
  }
  if (process.env.MONGO_MEMORY_DOWNLOAD_DIR) {
    binary.downloadDir = process.env.MONGO_MEMORY_DOWNLOAD_DIR;
  }
  if (process.env.MONGO_MEMORY_SYSTEM_BINARY) {
    binary.systemBinary = process.env.MONGO_MEMORY_SYSTEM_BINARY;
  }
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
    binary.os = {
      dist: (dist || 'ubuntu').toLowerCase(),
      release: release || '20.04'
    };
  }
  const skipMd5 =
    String(
      process.env.MONGO_MEMORY_SKIP_MD5 ||
        process.env.MONGOMS_SKIP_MD5 ||
        process.env.MONGO_MEMORY_DISABLE_MD5 ||
        ''
    )
      .toLowerCase()
      .trim() === 'true';
  if (skipMd5) {
    binary.skipMD5 = true;
    binary.checkMD5 = false;
  }
  return { binary };
}

// Starts and immediately stops a memory server to find out whether a usable
// mongod binary exists on this machine. Tests call this so a missing binary
// skips the suite instead of failing it.
async function probeMemoryBinary() {
  const mem = await MongoMemoryServer.create(buildMemoryServerOptions());
  await mem.stop();
}

module.exports = { buildMemoryServerOptions, probeMemoryBinary };
