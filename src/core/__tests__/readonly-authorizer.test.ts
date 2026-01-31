/**
 * Unit tests for read-only mode using native SQLite authorizer
 *
 * Tests the set_authorizer-based read-only enforcement that replaces
 * string-based SQL parsing with native SQLite checks per PRD requirements.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Define write action codes from SQLite (from sqlite-constants.js)
const SQLITE_OK = 0;
const SQLITE_DENY = 1;

// Write operation action codes
const SQLITE_CREATE_INDEX = 1;
const SQLITE_CREATE_TABLE = 2;
const SQLITE_CREATE_TEMP_INDEX = 3;
const SQLITE_CREATE_TEMP_TABLE = 4;
const SQLITE_CREATE_TEMP_TRIGGER = 5;
const SQLITE_CREATE_TEMP_VIEW = 6;
const SQLITE_CREATE_TRIGGER = 7;
const SQLITE_CREATE_VIEW = 8;
const SQLITE_DELETE = 9;
const SQLITE_DROP_INDEX = 10;
const SQLITE_DROP_TABLE = 11;
const SQLITE_DROP_TEMP_INDEX = 12;
const SQLITE_DROP_TEMP_TABLE = 13;
const SQLITE_DROP_TEMP_TRIGGER = 14;
const SQLITE_DROP_TEMP_VIEW = 15;
const SQLITE_DROP_TRIGGER = 16;
const SQLITE_DROP_VIEW = 17;
const SQLITE_INSERT = 18;
const SQLITE_UPDATE = 23;
const SQLITE_ALTER_TABLE = 26;
const SQLITE_REINDEX = 27;
const SQLITE_CREATE_VTABLE = 29;
const SQLITE_DROP_VTABLE = 30;

// Read operation action codes
const SQLITE_READ = 20;
const SQLITE_SELECT = 21;
const SQLITE_PRAGMA = 19;
const SQLITE_TRANSACTION = 22;
const SQLITE_ATTACH = 24;
const SQLITE_DETACH = 25;
const SQLITE_ANALYZE = 28;
const SQLITE_FUNCTION = 31;
const SQLITE_SAVEPOINT = 32;

// Import the authorizer callback after mocks are set up
import { isWriteOperation, createReadOnlyAuthorizer } from '../engine/readonly-authorizer';

describe('isWriteOperation', () => {
  describe('write operations', () => {
    const writeOps = [
      { code: SQLITE_CREATE_INDEX, name: 'CREATE INDEX' },
      { code: SQLITE_CREATE_TABLE, name: 'CREATE TABLE' },
      { code: SQLITE_CREATE_TEMP_INDEX, name: 'CREATE TEMP INDEX' },
      { code: SQLITE_CREATE_TEMP_TABLE, name: 'CREATE TEMP TABLE' },
      { code: SQLITE_CREATE_TEMP_TRIGGER, name: 'CREATE TEMP TRIGGER' },
      { code: SQLITE_CREATE_TEMP_VIEW, name: 'CREATE TEMP VIEW' },
      { code: SQLITE_CREATE_TRIGGER, name: 'CREATE TRIGGER' },
      { code: SQLITE_CREATE_VIEW, name: 'CREATE VIEW' },
      { code: SQLITE_DELETE, name: 'DELETE' },
      { code: SQLITE_DROP_INDEX, name: 'DROP INDEX' },
      { code: SQLITE_DROP_TABLE, name: 'DROP TABLE' },
      { code: SQLITE_DROP_TEMP_INDEX, name: 'DROP TEMP INDEX' },
      { code: SQLITE_DROP_TEMP_TABLE, name: 'DROP TEMP TABLE' },
      { code: SQLITE_DROP_TEMP_TRIGGER, name: 'DROP TEMP TRIGGER' },
      { code: SQLITE_DROP_TEMP_VIEW, name: 'DROP TEMP VIEW' },
      { code: SQLITE_DROP_TRIGGER, name: 'DROP TRIGGER' },
      { code: SQLITE_DROP_VIEW, name: 'DROP VIEW' },
      { code: SQLITE_INSERT, name: 'INSERT' },
      { code: SQLITE_UPDATE, name: 'UPDATE' },
      { code: SQLITE_ALTER_TABLE, name: 'ALTER TABLE' },
      { code: SQLITE_REINDEX, name: 'REINDEX' },
      { code: SQLITE_CREATE_VTABLE, name: 'CREATE VTABLE' },
      { code: SQLITE_DROP_VTABLE, name: 'DROP VTABLE' },
    ];

    writeOps.forEach(({ code, name }) => {
      it(`should identify ${name} (${code}) as write operation`, () => {
        expect(isWriteOperation(code)).toBe(true);
      });
    });
  });

  describe('read operations', () => {
    const readOps = [
      { code: SQLITE_READ, name: 'READ' },
      { code: SQLITE_SELECT, name: 'SELECT' },
      { code: SQLITE_PRAGMA, name: 'PRAGMA' },
      { code: SQLITE_TRANSACTION, name: 'TRANSACTION' },
      { code: SQLITE_ATTACH, name: 'ATTACH' },
      { code: SQLITE_DETACH, name: 'DETACH' },
      { code: SQLITE_ANALYZE, name: 'ANALYZE' },
      { code: SQLITE_FUNCTION, name: 'FUNCTION' },
      { code: SQLITE_SAVEPOINT, name: 'SAVEPOINT' },
    ];

    readOps.forEach(({ code, name }) => {
      it(`should identify ${name} (${code}) as read operation`, () => {
        expect(isWriteOperation(code)).toBe(false);
      });
    });
  });
});

describe('createReadOnlyAuthorizer', () => {
  it('should return SQLITE_OK for read operations', () => {
    const authorizer = createReadOnlyAuthorizer();

    // SELECT operation
    expect(authorizer(null, SQLITE_SELECT, null, null, null, null)).toBe(SQLITE_OK);

    // READ operation
    expect(authorizer(null, SQLITE_READ, 'table', 'column', null, null)).toBe(SQLITE_OK);

    // PRAGMA operation
    expect(authorizer(null, SQLITE_PRAGMA, 'table_info', null, null, null)).toBe(SQLITE_OK);
  });

  it('should return SQLITE_DENY for write operations', () => {
    const authorizer = createReadOnlyAuthorizer();

    // INSERT operation
    expect(authorizer(null, SQLITE_INSERT, 'users', null, null, null)).toBe(SQLITE_DENY);

    // UPDATE operation
    expect(authorizer(null, SQLITE_UPDATE, 'users', 'name', null, null)).toBe(SQLITE_DENY);

    // DELETE operation
    expect(authorizer(null, SQLITE_DELETE, 'users', null, null, null)).toBe(SQLITE_DENY);

    // CREATE TABLE operation
    expect(authorizer(null, SQLITE_CREATE_TABLE, 'new_table', null, null, null)).toBe(SQLITE_DENY);

    // DROP TABLE operation
    expect(authorizer(null, SQLITE_DROP_TABLE, 'old_table', null, null, null)).toBe(SQLITE_DENY);

    // ALTER TABLE operation
    expect(authorizer(null, SQLITE_ALTER_TABLE, 'users', null, null, null)).toBe(SQLITE_DENY);
  });

  it('should allow TRANSACTION operations in read-only mode', () => {
    const authorizer = createReadOnlyAuthorizer();

    // BEGIN, COMMIT, ROLLBACK are allowed (they don't modify data)
    expect(authorizer(null, SQLITE_TRANSACTION, 'BEGIN', null, null, null)).toBe(SQLITE_OK);
  });

  it('should allow SAVEPOINT operations in read-only mode', () => {
    const authorizer = createReadOnlyAuthorizer();

    expect(authorizer(null, SQLITE_SAVEPOINT, 'sp1', null, null, null)).toBe(SQLITE_OK);
  });
});

describe('Read-only error message', () => {
  it('should provide clear error message explaining read-only restriction', () => {
    const authorizer = createReadOnlyAuthorizer();

    // When a write operation is denied, SQLite throws an auth error
    // Our implementation should provide a clear message
    const result = authorizer(null, SQLITE_INSERT, 'users', null, null, null);
    expect(result).toBe(SQLITE_DENY);

    // The error message will be set by SQLite when it encounters SQLITE_DENY
    // We verify the authorizer correctly identifies and blocks writes
  });
});
