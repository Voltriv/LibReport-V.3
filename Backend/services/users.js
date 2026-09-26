'use strict';

// Role and status normalisation.
//
// Roles and statuses arrive from three places that disagree about case and
// vocabulary: JWT claims, request bodies, and documents written by earlier
// versions of the app. Everything that compares or filters on them goes through
// here so one spelling decision is made in one place.

const { USER_ROLE_VALUES, normalizeUserRole: normalizeRoleValue } = require('../models/validators');

const USER_ROLE_DEFAULT = USER_ROLE_VALUES[0];

// 'inactive' is a legacy spelling of 'disabled' still present in older documents,
// and the two must mean the same thing -- accountIsDisabled depends on it.
function normalizeUserStatus(rawStatus) {
  const value = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : '';
  if (value === 'disabled' || value === 'inactive') return 'disabled';
  if (value === 'pending') return 'pending';
  return 'active';
}

function parseUserRole(rawRole) {
  const normalized = normalizeRoleValue(rawRole);
  if (normalized && USER_ROLE_VALUES.includes(normalized)) {
    return normalized;
  }
  return null;
}

function resolveUserRole(rawRole, fallback = USER_ROLE_DEFAULT) {
  const normalized = parseUserRole(rawRole);
  if (normalized) return normalized;
  if (typeof fallback !== 'undefined') {
    const fallbackNormalized = parseUserRole(fallback);
    if (fallbackNormalized) return fallbackNormalized;
  }
  return USER_ROLE_DEFAULT;
}

// Deliberately over-broad: the filter matches the normalised role, the raw string
// as given, AND a capitalised variant, because stored documents are inconsistent
// about case. Narrowing it to the normalised value alone would silently drop
// users whose role was written as "Student".
function buildRoleFilter(...roles) {
  const values = new Set();
  for (const role of roles) {
    if (role === undefined || role === null) continue;
    const normalized = parseUserRole(role);
    if (normalized) values.add(normalized);
    const raw = String(role).trim();
    if (raw) {
      values.add(raw);
      const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1);
      values.add(capitalized);
    }
  }
  if (!values.size) {
    return { role: { $exists: true } };
  }
  return { role: { $in: Array.from(values) } };
}

module.exports = {
  USER_ROLE_DEFAULT,
  normalizeUserStatus,
  parseUserRole,
  resolveUserRole,
  buildRoleFilter
};
