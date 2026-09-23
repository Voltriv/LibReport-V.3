'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const prevNoDb = process.env.NO_DB;
process.env.NO_DB = 'true';

const assert = require('node:assert/strict');
const test = require('node:test');

const { coerceDate, resolveLoanStatusMeta } = require('../server.js');

test.after(() => {
  if (typeof prevNoDb === 'undefined') {
    delete process.env.NO_DB;
  } else {
    process.env.NO_DB = prevNoDb;
  }
});

test('coerceDate handles various inputs', () => {
  const now = new Date('2024-01-01T00:00:00Z');
  const dateFromDate = coerceDate(now);
  assert(dateFromDate instanceof Date);
  assert.notStrictEqual(dateFromDate, now);
  assert.equal(dateFromDate.toISOString(), now.toISOString());

  const dateFromNumber = coerceDate(now.getTime());
  assert(dateFromNumber instanceof Date);
  assert.equal(dateFromNumber.toISOString(), now.toISOString());

  const dateFromString = coerceDate('2024-01-01T00:00:00Z');
  assert(dateFromString instanceof Date);
  assert.equal(dateFromString.toISOString(), '2024-01-01T00:00:00.000Z');

  const dateFromObject = coerceDate({ $date: '2024-01-01T00:00:00Z' });
  assert(dateFromObject instanceof Date);
  assert.equal(dateFromObject.toISOString(), '2024-01-01T00:00:00.000Z');

  assert.equal(coerceDate(undefined), null);
  assert.equal(coerceDate('invalid'), null);
});

test('resolveLoanStatusMeta identifies returned loans', () => {
  const status = resolveLoanStatusMeta({ returnedAt: '2024-01-02T00:00:00Z' });
  assert.deepEqual(status, { key: 'returned', label: 'returned' });
});

test('resolveLoanStatusMeta identifies overdue loans', () => {
  const status = resolveLoanStatusMeta(
    { dueAt: '2023-12-31T23:59:59Z' },
    { now: '2024-01-01T00:00:00Z' }
  );
  assert.deepEqual(status, { key: 'overdue', label: 'overdue' });
});

test('resolveLoanStatusMeta uses active fallback label', () => {
  const status = resolveLoanStatusMeta(
    { dueAt: '2024-01-02T00:00:00Z' },
    { now: '2024-01-01T00:00:00Z', activeLabel: 'On Time' }
  );
  assert.deepEqual(status, { key: 'active', label: 'On Time' });
});
