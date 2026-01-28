/**
 * Unit tests for Schema Introspection
 *
 * Tests the schema introspection functions using a mock query executor.
 * These tests verify correct parsing of PRAGMA results and schema metadata.
 */

import { describe, it, expect, vi } from 'vitest';
import type { QueryResult } from '../../types';
import {
  getSchemaInfo,
  getTableInfo,
  getAllForeignKeys,
  getTableForeignKeys,
  type QueryExecutor,
} from '../schema';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock QueryResult from column names and row data
 */
function mockResult(columns: string[], rows: unknown[][]): QueryResult {
  return {
    columns,
    columnTypes: columns.map(() => 'TEXT'),
    rows: rows as (null | number | string | Uint8Array)[][],
  };
}

/**
 * Create a mock query executor with predefined responses
 */
function createMockQuery(responses: Map<string, QueryResult>): QueryExecutor {
  return vi.fn(async (sql: string, params?: unknown[]) => {
    // Normalize SQL for matching (remove extra whitespace)
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();

    // Check for exact matches first
    for (const [pattern, result] of responses) {
      if (normalizedSql.includes(pattern)) {
        return result;
      }
    }

    // Handle parameterized queries
    if (params && params.length > 0) {
      const key = `${normalizedSql}|${JSON.stringify(params)}`;
      for (const [pattern, result] of responses) {
        if (key.includes(pattern)) {
          return result;
        }
      }
    }

    // Default empty result
    return mockResult([], []);
  });
}

// =============================================================================
// getSchemaInfo Tests
// =============================================================================

describe('getSchemaInfo', () => {
  it('should return empty arrays for empty database', async () => {
    const query = createMockQuery(
      new Map([['sqlite_master', mockResult(['type', 'name', 'tbl_name', 'sql'], [])]]),
    );

    const result = await getSchemaInfo(query);

    expect(result.tables).toEqual([]);
    expect(result.views).toEqual([]);
    expect(result.indexes).toEqual([]);
  });

  it('should return tables from sqlite_master', async () => {
    const query = createMockQuery(
      new Map([
        [
          'sqlite_master',
          mockResult(
            ['type', 'name', 'tbl_name', 'sql'],
            [
              ['table', 'users', 'users', 'CREATE TABLE users (id INTEGER PRIMARY KEY)'],
              ['table', 'posts', 'posts', 'CREATE TABLE posts (id INTEGER PRIMARY KEY)'],
            ],
          ),
        ],
      ]),
    );

    const result = await getSchemaInfo(query);

    expect(result.tables).toEqual(['users', 'posts']);
    expect(result.views).toEqual([]);
    expect(result.indexes).toEqual([]);
  });

  it('should return views separately from tables', async () => {
    const query = createMockQuery(
      new Map([
        [
          'sqlite_master',
          mockResult(
            ['type', 'name', 'tbl_name', 'sql'],
            [
              ['table', 'users', 'users', 'CREATE TABLE users (id INTEGER PRIMARY KEY)'],
              ['view', 'active_users', 'active_users', 'CREATE VIEW active_users AS SELECT * FROM users'],
            ],
          ),
        ],
      ]),
    );

    const result = await getSchemaInfo(query);

    expect(result.tables).toEqual(['users']);
    expect(result.views).toEqual(['active_users']);
  });

  it('should only include user-created indexes (with SQL)', async () => {
    const query = createMockQuery(
      new Map([
        [
          'sqlite_master',
          mockResult(
            ['type', 'name', 'tbl_name', 'sql'],
            [
              ['table', 'users', 'users', 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE)'],
              ['index', 'idx_users_email', 'users', 'CREATE INDEX idx_users_email ON users(email)'],
              ['index', 'sqlite_autoindex_users_1', 'users', null], // Auto-index for UNIQUE, should be excluded
            ],
          ),
        ],
      ]),
    );

    const result = await getSchemaInfo(query);

    expect(result.indexes).toEqual(['idx_users_email']);
  });
});

// =============================================================================
// getTableInfo Tests
// =============================================================================

describe('getTableInfo', () => {
  it('should throw error for non-existent table', async () => {
    const query = createMockQuery(
      new Map([['sqlite_master WHERE name = ?', mockResult(['type', 'sql'], [])]]),
    );

    await expect(getTableInfo(query, 'nonexistent')).rejects.toThrow(
      "Table or view 'nonexistent' not found",
    );
  });

  it('should return correct column info from table_xinfo', async () => {
    const query = createMockQuery(
      new Map([
        [
          'sqlite_master WHERE name = ?',
          mockResult(
            ['type', 'sql'],
            [['table', 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)']],
          ),
        ],
        [
          'PRAGMA table_xinfo',
          mockResult(
            ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
            [
              [0, 'id', 'INTEGER', 0, null, 1, 0],
              [1, 'name', 'TEXT', 1, null, 0, 0],
            ],
          ),
        ],
        ['PRAGMA index_list', mockResult(['seq', 'name', 'unique', 'origin', 'partial'], [])],
      ]),
    );

    const result = await getTableInfo(query, 'users');

    expect(result.name).toBe('users');
    expect(result.isView).toBe(false);
    expect(result.columns).toHaveLength(2);

    expect(result.columns[0]).toEqual({
      cid: 0,
      name: 'id',
      type: 'INTEGER',
      notnull: false,
      dfltValue: null,
      pk: 1,
      generated: null,
      hidden: false,
    });

    expect(result.columns[1]).toEqual({
      cid: 1,
      name: 'name',
      type: 'TEXT',
      notnull: true,
      dfltValue: null,
      pk: 0,
      generated: null,
      hidden: false,
    });
  });

  it('should detect generated columns (virtual)', async () => {
    const query = createMockQuery(
      new Map([
        [
          'sqlite_master WHERE name = ?',
          mockResult(
            ['type', 'sql'],
            [['table', 'CREATE TABLE products (price REAL, tax REAL GENERATED ALWAYS AS (price * 0.1) VIRTUAL)']],
          ),
        ],
        [
          'PRAGMA table_xinfo',
          mockResult(
            ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
            [
              [0, 'price', 'REAL', 0, null, 0, 0],
              [1, 'tax', 'REAL', 0, null, 0, 2], // hidden=2 means VIRTUAL generated
            ],
          ),
        ],
        ['PRAGMA index_list', mockResult(['seq', 'name', 'unique', 'origin', 'partial'], [])],
      ]),
    );

    const result = await getTableInfo(query, 'products');

    expect(result.columns[1].generated).toBe('virtual');
    expect(result.columns[1].hidden).toBe(false);
  });

  it('should detect generated columns (stored)', async () => {
    const query = createMockQuery(
      new Map([
        [
          'sqlite_master WHERE name = ?',
          mockResult(
            ['type', 'sql'],
            [['table', 'CREATE TABLE products (price REAL, tax REAL GENERATED ALWAYS AS (price * 0.1) STORED)']],
          ),
        ],
        [
          'PRAGMA table_xinfo',
          mockResult(
            ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
            [
              [0, 'price', 'REAL', 0, null, 0, 0],
              [1, 'tax', 'REAL', 0, null, 0, 3], // hidden=3 means STORED generated
            ],
          ),
        ],
        ['PRAGMA index_list', mockResult(['seq', 'name', 'unique', 'origin', 'partial'], [])],
      ]),
    );

    const result = await getTableInfo(query, 'products');

    expect(result.columns[1].generated).toBe('stored');
  });

  it('should identify views correctly', async () => {
    const query = createMockQuery(
      new Map([
        [
          'sqlite_master WHERE name = ?',
          mockResult(['type', 'sql'], [['view', 'CREATE VIEW active_users AS SELECT * FROM users']]),
        ],
        [
          'PRAGMA table_xinfo',
          mockResult(
            ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
            [[0, 'id', 'INTEGER', 0, null, 0, 0]],
          ),
        ],
      ]),
    );

    const result = await getTableInfo(query, 'active_users');

    expect(result.isView).toBe(true);
    expect(result.indexes).toEqual([]); // Views don't have indexes
  });

  it('should return index information', async () => {
    const query = createMockQuery(
      new Map([
        [
          'sqlite_master WHERE name = ?',
          mockResult(['type', 'sql'], [['table', 'CREATE TABLE users (id INTEGER, email TEXT)']]),
        ],
        [
          'PRAGMA table_xinfo',
          mockResult(
            ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
            [
              [0, 'id', 'INTEGER', 0, null, 0, 0],
              [1, 'email', 'TEXT', 0, null, 0, 0],
            ],
          ),
        ],
        [
          'PRAGMA index_list',
          mockResult(
            ['seq', 'name', 'unique', 'origin', 'partial'],
            [[0, 'idx_email', 1, 'c', 0]],
          ),
        ],
        ['PRAGMA index_info', mockResult(['seqno', 'cid', 'name'], [[0, 1, 'email']])],
        [
          "type = 'index'",
          mockResult(['sql'], [['CREATE UNIQUE INDEX idx_email ON users(email)']]),
        ],
      ]),
    );

    const result = await getTableInfo(query, 'users');

    expect(result.indexes).toHaveLength(1);
    expect(result.indexes[0]).toEqual({
      name: 'idx_email',
      unique: true,
      partial: false,
      columns: ['email'],
      createSql: 'CREATE UNIQUE INDEX idx_email ON users(email)',
    });
  });

  it('should detect WITHOUT ROWID tables', async () => {
    const query = createMockQuery(
      new Map([
        [
          'sqlite_master WHERE name = ?',
          mockResult(
            ['type', 'sql'],
            [['table', 'CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID']],
          ),
        ],
        [
          'PRAGMA table_xinfo',
          mockResult(
            ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
            [
              [0, 'key', 'TEXT', 0, null, 1, 0],
              [1, 'value', 'TEXT', 0, null, 0, 0],
            ],
          ),
        ],
        ['PRAGMA index_list', mockResult(['seq', 'name', 'unique', 'origin', 'partial'], [])],
      ]),
    );

    const result = await getTableInfo(query, 'kv');

    expect(result.withoutRowid).toBe(true);
  });

  it('should detect virtual tables', async () => {
    const query = createMockQuery(
      new Map([
        [
          'sqlite_master WHERE name = ?',
          mockResult(
            ['type', 'sql'],
            [['table', 'CREATE VIRTUAL TABLE fts USING fts5(content)']],
          ),
        ],
        [
          'PRAGMA table_xinfo',
          mockResult(
            ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
            [[0, 'content', '', 0, null, 0, 0]],
          ),
        ],
        ['PRAGMA index_list', mockResult(['seq', 'name', 'unique', 'origin', 'partial'], [])],
      ]),
    );

    const result = await getTableInfo(query, 'fts');

    expect(result.isVirtual).toBe(true);
  });
});

// =============================================================================
// getAllForeignKeys Tests
// =============================================================================

describe('getAllForeignKeys', () => {
  it('should return empty array for database with no FKs', async () => {
    const query = createMockQuery(
      new Map([
        [
          'sqlite_master WHERE type =',
          mockResult(['name'], [['users'], ['posts']]),
        ],
        ['PRAGMA foreign_key_list', mockResult(['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'], [])],
      ]),
    );

    const result = await getAllForeignKeys(query);

    expect(result).toEqual([]);
  });

  it('should return foreign keys from all tables', async () => {
    const query = createMockQuery(
      new Map([
        [
          'sqlite_master WHERE type =',
          mockResult(['name'], [['users'], ['posts']]),
        ],
        [
          'foreign_key_list("users")',
          mockResult(['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'], []),
        ],
        [
          'foreign_key_list("posts")',
          mockResult(
            ['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'],
            [[0, 0, 'users', 'author_id', 'id', 'NO ACTION', 'CASCADE', 'NONE']],
          ),
        ],
      ]),
    );

    const result = await getAllForeignKeys(query);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 0,
      childTable: 'posts',
      childColumn: 'author_id',
      parentTable: 'users',
      parentColumn: 'id',
      onUpdate: 'NO ACTION',
      onDelete: 'CASCADE',
      match: 'NONE',
    });
  });

  it('should parse all FK action types', async () => {
    const query = createMockQuery(
      new Map([
        ['sqlite_master WHERE type =', mockResult(['name'], [['test']])],
        [
          'foreign_key_list("test")',
          mockResult(
            ['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'],
            [
              [0, 0, 'ref1', 'col', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
              [1, 0, 'ref2', 'col', 'id', 'RESTRICT', 'RESTRICT', 'NONE'],
              [2, 0, 'ref3', 'col', 'id', 'SET NULL', 'SET NULL', 'NONE'],
              [3, 0, 'ref4', 'col', 'id', 'SET DEFAULT', 'SET DEFAULT', 'NONE'],
              [4, 0, 'ref5', 'col', 'id', 'CASCADE', 'CASCADE', 'NONE'],
            ],
          ),
        ],
      ]),
    );

    const result = await getAllForeignKeys(query);

    expect(result).toHaveLength(5);
    expect(result[0].onDelete).toBe('NO ACTION');
    expect(result[1].onDelete).toBe('RESTRICT');
    expect(result[2].onDelete).toBe('SET NULL');
    expect(result[3].onDelete).toBe('SET DEFAULT');
    expect(result[4].onDelete).toBe('CASCADE');
  });
});

// =============================================================================
// getTableForeignKeys Tests
// =============================================================================

describe('getTableForeignKeys', () => {
  it('should return empty array for table with no FKs', async () => {
    const query = createMockQuery(
      new Map([
        ['PRAGMA foreign_key_list', mockResult(['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'], [])],
      ]),
    );

    const result = await getTableForeignKeys(query, 'users');

    expect(result).toEqual([]);
  });

  it('should return FKs for a specific table', async () => {
    const query = createMockQuery(
      new Map([
        [
          'PRAGMA foreign_key_list',
          mockResult(
            ['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'],
            [
              [0, 0, 'users', 'author_id', 'id', 'NO ACTION', 'CASCADE', 'NONE'],
              [1, 0, 'categories', 'category_id', 'id', 'NO ACTION', 'SET NULL', 'NONE'],
            ],
          ),
        ],
      ]),
    );

    const result = await getTableForeignKeys(query, 'posts');

    expect(result).toHaveLength(2);
    expect(result[0].childTable).toBe('posts');
    expect(result[0].parentTable).toBe('users');
    expect(result[1].parentTable).toBe('categories');
  });
});
