'use strict';

// Input coercion shared by the route modules. Pure functions, no models and no
// request objects: everything here turns an untrusted value into a usable one or
// throws, which is why it can be required from anywhere without a cycle.

// Accepts the several shapes a date arrives in -- Date, epoch number, ISO string,
// an Extended JSON { $date }, or anything with toDate()/valueOf() -- and returns
// a real Date or null. Never throws: callers treat null as "absent".
function coerceDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    const time = raw.getTime();
    return Number.isNaN(time) ? null : new Date(time);
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) return null;
    const date = new Date(parsed);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (raw && typeof raw === 'object') {
    if ('$date' in raw) {
      return coerceDate(raw.$date);
    }
    if (typeof raw.toDate === 'function') {
      try {
        return coerceDate(raw.toDate());
      } catch {
        return null;
      }
    }
    if (typeof raw.valueOf === 'function') {
      const value = raw.valueOf();
      if (value !== raw) {
        return coerceDate(value);
      }
    }
  }
  return null;
}

function parseIntField(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${fieldName} must be a number`);
  }
  return Math.max(0, Math.trunc(num));
}

function parseTagsInput(raw, fallback) {
  const list = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item !== undefined && item !== null) list.push(String(item));
    }
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed) {
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item !== undefined && item !== null) list.push(String(item));
            }
          }
        } catch {
          list.push(trimmed);
        }
      } else {
        for (const piece of trimmed.split(',')) {
          if (piece.trim()) list.push(piece.trim());
        }
      }
    }
  }
  if (fallback) list.push(String(fallback));
  const unique = new Set();
  const out = [];
  for (const item of list) {
    const val = item.trim();
    if (val && !unique.has(val.toLowerCase())) {
      unique.add(val.toLowerCase());
      out.push(val);
    }
  }
  return out;
}

// Search terms reach Mongo inside $regex, so anything a user typed has to be
// neutralised before it becomes pattern syntax.
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readNumericQueryParam(value, options = {}) {
  const { defaultValue, min, max, integer = false, name = 'value' } = options;
  const hasValue = !(value === undefined || value === null || value === '');
  let candidate;
  if (hasValue) {
    candidate = Number(value);
  } else if (defaultValue !== undefined) {
    candidate = Number(defaultValue);
  } else {
    throw new Error(`${name} is required`);
  }

  if (!Number.isFinite(candidate)) {
    throw new Error(`${name} must be a number`);
  }

  let result = integer ? Math.trunc(candidate) : candidate;

  if (min !== undefined && result < min) {
    result = min;
  }
  if (max !== undefined && result > max) {
    result = max;
  }

  return result;
}

module.exports = {
  coerceDate,
  parseIntField,
  parseTagsInput,
  escapeRegex,
  readNumericQueryParam
};
