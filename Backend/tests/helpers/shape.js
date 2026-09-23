'use strict';

// Body-shape signatures for characterization tests.
//
// A refactor must not change what an endpoint returns, but snapshotting whole
// bodies is useless here: they carry ObjectIds, timestamps and computed dates
// that differ every run. So record the *shape* instead -- which wrapper key the
// list sits under, which fields exist, what type each one is.
//
// This is what catches the couplings recorded as F4 in REFACTOR-FINDINGS.md:
// five different list wrappers are in active frontend use, and turning a bare
// array into { items } yields an empty list in the UI rather than an error.

const MAX_DEPTH = 4;

function signature(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (!value.length) return 'array<empty>';
    // Rows are not always homogeneous -- borrow requests carry loanId only on
    // renewals and adminNote only once processed. Describing row 0 alone made
    // the signature depend on sort order, so record the sorted set of distinct
    // row shapes instead. Order-insensitive, and it still catches a renamed or
    // dropped field anywhere in the list.
    const distinct = [...new Set(value.map((item) => signature(item, depth + 1)))].sort();
    return distinct.length === 1 ? `array<${distinct[0]}>` : `array<${distinct.join('|')}>`;
  }
  const type = typeof value;
  if (type !== 'object') return type;
  if (depth >= MAX_DEPTH) return 'object<...>';
  const keys = Object.keys(value).sort();
  if (!keys.length) return 'object<empty>';
  return `{${keys.map((key) => `${key}:${signature(value[key], depth + 1)}`).join(',')}}`;
}

module.exports = { signature };
