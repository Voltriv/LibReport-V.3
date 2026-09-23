#!/usr/bin/env node
'use strict';

// Route-parity check for the server.js route extraction.
//
// Enumerates every route the Express app registers, in registration order, and
// compares it against a recorded baseline. This catches the extraction's most
// likely failure: a route dropped, renamed, misprefixed, or reordered. The
// frontend hides exactly that failure -- Borrowing.jsx swallows a 404 into an
// empty list and SignIn.jsx renders a 404 on login as "Service temporarily
// unavailable" -- so a lost route looks like missing data or an outage, never
// like a bug.
//
//   node scripts/route-parity.js --write    capture the baseline
//   node scripts/route-parity.js            compare against it (exit 1 on drift)
//
// Always runs with NO_DB=true so it never touches a database and so the
// middleware stack is identical between capture and check.

const fs = require('node:fs');
const path = require('node:path');

const BASELINE_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'route-baseline.json');

// Set before requiring server.js: it exits the process without JWT_SECRET, and
// connects to Mongo at module scope unless NO_DB is set.
process.env.NO_DB = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'route-parity-probe';

const express = require('express');

// Express 5 stores a mounted router's prefix as a compiled matcher function,
// not a readable string, so the only way to recover it is to record the path at
// mount time. Today every route sits directly on the app and this records
// nothing; after the extraction it is what keeps full paths resolvable.
const mountPaths = new WeakMap();
const originalUse = express.Router.prototype.use;
express.Router.prototype.use = function recordingUse(...args) {
  let mountPath = '/';
  let firstHandler = 0;
  if (typeof args[0] === 'string' || Array.isArray(args[0]) || args[0] instanceof RegExp) {
    mountPath = args[0];
    firstHandler = 1;
  }
  for (let i = firstHandler; i < args.length; i += 1) {
    const handler = args[i];
    if (isRouter(handler)) {
      const recorded = mountPaths.get(handler) || [];
      recorded.push(mountPath);
      mountPaths.set(handler, recorded);
    }
  }
  return originalUse.apply(this, args);
};

function isRouter(value) {
  return typeof value === 'function' && Array.isArray(value.stack);
}

function joinPath(prefix, tail) {
  const joined = `${prefix === '/' ? '' : prefix}${tail === '/' ? '' : tail}`;
  if (!joined) return '/';
  return joined.replace(/\/{2,}/g, '/');
}

function describeMount(mount) {
  if (Array.isArray(mount)) return mount[0];
  if (mount instanceof RegExp) return `(regexp:${mount.source})`;
  return mount;
}

function walk(router, prefix, acc) {
  for (const layer of router.stack) {
    if (layer.route) {
      const declared = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const methods = Object.keys(layer.route.methods)
        .filter((method) => method !== '_all')
        .map((method) => method.toUpperCase())
        .sort();
      acc.routes.push({
        order: acc.routes.length,
        methods,
        paths: declared.map((declaredPath) => joinPath(prefix, declaredPath))
      });
    } else if (isRouter(layer.handle)) {
      const recorded = mountPaths.get(layer.handle) || [];
      // A router mounted at several paths is walked once per mount, in order.
      const mount = recorded.length ? recorded.shift() : '/';
      walk(layer.handle, joinPath(prefix, describeMount(mount)), acc);
    } else {
      acc.middleware.push({
        order: acc.middleware.length,
        name: layer.name || '<anonymous>'
      });
    }
  }
  return acc;
}

function flatten(routes) {
  const endpoints = [];
  for (const entry of routes) {
    for (const routePath of entry.paths) {
      for (const method of entry.methods) {
        endpoints.push(`${method} ${routePath}`);
      }
    }
  }
  return endpoints;
}

function collect() {
  const { app } = require('../server.js');
  const router = app.router || app._router;
  if (!router) throw new Error('Could not reach the Express router stack');
  const acc = walk(router, '/', { routes: [], middleware: [] });
  return {
    capturedWith: { express: require('express/package.json').version, node: process.version },
    routeCount: acc.routes.length,
    endpointCount: flatten(acc.routes).length,
    routes: acc.routes,
    // Informational only. Slice 3 legitimately renames anonymous middleware to
    // named module functions, so middleware is reported but never fails a run.
    middleware: acc.middleware
  };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`No baseline at ${path.relative(process.cwd(), BASELINE_PATH)}`);
    console.error('Capture one from the current server.js first: node scripts/route-parity.js --write');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function write(snapshot) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`[route-parity] baseline written: ${path.relative(process.cwd(), BASELINE_PATH)}`);
  console.log(`[route-parity] ${snapshot.routeCount} registrations, ${snapshot.endpointCount} endpoints`);
}

function compare(baseline, snapshot) {
  const before = flatten(baseline.routes);
  const after = flatten(snapshot.routes);

  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const dropped = before.filter((endpoint) => !afterSet.has(endpoint));
  const added = after.filter((endpoint) => !beforeSet.has(endpoint));

  const reordered = [];
  if (!dropped.length && !added.length) {
    for (let i = 0; i < before.length; i += 1) {
      if (before[i] !== after[i]) reordered.push({ position: i, expected: before[i], actual: after[i] });
    }
  }

  const problems = dropped.length + added.length + reordered.length;
  if (!problems) {
    console.log(`[route-parity] OK - ${after.length} endpoints match the baseline, in order`);
    if (baseline.middleware.length !== snapshot.middleware.length) {
      console.log(
        `[route-parity] note: middleware layer count changed ${baseline.middleware.length} -> ${snapshot.middleware.length} (informational)`
      );
    }
    return 0;
  }

  console.error('[route-parity] FAIL');
  if (dropped.length) {
    console.error(`\n  Dropped or renamed (${dropped.length}):`);
    for (const endpoint of dropped) console.error(`    - ${endpoint}`);
  }
  if (added.length) {
    console.error(`\n  Added or misprefixed (${added.length}):`);
    for (const endpoint of added) console.error(`    + ${endpoint}`);
  }
  if (reordered.length) {
    console.error(`\n  Reordered (${reordered.length}) - order decides which handler wins:`);
    for (const item of reordered) {
      console.error(`    @${item.position} expected ${item.expected}, got ${item.actual}`);
    }
  }
  console.error('');
  return 1;
}

function main() {
  const snapshot = collect();
  if (process.argv.includes('--write')) {
    write(snapshot);
    return 0;
  }
  return compare(readBaseline(), snapshot);
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { walk, flatten, compare, joinPath, mountPaths };
