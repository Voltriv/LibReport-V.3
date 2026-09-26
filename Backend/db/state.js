'use strict';

// Whether the database is usable, as one piece of shared mutable state.
//
// mongoose.connection.readyState alone is not sufficient: during the in-memory
// fallback the connection is replaced, and there is a window where readyState has
// not caught up but the app has already been told the database is available. The
// guards and the auth gate both need the same answer, so the flag lives here
// rather than as a module-local in whichever file happened to set it.

let dbReady = false;

function setDbReady(value) {
  dbReady = Boolean(value);
}

function isDbReady() {
  return dbReady;
}

module.exports = { setDbReady, isDbReady };
