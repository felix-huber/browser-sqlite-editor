/**
 * useDataGrid Hook
 *
 * Wraps TanStack Table's useReactTable with SQLite-specific configuration.
 * Provides:
 * - Column definitions from TableInfo schema
 * - Cursor-based pagination model (rowid-based)
 * - Virtual scrolling support via row height configuration
 */

import { useMemo } from 'react';
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
 * Generate complete SELECT query with pagination
 */
export function generatePaginatedQuery(
  tableName: string,
  columns: string[],
  pagination: PaginationState,
  withoutRowid: boolean = false,
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

  const sql = `SELECT ${selectColumns} FROM ${escapedTable} ${paginationSql}`;

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
  const { tableInfo, data, isReadOnly = false, pagination } = options;

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

  return {
    table,
    columns,
    hasData,
    isEmpty,
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
