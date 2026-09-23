const fs = require('node:fs');
const path = require('node:path');

let realDotenv = null;
try {
  realDotenv = require('dotenv');
} catch (err) {
  if (err && err.code !== 'MODULE_NOT_FOUND') {
    throw err;
  }
}

function config(options = {}) {
  // Default to quiet: every script loads several .env paths, and the per-file
  // "injecting env" banners drown out the output we actually care about.
  const opts = { quiet: true, ...options };
  if (realDotenv && typeof realDotenv.config === 'function') {
    return realDotenv.config(opts);
  }
  return fallbackConfig(opts);
}

function fallbackConfig(options = {}) {
  const opts = {
    path: options.path ?? path.resolve(process.cwd(), '.env'),
    encoding: options.encoding ?? 'utf8',
    override: options.override ?? false,
    debug: options.debug ?? false
  };

  try {
    const contents = fs.readFileSync(opts.path, { encoding: opts.encoding });
    const parsed = parse(contents);
    for (const [key, value] of Object.entries(parsed)) {
      if (opts.override || typeof process.env[key] === 'undefined') {
        process.env[key] = value;
      }
    }
    return { parsed };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      if (opts.debug) {
        console.warn(`[env] ${opts.path} not found; skipping load.`);
      }
      return { parsed: {} };
    }
    if (opts.debug) {
      console.warn(`[env] Failed to load ${opts.path}: ${err.message}`);
    }
    return { error: err };
  }
}

function parse(src) {
  const result = {};
  const lines = String(src).split(/\r?\n/);
  let pending = null;

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    if (index === 0) {
      line = line.replace(/^\uFEFF/, '');
    }

    if (pending) {
      pending.value += '\n' + line;
      if (closingQuoteReached(line, pending.quote)) {
        const raw = stripClosingQuote(pending.value, pending.quote);
        result[pending.key] =
          pending.quote === '"'
            ? unescapeDoubleQuotes(raw)
            : unescapeSingleQuotes(raw);
        pending = null;
      }
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }

    const match = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2] ?? '';
    value = value.trim();

    if (!value) {
      result[key] = '';
      continue;
    }

    const first = value[0];
    if (first === '"' || first === "'") {
      const quote = first;
      const withoutFirst = value.slice(1);
      if (closingQuoteReached(withoutFirst, quote)) {
        const raw = stripClosingQuote(withoutFirst, quote);
        result[key] = quote === '"' ? unescapeDoubleQuotes(raw) : unescapeSingleQuotes(raw);
      } else {
        pending = { key, quote, value: withoutFirst };
      }
      continue;
    }

    result[key] = stripInlineComment(value);
  }

  if (pending) {
    const raw = stripClosingQuote(pending.value, pending.quote);
    result[pending.key] =
      pending.quote === '"'
        ? unescapeDoubleQuotes(raw)
        : unescapeSingleQuotes(raw);
  }

  return result;
}

function closingQuoteReached(segment, quote) {
  if (!segment) return false;
  let end = segment.length - 1;
  while (end >= 0 && /\s/.test(segment[end])) {
    end -= 1;
  }
  if (end < 0) return false;

  if (segment[end] !== quote) {
    const hashIndex = segment.lastIndexOf('#', end);
    if (hashIndex !== -1) {
      const prev = hashIndex > 0 ? segment[hashIndex - 1] : ' ';
      if (/\s/.test(prev)) {
        end = hashIndex - 1;
        while (end >= 0 && /\s/.test(segment[end])) {
          end -= 1;
        }
      }
    }
  }

  if (end < 0 || segment[end] !== quote) {
    return false;
  }

  let backslashCount = 0;
  for (let i = end - 1; i >= 0 && segment[i] === '\\'; i -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 0;
}

function stripClosingQuote(value, quote) {
  let end = value.length;
  while (end > 0 && /\s/.test(value[end - 1])) {
    end -= 1;
  }

  if (end > 0 && value[end - 1] !== quote) {
    const hashIndex = value.lastIndexOf('#', end - 1);
    if (hashIndex !== -1) {
      const prev = hashIndex > 0 ? value[hashIndex - 1] : ' ';
      if (/\s/.test(prev)) {
        end = hashIndex;
        while (end > 0 && /\s/.test(value[end - 1])) {
          end -= 1;
        }
      }
    }
  }

  if (end > 0 && value[end - 1] === quote) {
    end -= 1;
  }

  return value.slice(0, end);
}

function stripInlineComment(value) {
  let output = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '#') {
      const prev = i === 0 ? ' ' : value[i - 1];
      if (/\s/.test(prev)) {
        return output.trimEnd();
      }
    }
    output += ch;
  }
  return output.trim();
}

function unescapeDoubleQuotes(value) {
  return value.replace(/\\(.)/g, (_, char) => {
    switch (char) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'f':
        return '\f';
      case 'v':
        return '\v';
      case '\\':
        return '\\';
      case '"':
        return '"';
      default:
        return char;
    }
  });
}

function unescapeSingleQuotes(value) {
  return value.replace(/\\'/g, "'");
}

module.exports = {
  config,
  parse: realDotenv && typeof realDotenv.parse === 'function' ? realDotenv.parse : parse
};
