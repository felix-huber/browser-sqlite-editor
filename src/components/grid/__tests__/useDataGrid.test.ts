/**
 * Tests for useDataGrid hook and utilities
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from '@testing-library/react';
import {
  useDataGrid,
  createColumnDefs,
  generatePaginationClause,
  generatePaginatedQuery,
  generateOrderByClause,
  ROW_HEIGHT,
  DEFAULT_PAGE_SIZE,
  type PaginationState,
  type SortState,
} from '../useDataGrid';
import type { TableInfo, ColumnInfo } from '../../../types';

// =============================================================================
// Test Data
// =============================================================================

const mockColumn = (name: string, type: string, pk: number = 0): ColumnInfo => ({
  cid: 0,
  name,
  type,
  notnull: false,
  dfltValue: null,
  pk,
  generated: null,
  hidden: false,
});

const mockTableInfo: TableInfo = {
  name: 'users',
  isView: false,
  isVirtual: false,
  withoutRowid: false,
  columns: [
    mockColumn('id', 'INTEGER', 1),
    mockColumn('name', 'TEXT'),
    mockColumn('email', 'TEXT'),
    mockColumn('age', 'INTEGER'),
  ],
  indexes: [],
  createSql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, age INTEGER)',
};

const mockEmptyTableInfo: TableInfo = {
  name: 'empty',
  isView: false,
  isVirtual: false,
  withoutRowid: false,
  columns: [],
  indexes: [],
  createSql: 'CREATE TABLE empty ()',
};

// =============================================================================
// useDataGrid Hook Tests
// =============================================================================

describe('useDataGrid', () => {
  it('initializes with empty data', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.columns).toHaveLength(4);
    expect(result.current.table).toBeDefined();
  });

  it('returns isEmpty true when no tableInfo', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: null,
        data: [],
      }),
    );

    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.columns).toHaveLength(0);
  });

  it('returns isEmpty true when tableInfo has no columns', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockEmptyTableInfo,
        data: [],
      }),
    );

    expect(result.current.isEmpty).toBe(true);
    expect(result.current.columns).toHaveLength(0);
  });

  it('returns hasData true when data is provided', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [{ id: 1, name: 'Alice', email: 'alice@example.com', age: 30 }],
      }),
    );

    expect(result.current.hasData).toBe(true);
    expect(result.current.isEmpty).toBe(false);
  });

  it('passes isReadOnly to table meta', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
        isReadOnly: true,
      }),
    );

    expect(result.current.table.options.meta?.isReadOnly).toBe(true);
  });

  it('passes pagination to table meta', () => {
    const pagination: PaginationState = {
      cursorRowId: 50,
      pageSize: 25,
      direction: 'forward',
    };

    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
        pagination,
      }),
    );

    expect(result.current.table.options.meta?.pagination).toEqual(pagination);
  });

  it('sets rowHeight in table meta', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    expect(result.current.table.options.meta?.rowHeight).toBe(ROW_HEIGHT);
  });
});

// =============================================================================
// Column Definition Factory Tests
// =============================================================================

describe('createColumnDefs', () => {
  it('generates column definitions from TableInfo', () => {
    const columns = createColumnDefs(mockTableInfo);

    expect(columns).toHaveLength(4);
    expect(columns[0].id).toBe('id');
    expect(columns[0].header).toBe('id');
    expect(columns[1].id).toBe('name');
    expect(columns[2].id).toBe('email');
    expect(columns[3].id).toBe('age');
  });

  it('includes column metadata', () => {
    const columns = createColumnDefs(mockTableInfo);

    // First column is primary key
    expect(columns[0].meta?.isPrimaryKey).toBe(true);
    expect(columns[0].meta?.type).toBe('INTEGER');

    // Other columns are not primary keys
    expect(columns[1].meta?.isPrimaryKey).toBe(false);
    expect(columns[1].meta?.type).toBe('TEXT');
  });

  it('returns empty array for null tableInfo', () => {
    const columns = createColumnDefs(null);
    expect(columns).toHaveLength(0);
  });

  it('returns empty array for tableInfo with no columns', () => {
    const columns = createColumnDefs(mockEmptyTableInfo);
    expect(columns).toHaveLength(0);
  });

  it('handles generated columns', () => {
    const tableWithGenerated: TableInfo = {
      ...mockTableInfo,
      columns: [
        mockColumn('id', 'INTEGER', 1),
        {
          ...mockColumn('full_name', 'TEXT'),
          generated: 'stored',
        },
      ],
    };

    const columns = createColumnDefs(tableWithGenerated);

    expect(columns[1].meta?.isGenerated).toBe(true);
    expect(columns[1].meta?.generatedType).toBe('stored');
  });
});

// =============================================================================
// Pagination Tests
// =============================================================================

describe('generatePaginationClause', () => {
  it('generates simple LIMIT for first page', () => {
    const pagination: PaginationState = {
      cursorRowId: null,
      pageSize: 100,
      direction: 'forward',
    };

    const result = generatePaginationClause(pagination, 'users');

    expect(result.sql).toBe('LIMIT ?');
    expect(result.params).toEqual([100]);
  });

  it('generates cursor-based pagination for forward direction', () => {
    const pagination: PaginationState = {
      cursorRowId: 50,
      pageSize: 100,
      direction: 'forward',
    };

    const result = generatePaginationClause(pagination, 'users');

    expect(result.sql).toBe('WHERE rowid > ? ORDER BY rowid ASC LIMIT ?');
    expect(result.params).toEqual([50, 100]);
  });

  it('generates cursor-based pagination for backward direction', () => {
    const pagination: PaginationState = {
      cursorRowId: 150,
      pageSize: 100,
      direction: 'backward',
    };

    const result = generatePaginationClause(pagination, 'users');

    expect(result.sql).toBe('WHERE rowid < ? ORDER BY rowid DESC LIMIT ?');
    expect(result.params).toEqual([150, 100]);
  });

  it('uses simple LIMIT for WITHOUT ROWID tables', () => {
    const pagination: PaginationState = {
      cursorRowId: 50,
      pageSize: 100,
      direction: 'forward',
    };

    const result = generatePaginationClause(pagination, 'users', true);

    expect(result.sql).toBe('LIMIT ?');
    expect(result.params).toEqual([100]);
  });
});

describe('generatePaginatedQuery', () => {
  it('generates complete SELECT with pagination', () => {
    const pagination: PaginationState = {
      cursorRowId: null,
      pageSize: 50,
      direction: 'forward',
    };

    const result = generatePaginatedQuery('users', ['id', 'name', 'email'], pagination);

    expect(result.sql).toBe('SELECT rowid, "id", "name", "email" FROM "users" LIMIT ?');
    expect(result.params).toEqual([50]);
  });

  it('includes rowid in SELECT for cursor pagination', () => {
    const pagination: PaginationState = {
      cursorRowId: 100,
      pageSize: 25,
      direction: 'forward',
    };

    const result = generatePaginatedQuery('users', ['id', 'name'], pagination);

    expect(result.sql).toContain('SELECT rowid,');
    expect(result.sql).toContain('WHERE rowid > ?');
  });

  it('escapes table and column names', () => {
    const pagination: PaginationState = {
      cursorRowId: null,
      pageSize: 50,
      direction: 'forward',
    };

    const result = generatePaginatedQuery('user"table', ['col"name'], pagination);

    expect(result.sql).toContain('"user""table"');
    expect(result.sql).toContain('"col""name"');
  });

  it('excludes rowid for WITHOUT ROWID tables', () => {
    const pagination: PaginationState = {
      cursorRowId: null,
      pageSize: 50,
      direction: 'forward',
    };

    const result = generatePaginatedQuery('users', ['id', 'name'], pagination, true);

    expect(result.sql).toBe('SELECT "id", "name" FROM "users" LIMIT ?');
    expect(result.sql).not.toContain('rowid');
  });
});

// =============================================================================
// Sorting Tests
// =============================================================================

describe('generateOrderByClause', () => {
  it('returns empty string for empty sort state', () => {
    const result = generateOrderByClause([]);
    expect(result).toBe('');
  });

  it('generates single column ORDER BY ASC', () => {
    const sortState: SortState = [{ column: 'name', direction: 'asc' }];
    const result = generateOrderByClause(sortState);
    expect(result).toBe('"name" ASC');
  });

  it('generates single column ORDER BY DESC', () => {
    const sortState: SortState = [{ column: 'age', direction: 'desc' }];
    const result = generateOrderByClause(sortState);
    expect(result).toBe('"age" DESC');
  });

  it('generates multi-column ORDER BY', () => {
    const sortState: SortState = [
      { column: 'name', direction: 'asc' },
      { column: 'age', direction: 'desc' },
    ];
    const result = generateOrderByClause(sortState);
    expect(result).toBe('"name" ASC, "age" DESC');
  });

  it('escapes column names with quotes', () => {
    const sortState: SortState = [{ column: 'column"name', direction: 'asc' }];
    const result = generateOrderByClause(sortState);
    expect(result).toBe('"column""name" ASC');
  });
});

describe('generatePaginatedQuery with sorting', () => {
  it('includes ORDER BY clause when sort state is provided', () => {
    const pagination: PaginationState = {
      cursorRowId: null,
      pageSize: 50,
      direction: 'forward',
    };
    const sortState: SortState = [{ column: 'name', direction: 'asc' }];

    const result = generatePaginatedQuery('users', ['id', 'name'], pagination, false, sortState);

    expect(result.sql).toContain('ORDER BY "name" ASC');
    expect(result.sql).toContain('LIMIT ?');
  });

  it('includes multi-column ORDER BY', () => {
    const pagination: PaginationState = {
      cursorRowId: null,
      pageSize: 50,
      direction: 'forward',
    };
    const sortState: SortState = [
      { column: 'name', direction: 'asc' },
      { column: 'age', direction: 'desc' },
    ];

    const result = generatePaginatedQuery('users', ['id', 'name', 'age'], pagination, false, sortState);

    expect(result.sql).toContain('ORDER BY "name" ASC, "age" DESC');
  });
});

describe('useDataGrid sorting', () => {
  it('initializes with empty sort state', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    expect(result.current.sortState).toEqual([]);
  });

  it('handles single click to sort ASC', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    act(() => {
      result.current.handleSortClick('name', false);
    });

    expect(result.current.sortState).toEqual([{ column: 'name', direction: 'asc' }]);
    expect(result.current.getSortDirection('name')).toBe('asc');
  });

  it('handles second click to sort DESC', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    act(() => {
      result.current.handleSortClick('name', false);
    });

    act(() => {
      result.current.handleSortClick('name', false);
    });

    expect(result.current.sortState).toEqual([{ column: 'name', direction: 'desc' }]);
    expect(result.current.getSortDirection('name')).toBe('desc');
  });

  it('handles third click to remove sort', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    act(() => {
      result.current.handleSortClick('name', false);
    });

    act(() => {
      result.current.handleSortClick('name', false);
    });

    act(() => {
      result.current.handleSortClick('name', false);
    });

    expect(result.current.sortState).toEqual([]);
    expect(result.current.getSortDirection('name')).toBeNull();
  });

  it('handles shift+click to add secondary sort', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    // First click - primary sort
    act(() => {
      result.current.handleSortClick('name', false);
    });

    // Shift+click - add secondary sort
    act(() => {
      result.current.handleSortClick('age', true);
    });

    expect(result.current.sortState).toEqual([
      { column: 'name', direction: 'asc' },
      { column: 'age', direction: 'asc' },
    ]);
  });

  it('returns sort index for multi-column sort', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    act(() => {
      result.current.handleSortClick('name', false);
    });

    act(() => {
      result.current.handleSortClick('age', true);
    });

    expect(result.current.getSortIndex('name')).toBe(1);
    expect(result.current.getSortIndex('age')).toBe(2);
    expect(result.current.getSortIndex('email')).toBeNull();
  });

  it('returns null sort index for single-column sort', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    act(() => {
      result.current.handleSortClick('name', false);
    });

    // For single column sort, index should be null (not displayed)
    expect(result.current.getSortIndex('name')).toBeNull();
  });

  it('uses external sort state when provided', () => {
    const externalSortState: SortState = [{ column: 'email', direction: 'desc' }];

    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
        sortState: externalSortState,
      }),
    );

    expect(result.current.sortState).toEqual(externalSortState);
    expect(result.current.getSortDirection('email')).toBe('desc');
  });

  it('calls onSortChange when sort changes with external state', () => {
    const onSortChange = vi.fn();
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
        onSortChange,
      }),
    );

    act(() => {
      result.current.handleSortClick('name', false);
    });

    expect(onSortChange).toHaveBeenCalledWith([{ column: 'name', direction: 'asc' }]);
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe('Constants', () => {
  it('ROW_HEIGHT is 32px', () => {
    expect(ROW_HEIGHT).toBe(32);
  });

  it('DEFAULT_PAGE_SIZE is 100', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(100);
  });
});
