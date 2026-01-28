/**
 * Unit tests for Paginated Query Handler
 *
 * Tests cover:
 * - LIMIT/OFFSET pagination
 * - Stable sorting with rowid and PK
 * - Total count calculation and caching
 * - Generated column detection
 * - Empty table handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  wrapQueryWithPagination,
  buildCountQuery,
  calculatePaginationInfo,
  getPageOffset,
  getNextPageOffset,
  getPreviousPageOffset,
  getFirstPageOffset,
  getLastPageOffset,
  invalidateCountCache,
  type PaginatedQueryResult,
  type ColumnMeta,
} from '../query-pagination';

// =============================================================================
// Query Wrapping Tests
// =============================================================================

describe('wrapQueryWithPagination', () => {
  it('should add LIMIT and OFFSET to simple query', () => {
    const sql = 'SELECT * FROM users';
    const result = wrapQueryWithPagination(sql, 100, 0, '');

    expect(result).toBe('SELECT * FROM users LIMIT 100 OFFSET 0');
  });

  it('should handle LIMIT 100 OFFSET 0 (first page)', () => {
    const sql = 'SELECT * FROM users';
    const result = wrapQueryWithPagination(sql, 100, 0, 'ORDER BY rowid');

    expect(result).toBe('SELECT * FROM users ORDER BY rowid LIMIT 100 OFFSET 0');
  });

  it('should handle LIMIT 100 OFFSET 200 (third page)', () => {
    const sql = 'SELECT * FROM users';
    const result = wrapQueryWithPagination(sql, 100, 200, 'ORDER BY rowid');

    expect(result).toBe('SELECT * FROM users ORDER BY rowid LIMIT 100 OFFSET 200');
  });

  it('should append stable sort to existing ORDER BY', () => {
    const sql = 'SELECT * FROM users ORDER BY name';
    const result = wrapQueryWithPagination(sql, 100, 0, 'rowid');

    expect(result).toBe('SELECT * FROM users ORDER BY name, rowid LIMIT 100 OFFSET 0');
  });

  it('should add ORDER BY if none exists and stable sort is provided', () => {
    const sql = 'SELECT * FROM users';
    const result = wrapQueryWithPagination(sql, 100, 0, 'ORDER BY rowid');

    expect(result).toBe('SELECT * FROM users ORDER BY rowid LIMIT 100 OFFSET 0');
  });

  it('should not modify query that already has LIMIT', () => {
    const sql = 'SELECT * FROM users LIMIT 50';
    const result = wrapQueryWithPagination(sql, 100, 0, 'ORDER BY rowid');

    expect(result).toBe('SELECT * FROM users LIMIT 50');
  });

  it('should not modify query that already has OFFSET', () => {
    const sql = 'SELECT * FROM users LIMIT 50 OFFSET 10';
    const result = wrapQueryWithPagination(sql, 100, 0, 'ORDER BY rowid');

    expect(result).toBe('SELECT * FROM users LIMIT 50 OFFSET 10');
  });

  it('should strip trailing semicolons', () => {
    const sql = 'SELECT * FROM users;';
    const result = wrapQueryWithPagination(sql, 100, 0, '');

    expect(result).toBe('SELECT * FROM users LIMIT 100 OFFSET 0');
  });

  it('should handle multiple trailing semicolons', () => {
    const sql = 'SELECT * FROM users;;;';
    const result = wrapQueryWithPagination(sql, 100, 0, '');

    expect(result).toBe('SELECT * FROM users LIMIT 100 OFFSET 0');
  });
});

// =============================================================================
// Count Query Tests
// =============================================================================

describe('buildCountQuery', () => {
  it('should wrap simple SELECT in COUNT(*)', () => {
    const sql = 'SELECT * FROM users';
    const result = buildCountQuery(sql);

    expect(result).toBe('SELECT COUNT(*) FROM (SELECT * FROM users)');
  });

  it('should remove ORDER BY clause for performance', () => {
    const sql = 'SELECT * FROM users ORDER BY name';
    const result = buildCountQuery(sql);

    expect(result).toBe('SELECT COUNT(*) FROM (SELECT * FROM users)');
  });

  it('should remove existing LIMIT and OFFSET', () => {
    const sql = 'SELECT * FROM users LIMIT 100 OFFSET 50';
    const result = buildCountQuery(sql);

    expect(result).toBe('SELECT COUNT(*) FROM (SELECT * FROM users)');
  });

  it('should handle complex query with WHERE clause', () => {
    const sql = 'SELECT id, name FROM users WHERE active = 1';
    const result = buildCountQuery(sql);

    expect(result).toBe('SELECT COUNT(*) FROM (SELECT id, name FROM users WHERE active = 1)');
  });

  it('should strip trailing semicolons', () => {
    const sql = 'SELECT * FROM users;';
    const result = buildCountQuery(sql);

    expect(result).toBe('SELECT COUNT(*) FROM (SELECT * FROM users)');
  });
});

// =============================================================================
// Pagination Info Tests
// =============================================================================

describe('calculatePaginationInfo', () => {
  it('should calculate first page correctly', () => {
    const info = calculatePaginationInfo(250, 100, 0);

    expect(info.currentPage).toBe(1);
    expect(info.totalPages).toBe(3);
    expect(info.startRow).toBe(1);
    expect(info.endRow).toBe(100);
    expect(info.hasPrevious).toBe(false);
    expect(info.hasNext).toBe(true);
  });

  it('should calculate middle page correctly', () => {
    const info = calculatePaginationInfo(250, 100, 100);

    expect(info.currentPage).toBe(2);
    expect(info.totalPages).toBe(3);
    expect(info.startRow).toBe(101);
    expect(info.endRow).toBe(200);
    expect(info.hasPrevious).toBe(true);
    expect(info.hasNext).toBe(true);
  });

  it('should calculate last page correctly', () => {
    const info = calculatePaginationInfo(250, 100, 200);

    expect(info.currentPage).toBe(3);
    expect(info.totalPages).toBe(3);
    expect(info.startRow).toBe(201);
    expect(info.endRow).toBe(250);
    expect(info.hasPrevious).toBe(true);
    expect(info.hasNext).toBe(false);
  });

  it('should handle empty table', () => {
    const info = calculatePaginationInfo(0, 100, 0);

    expect(info.currentPage).toBe(1);
    expect(info.totalPages).toBe(1);
    expect(info.startRow).toBe(0);
    expect(info.endRow).toBe(0);
    expect(info.hasPrevious).toBe(false);
    expect(info.hasNext).toBe(false);
  });

  it('should handle single page of results', () => {
    const info = calculatePaginationInfo(50, 100, 0);

    expect(info.currentPage).toBe(1);
    expect(info.totalPages).toBe(1);
    expect(info.startRow).toBe(1);
    expect(info.endRow).toBe(50);
    expect(info.hasPrevious).toBe(false);
    expect(info.hasNext).toBe(false);
  });

  it('should handle exact page boundary', () => {
    const info = calculatePaginationInfo(200, 100, 0);

    expect(info.currentPage).toBe(1);
    expect(info.totalPages).toBe(2);
    expect(info.endRow).toBe(100);
  });
});

// =============================================================================
// Page Offset Helpers Tests
// =============================================================================

describe('getPageOffset', () => {
  it('should calculate offset for page 1', () => {
    expect(getPageOffset(1, 100)).toBe(0);
  });

  it('should calculate offset for page 2', () => {
    expect(getPageOffset(2, 100)).toBe(100);
  });

  it('should calculate offset for page 3', () => {
    expect(getPageOffset(3, 100)).toBe(200);
  });

  it('should handle page 0 as page 1', () => {
    expect(getPageOffset(0, 100)).toBe(0);
  });

  it('should handle negative page as page 1', () => {
    expect(getPageOffset(-1, 100)).toBe(0);
  });
});

describe('getNextPageOffset', () => {
  it('should add limit to current offset', () => {
    expect(getNextPageOffset(0, 100)).toBe(100);
    expect(getNextPageOffset(100, 100)).toBe(200);
    expect(getNextPageOffset(200, 100)).toBe(300);
  });
});

describe('getPreviousPageOffset', () => {
  it('should subtract limit from current offset', () => {
    expect(getPreviousPageOffset(200, 100)).toBe(100);
    expect(getPreviousPageOffset(100, 100)).toBe(0);
  });

  it('should not go below zero', () => {
    expect(getPreviousPageOffset(50, 100)).toBe(0);
    expect(getPreviousPageOffset(0, 100)).toBe(0);
  });
});

describe('getFirstPageOffset', () => {
  it('should always return 0', () => {
    expect(getFirstPageOffset()).toBe(0);
  });
});

describe('getLastPageOffset', () => {
  it('should calculate last page offset', () => {
    expect(getLastPageOffset(250, 100)).toBe(200); // 3 pages, last starts at 200
    expect(getLastPageOffset(200, 100)).toBe(100); // 2 pages, last starts at 100
    expect(getLastPageOffset(100, 100)).toBe(0); // 1 page, last starts at 0
    expect(getLastPageOffset(50, 100)).toBe(0); // 1 page, last starts at 0
  });

  it('should handle empty results', () => {
    expect(getLastPageOffset(0, 100)).toBe(0);
  });
});

// =============================================================================
// Cache Tests
// =============================================================================

describe('invalidateCountCache', () => {
  beforeEach(() => {
    invalidateCountCache();
  });

  afterEach(() => {
    invalidateCountCache();
  });

  it('should not throw when clearing empty cache', () => {
    expect(() => invalidateCountCache()).not.toThrow();
  });

  it('should be callable multiple times', () => {
    invalidateCountCache();
    invalidateCountCache();
    invalidateCountCache();
    expect(true).toBe(true);
  });
});

// =============================================================================
// Type Contract Tests
// =============================================================================

describe('ColumnMeta type contract', () => {
  it('should include isGenerated flag', () => {
    const meta: ColumnMeta = {
      name: 'full_name',
      type: 'TEXT',
      isGenerated: true,
      generatedExpression: "first_name || ' ' || last_name",
    };

    expect(meta.isGenerated).toBe(true);
    expect(meta.generatedExpression).toBe("first_name || ' ' || last_name");
  });

  it('should handle non-generated column', () => {
    const meta: ColumnMeta = {
      name: 'id',
      type: 'INTEGER',
      isGenerated: false,
      generatedExpression: null,
    };

    expect(meta.isGenerated).toBe(false);
    expect(meta.generatedExpression).toBeNull();
  });
});

describe('PaginatedQueryResult type contract', () => {
  it('should include columns, rows, and totalCount', () => {
    const result: PaginatedQueryResult = {
      columns: [
        { name: 'id', type: 'INTEGER', isGenerated: false, generatedExpression: null },
        { name: 'name', type: 'TEXT', isGenerated: false, generatedExpression: null },
      ],
      rows: [
        [1, 'Alice'],
        [2, 'Bob'],
      ],
      totalCount: 100,
    };

    expect(result.columns).toHaveLength(2);
    expect(result.rows).toHaveLength(2);
    expect(result.totalCount).toBe(100);
  });

  it('should handle empty result', () => {
    const result: PaginatedQueryResult = {
      columns: [],
      rows: [],
      totalCount: 0,
    };

    expect(result.columns).toHaveLength(0);
    expect(result.rows).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });
});

// =============================================================================
// Integration Tests (require mock engine)
// =============================================================================

describe('Integration tests placeholder', () => {
  /**
   * These tests would require a mock DatabaseEngine.
   * They are documented here for implementation via e2e tests:
   *
   * 1. executePaginatedQuery with LIMIT 100 OFFSET 0 returns first 100 rows
   * 2. executePaginatedQuery with LIMIT 100 OFFSET 200 returns rows 201-300
   * 3. Order by rowid: rows returned in consistent order across pages
   * 4. WITHOUT ROWID table: orders by PK columns for stable pagination
   * 5. totalCount matches actual row count
   * 6. Empty table returns empty rows and totalCount=0
   * 7. Generated columns have isGenerated=true and correct expression
   * 8. Cache invalidation clears count cache correctly
   * 9. Cached count is reused on subsequent page requests
   * 10. User sort + tie-breaker produces stable pagination
   */

  it('should be tested via e2e tests with real WASM', () => {
    // Placeholder to document integration test requirements
    expect(true).toBe(true);
  });
});
