'use strict';

// One error convention for the whole API.
//
// Handlers previously split three ways: a thrown HttpError, a local
// sendError(res, err, msg), and inline res.status(500).json({ error: err.message }).
// All three converge here, and the terminal handler below is what makes the
// first style safe -- Express 5 forwards a rejected async handler to it.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// For handlers that catch locally. Anything without an explicit .status is a bug
// rather than a rejected request, so it becomes a 500.
function sendError(res, err, fallbackMessage) {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  res.status(status).json({ error: err?.message || fallbackMessage });
}

// Registered last so it catches rejections from every route above (Express 5
// forwards async errors here). Without it Express replies with an HTML page
// that embeds the stack trace and absolute file paths, and the frontend — which
// reads err.response.data.error — has nothing to show the user.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  if (err?.name === 'CastError') {
    return res.status(400).json({ error: `invalid ${err.path === '_id' ? 'id' : err.path}` });
  }
  if (err?.name === 'ValidationError') {
    const details = Object.values(err.errors || {}).map((e) => e.message);
    return res.status(400).json({ error: details.join('; ') || 'validation failed' });
  }
  if (err?.code === 11000 || err?.code === 11001) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    return res.status(409).json({ error: field ? `${field} already exists` : 'duplicate value' });
  }
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'malformed JSON body' });
  }
  // body-parser rejects an oversized body with a 413 error, but nothing mapped
  // it, so the client saw a generic 500 and no indication of what was wrong.
  // This was already true of the old global 50mb ceiling; narrowing the limit
  // makes it reachable often enough to matter.
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'request body too large' });
  }

  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err?.stack || err);
  return res.status(500).json({ error: 'internal error' });
}

module.exports = { HttpError, sendError, errorHandler };
