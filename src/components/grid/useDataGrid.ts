/**
 * useDataGrid Hook
 *
 * Wraps TanStack Table's useReactTable with SQLite-specific configuration.
 * Provides:
 * - Column definitions from TableInfo schema
 * - Cursor-based pagination model (rowid-based)
 * - Virtual scrolling support via row height configuration
 */

import { useMemo, useState, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
  type Table,
  type RowData,
} from '@tanstack/react-table';
import type { TableInfo, ColumnInfo } from '../../types';

// =============================================================================
// Constants
// =============================================================================

/** Fixed row height in pixels for virtualizer calculations */
export const ROW_HEIGHT = 32;

/** Default page size for cursor-based pagination */
export const DEFAULT_PAGE_SIZE = 100;

// =============================================================================
// Types
// =============================================================================

/** A single cell value in the grid */
export type CellValue = null | number | string | Uint8Array;

/** A row of data as a record of column name -> value */
export type DataRow = Record<string, CellValue>;

/** Cursor-based pagination state */
export interface PaginationState {
  /** The rowid to start from (null for first page) */
  cursorRowId: number | null;
  /** Number of rows per page */
  pageSize: number;
  /** Direction of cursor traversal */
  direction: 'forward' | 'backward';
}

/** Sort direction for a column */
export type SortDirection = 'asc' | 'desc';

/** Single column sort specification */
export interface ColumnSort {
  /** Column name to sort by */
  column: string;
  /** Sort direction */
  direction: SortDirection;
}

/** Sort state as array for multi-column support */
export type SortState = ColumnSort[];

/** Options for useDataGrid hook */
export interface UseDataGridOptions {
  /** Table schema information */
  tableInfo: TableInfo | null;
  /** Data rows to display */
  data: DataRow[];
  /** Whether the grid is in read-only mode */
  isReadOnly?: boolean;
  /** Pagination state */
  pagination?: PaginationState;
  /** Sort state for columns */
  sortState?: SortState;
  /** Called when sort state changes */
  onSortChange?: (sortState: SortState) => void;
}

/** Return type for useDataGrid hook */
export interface UseDataGridResult {
  /** TanStack Table instance */
  table: Table<DataRow>;
  /** Column definitions derived from schema */
  columns: ColumnDef<DataRow, CellValue>[];
  /** Whether the table has data */
  hasData: boolean;
  /** Whether the grid is empty (no schema) */
  isEmpty: boolean;
  /** Current sort state */
  sortState: SortState;
  /** Handle column header click for sorting */
  handleSortClick: (columnId: string, addToSort: boolean) => void;
  /** Get sort direction for a column */
  getSortDirection: (columnId: string) => SortDirection | null;
  /** Get sort index for multi-column sort (1-based, null if not sorted) */
  getSortIndex: (columnId: string) => number | null;
}

// =============================================================================
// Column Definition Factory
// =============================================================================

/**
 * Generate column definitions from TableInfo schema
 *
 * Creates TanStack Table column definitions with:
 * - Accessor based on column name
 * - Header showing column name
 * - Type information for cell rendering
 */
export function createColumnDefs(tableInfo: TableInfo | null): ColumnDef<DataRow, CellValue>[] {
  if (!tableInfo || tableInfo.columns.length === 0) {
    return [];
  }

  return tableInfo.columns.map((col: ColumnInfo) => ({
    id: col.name,
    accessorKey: col.name,
    header: col.name,
    meta: {
      type: col.type,
      isPrimaryKey: col.pk > 0,
      isNotNull: col.notnull,
      isGenerated: col.generated !== null,
      generatedType: col.generated,
    },
  }));
}

// =============================================================================
// Pagination Utilities
// =============================================================================

/**
 * Generate ORDER BY clause from sort state
 *
 * @param sortState - Array of column sort specifications
 * @returns SQL ORDER BY clause (without ORDER BY prefix) or empty string
 */
export function generateOrderByClause(sortState: SortState): string {
  if (sortState.length === 0) {
    return '';
  }

  return sortState
    .map(({ column, direction }) => {
      const escapedColumn = `"${column.replace(/"/g, '""')}"`;
      return `${escapedColumn} ${direction.toUpperCase()}`;
    })
    .join(', ');
}

/**
 * Generate SQL LIMIT/OFFSET clause for cursor-based pagination
 *
 * Uses rowid for cursor-based pagination which is more efficient than
 * OFFSET for large datasets. Falls back to LIMIT/OFFSET if table is
 * WITHOUT ROWID.
 */
export function generatePaginationClause(
  pagination: PaginationState,
  _tableName: string,
  withoutRowid: boolean = false,
): { sql: string; params: unknown[] } {
  const { cursorRowId, pageSize, direction } = pagination;

  // For WITHOUT ROWID tables or first page, use simple LIMIT
  if (withoutRowid || cursorRowId === null) {
    return {
      sql: `LIMIT ?`,
      params: [pageSize],
    };
  }

  // Cursor-based pagination using rowid
  const comparator = direction === 'forward' ? '>' : '<';
  const order = direction === 'forward' ? 'ASC' : 'DESC';

  return {
    sql: `WHERE rowid ${comparator} ? ORDER BY rowid ${order} LIMIT ?`,
    params: [cursorRowId, pageSize],
  };
}

/**
 * Generate complete SELECT query with pagination and sorting
 */
export function generatePaginatedQuery(
  tableName: string,
  columns: string[],
  pagination: PaginationState,
  withoutRowid: boolean = false,
  sortState: SortState = [],
): { sql: string; params: unknown[] } {
  const escapedTable = `"${tableName.replace(/"/g, '""')}"`;
  const escapedColumns = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');

  const { sql: paginationSql, params } = generatePaginationClause(
    pagination,
    tableName,
    withoutRowid,
  );

  // Include rowid for cursor pagination (if not WITHOUT ROWID)
  const selectColumns = withoutRowid ? escapedColumns : `rowid, ${escapedColumns}`;

  // Generate ORDER BY clause
  const orderBy = generateOrderByClause(sortState);
  const orderByClause = orderBy ? `ORDER BY ${orderBy}` : '';

  // Build the query - ORDER BY comes before LIMIT
  let sql = `SELECT ${selectColumns} FROM ${escapedTable}`;

  // Handle WHERE clause from pagination (if using cursor)
  if (paginationSql.startsWith('WHERE')) {
    const parts = paginationSql.split('ORDER BY');
    sql += ` ${parts[0].trim()}`;
    if (orderBy) {
      sql += ` ${orderByClause}`;
    } else if (parts[1]) {
      sql += ` ORDER BY ${parts[1].split('LIMIT')[0].trim()}`;
    }
    sql += ` LIMIT ?`;
  } else {
    if (orderBy) {
      sql += ` ${orderByClause}`;
    }
    sql += ` ${paginationSql}`;
  }

  return { sql, params };
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook wrapping TanStack Table for SQLite data display
 *
 * @param options - Configuration options
 * @returns Table instance and derived state
 */
export function useDataGrid(options: UseDataGridOptions): UseDataGridResult {
  const { tableInfo, data, isReadOnly = false, pagination, sortState: externalSortState, onSortChange } = options;

  // Internal sort state (used if no external state provided)
  const [internalSortState, setInternalSortState] = useState<SortState>([]);

  // Use external sort state if provided, otherwise use internal
  const sortState = externalSortState ?? internalSortState;

  // Generate column definitions from schema
  const columns = useMemo(() => createColumnDefs(tableInfo), [tableInfo]);

  // Create table instance
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      isReadOnly,
      pagination,
      rowHeight: ROW_HEIGHT,
    },
  });

  const hasData = data.length > 0;
  const isEmpty = !tableInfo || tableInfo.columns.length === 0;

  /**
   * Handle column header click for sorting
   * Click cycles: unsorted → ASC → DESC → unsorted
   * Shift+click adds to multi-column sort
   */
  const handleSortClick = useCallback(
    (columnId: string, addToSort: boolean) => {
      const updateSortState = (newState: SortState) => {
        if (onSortChange) {
          onSortChange(newState);
        } else {
          setInternalSortState(newState);
        }
      };

      const existingIndex = sortState.findIndex((s) => s.column === columnId);

      if (addToSort) {
        // Shift+click: add to multi-column sort
        if (existingIndex >= 0) {
          const existing = sortState[existingIndex];
          if (existing.direction === 'asc') {
            // ASC → DESC
            const newState = [...sortState];
            newState[existingIndex] = { ...existing, direction: 'desc' };
            updateSortState(newState);
          } else {
            // DESC → remove from sort
            const newState = sortState.filter((_, i) => i !== existingIndex);
            updateSortState(newState);
          }
        } else {
          // Add new column to sort
          updateSortState([...sortState, { column: columnId, direction: 'asc' }]);
        }
      } else {
        // Regular click: single column sort
        if (existingIndex >= 0 && sortState.length === 1) {
          const existing = sortState[0];
          if (existing.direction === 'asc') {
            // ASC → DESC
            updateSortState([{ column: columnId, direction: 'desc' }]);
          } else {
            // DESC → unsorted
            updateSortState([]);
          }
        } else {
          // Start new sort (replace existing)
          updateSortState([{ column: columnId, direction: 'asc' }]);
        }
      }
    },
    [sortState, onSortChange]
  );

  /**
   * Get sort direction for a column
   */
  const getSortDirection = useCallback(
    (columnId: string): SortDirection | null => {
      const sort = sortState.find((s) => s.column === columnId);
      return sort?.direction ?? null;
    },
    [sortState]
  );

  /**
   * Get sort index for multi-column sort (1-based, null if not sorted)
   */
  const getSortIndex = useCallback(
    (columnId: string): number | null => {
      if (sortState.length <= 1) return null;
      const index = sortState.findIndex((s) => s.column === columnId);
      return index >= 0 ? index + 1 : null;
    },
    [sortState]
  );

  return {
    table,
    columns,
    hasData,
    isEmpty,
    sortState,
    handleSortClick,
    getSortDirection,
    getSortIndex,
  };
}

// =============================================================================
// Module augmentation for TanStack Table meta types
// =============================================================================

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    type?: string;
    isPrimaryKey?: boolean;
    isNotNull?: boolean;
    isGenerated?: boolean;
    generatedType?: 'stored' | 'virtual' | null;
  }

  interface TableMeta<TData extends RowData> {
    isReadOnly?: boolean;
    pagination?: PaginationState;
    rowHeight?: number;
  }
}
