// Shared validators and constants for models
// Student/Admin ID format: 2-4-6 digits (e.g., 03-0000-000000)
const STUDENT_ID_REGEX = /^\d{2}-\d{4}-\d{6}$/;

// Supported account roles. Stored in lowercase to simplify comparisons.
const USER_ROLE_VALUES = Object.freeze([
  'student',
  'faculty',
  'staff',
  'admin',
  'librarian',
  'librarian_staff'
]);

/**
 * Normalize a user role value.
 * - Trims whitespace.
 * - Accepts common variants like "Librarian Staff"/"librarian-staff".
 * - Returns `null` for unknown roles so callers can decide how to handle it.
 */
function normalizeUserRole(raw) {
  if (raw === undefined || raw === null) return null;
  const candidate = String(raw).trim();
  if (!candidate) return null;
  const normalized = candidate.toLowerCase().replace(/[\s-]+/g, '_');
  return USER_ROLE_VALUES.includes(normalized) ? normalized : null;
}

module.exports = { STUDENT_ID_REGEX, USER_ROLE_VALUES, normalizeUserRole };

