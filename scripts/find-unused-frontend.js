#!/usr/bin/env node
/* Report potentially unused files in Frontend/src (no deletions).
   It builds a simple import graph starting from common entry points.

   Usage: node scripts/find-unused-frontend.js
*/

const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'Frontend', 'src');
const exts = ['.js', '.jsx', '.css', '.png', '.jpg', '.jpeg', '.webp', '.svg'];

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

function normalize(p) { return p.split(path.sep).join('/'); }

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

function resolveImport(fromFile, spec) {
  if (!spec || (!spec.startsWith('.') && !spec.startsWith('/'))) return null;
  const base = spec.startsWith('.') ? path.resolve(path.dirname(fromFile), spec) : path.join(SRC, spec);
  const candidates = [];
  // exact file with known exts
  for (const e of ['', ...exts]) candidates.push(base + e);
  // index files if target is directory
  for (const e of exts) candidates.push(path.join(base, 'index' + e));
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.resolve(c);
  }
  return null;
}

function parseImports(code) {
  const out = new Set();
  // import ... from '...'
  const r1 = /import\s+[^'"\n]+from\s+['"]([^'"\n]+)['"]/g; let m;
  while ((m = r1.exec(code))) out.add(m[1]);
  // import('...') dynamic
  const r2 = /import\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  while ((m = r2.exec(code))) out.add(m[1]);
  // require('...')
  const r3 = /require\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  while ((m = r3.exec(code))) out.add(m[1]);
  return Array.from(out);
}

function buildGraph(allFiles) {
  const graph = new Map();
  for (const f of allFiles) {
    const ext = path.extname(f).toLowerCase();
    if (!exts.includes(ext)) continue; // only parse source-like files
    const code = read(f);
    const specs = parseImports(code);
    const resolved = specs.map((s) => resolveImport(f, s)).filter(Boolean);
    graph.set(path.resolve(f), new Set(resolved));
  }
  return graph;
}

function collectReachable(graph, seeds) {
  const seen = new Set();
  const stack = seeds.map((s) => path.resolve(s));
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const next = graph.get(cur);
    if (next) for (const n of next) stack.push(n);
  }
  return seen;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('Frontend/src not found at', SRC);
    process.exit(1);
  }

  const all = listFiles(SRC).filter((p) => exts.includes(path.extname(p).toLowerCase()));
  const graph = buildGraph(all);

  const seeds = [];
  for (const s of ['index.js', 'App.jsx', 'setupProxy.js', 'index.css', 'theme.js']) {
    const p = path.join(SRC, s);
    if (fs.existsSync(p)) seeds.push(p);
  }
  if (seeds.length === 0) {
    console.warn('No entry files found; defaulting to all .js/.jsx files as seeds.');
    seeds.push(...all.filter((p) => ['.js', '.jsx'].includes(path.extname(p))));
  }

  const reachable = collectReachable(graph, seeds);
  const unused = all.filter((p) => !reachable.has(path.resolve(p)));

  if (!unused.length) {
    console.log('No obviously-unused files detected under Frontend/src.');
  } else {
    console.log('Potentially unused files (verify before deleting):');
    for (const u of unused) console.log(' -', normalize(path.relative(path.join(__dirname, '..'), u)));
  }
}

main();

