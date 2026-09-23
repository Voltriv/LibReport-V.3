'use strict';

// Test environment setup. Requiring this module has side effects and it must be
// required BEFORE ../../server.js: server.js exits the process without
// JWT_SECRET and picks its database mode from these variables at module scope.

const previous = {
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET,
  NO_DB: process.env.NO_DB,
  USE_MEMORY_DB: process.env.USE_MEMORY_DB,
  MONGO_MEMORY_OS_DIST: process.env.MONGO_MEMORY_OS_DIST,
  MONGO_MEMORY_OS_RELEASE: process.env.MONGO_MEMORY_OS_RELEASE,
  MONGO_MEMORY_VERSION: process.env.MONGO_MEMORY_VERSION
};

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NO_DB = 'false';
process.env.USE_MEMORY_DB = 'true';

// On Linux CI the mongodb-memory-server OS detection picks Ubuntu 22.04, which
// has no published build for the version we want, so pin it to the ubuntu20.04
// one. This must stay Linux-only: forcing an Ubuntu build on macOS made
// MongoMemoryServer.create time out ("Instance failed to start within 10000ms")
// on every run, because no such binary exists for darwin/arm64.
const IS_LINUX = process.platform === 'linux';
if (!previous.MONGO_MEMORY_OS_DIST && IS_LINUX) {
  process.env.MONGO_MEMORY_OS_DIST = 'ubuntu';
}
if (!previous.MONGO_MEMORY_OS_RELEASE && IS_LINUX) {
  process.env.MONGO_MEMORY_OS_RELEASE = '20.04';
}
if (!previous.MONGO_MEMORY_VERSION) {
  // Matches server.js, scripts/seed.js and scripts/indexes.js so every entry
  // point shares one cached mongod binary.
  process.env.MONGO_MEMORY_VERSION = '7.0.14';
}

// Restores every variable this module touched. Call from test.after so one test
// file's database mode does not leak into the next.
function restoreEnv() {
  for (const [key, value] of Object.entries(previous)) {
    if (typeof value === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

module.exports = { restoreEnv };
