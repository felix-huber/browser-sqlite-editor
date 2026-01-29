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

// =============================================================================
// Filter Types
// =============================================================================

/** Text filter operators */
export type TextFilterOperator = 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'is_empty' | 'is_not_empty';

/** Numeric filter operators */
export type NumericFilterOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'between';

/** Null filter operators */
export type NullFilterOperator = 'is_null' | 'is_not_null';

/** Combined filter operator type */
export type FilterOperator = TextFilterOperator | NumericFilterOperator | NullFilterOperator;

/** Single column filter specification */
export interface ColumnFilter {
  /** Column name to filter */
  column: string;
  /** Filter operator */
  operator: FilterOperator;
  /** Primary filter value (text search or numeric comparison) */
  value?: string | number;
  /** Secondary value for 'between' operator */
  value2?: number;
}

/** Filter state as array for multiple column filters */
export type FilterState = ColumnFilter[];

// =============================================================================
// Edit State Types
// =============================================================================

/** Edit state for a single cell */
export interface CellEditState {
  /** Row index being edited */
  rowIndex: number;
  /** Column name being edited */
  columnName: string;
  /** Original value before edit */
  originalValue: CellValue;
  /** Current edited value (as string for input) */
  currentValue: string;
  /** Whether the value has been modified */
  isDirty: boolean;
}

/** Result of attempting to start cell edit */
export interface EditAttemptResult {
  /** Whether edit mode was entered */
  allowed: boolean;
  /** Reason if not allowed */
  blockedReason?: 'read-only' | 'generated-column' | 'blob-column';
  /** Message to display to user */
  message?: string;
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
  /** Sort state for columns */
  sortState?: SortState;
  /** Called when sort state changes */
  onSortChange?: (sortState: SortState) => void;
  /** Called when a cell edit is committed */
  onCellEdit?: (rowIndex: number, columnName: string, newValue: CellValue) => Promise<boolean>;
  /** Called when edit mode changes (for tracking unsaved edits) */
  onEditStateChange?: (isEditing: boolean) => void;
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
  /** Current cell edit state (null if not editing) */
  editState: CellEditState | null;
  /** Attempt to start editing a cell */
  startEdit: (rowIndex: number, columnName: string) => EditAttemptResult;
  /** Update the current edit value */
  updateEditValue: (value: string) => void;
  /** Commit the current edit (save) */
  commitEdit: () => Promise<boolean>;
  /** Cancel the current edit (discard) */
  cancelEdit: () => void;
  /** Check if a column is editable */
  isColumnEditable: (columnName: string) => boolean;
  /** Whether grid is in read-only mode */
  isReadOnly: boolean;
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
// Filter Utilities
// =============================================================================

/**
 * Escape special characters in LIKE patterns
 * SQLite LIKE special chars: % (any chars), _ (single char), \ (escape char)
 */
export function escapeLike(value: string): string {
  return value
    .replace(/\\/g, '\\\\') // Escape backslash first
    .replace(/%/g, '\\%')   // Escape percent
    .replace(/_/g, '\\_');  // Escape underscore
}

/**
 * Generate WHERE clause fragment for a single filter
 * Returns the SQL condition and any parameter values
 */
export function generateFilterClause(filter: ColumnFilter): { sql: string; params: unknown[] } {
  const escapedColumn = `"${filter.column.replace(/"/g, '""')}"`;

  switch (filter.operator) {
    // Text operators
    case 'contains':
      return {
        sql: `${escapedColumn} LIKE ? ESCAPE '\\'`,
        params: [`%${escapeLike(String(filter.value ?? ''))}%`],
      };
    case 'equals':
      return {
        sql: `${escapedColumn} = ?`,
        params: [filter.value ?? ''],
      };
    case 'starts_with':
      return {
        sql: `${escapedColumn} LIKE ? ESCAPE '\\'`,
        params: [`${escapeLike(String(filter.value ?? ''))}%`],
      };
    case 'ends_with':
      return {
        sql: `${escapedColumn} LIKE ? ESCAPE '\\'`,
        params: [`%${escapeLike(String(filter.value ?? ''))}`],
      };
    case 'is_empty':
      return {
        sql: `(${escapedColumn} = '' OR ${escapedColumn} IS NULL)`,
        params: [],
      };
    case 'is_not_empty':
      return {
        sql: `(${escapedColumn} != '' AND ${escapedColumn} IS NOT NULL)`,
        params: [],
      };

    // Numeric operators
    case 'eq':
      return {
        sql: `${escapedColumn} = ?`,
        params: [filter.value],
      };
    case 'neq':
      return {
        sql: `${escapedColumn} != ?`,
        params: [filter.value],
      };
    case 'gt':
      return {
        sql: `${escapedColumn} > ?`,
        params: [filter.value],
      };
    case 'lt':
      return {
        sql: `${escapedColumn} < ?`,
        params: [filter.value],
      };
    case 'gte':
      return {
        sql: `${escapedColumn} >= ?`,
        params: [filter.value],
      };
    case 'lte':
      return {
        sql: `${escapedColumn} <= ?`,
        params: [filter.value],
      };
    case 'between':
      return {
        sql: `${escapedColumn} BETWEEN ? AND ?`,
        params: [filter.value, filter.value2],
      };

    // Null operators
    case 'is_null':
      return {
        sql: `${escapedColumn} IS NULL`,
        params: [],
      };
    case 'is_not_null':
      return {
        sql: `${escapedColumn} IS NOT NULL`,
        params: [],
      };

    default:
      return { sql: '', params: [] };
  }
}

/**
 * Generate complete WHERE clause from filter state
 * Combines multiple filters with AND
 */
export function generateWhereClause(filterState: FilterState): { sql: string; params: unknown[] } {
  if (filterState.length === 0) {
    return { sql: '', params: [] };
  }

  const clauses: string[] = [];
  const allParams: unknown[] = [];

  for (const filter of filterState) {
    const { sql, params } = generateFilterClause(filter);
    if (sql) {
      clauses.push(sql);
      allParams.push(...params);
    }
  }

  if (clauses.length === 0) {
    return { sql: '', params: [] };
  }

  return {
    sql: `WHERE ${clauses.join(' AND ')}`,
    params: allParams,
  };
}

/**
 * Determine column type category for filter options
 */
export function getColumnTypeCategory(type: string): 'text' | 'numeric' | 'blob' {
  if (!type) return 'text';

  const upperType = type.toUpperCase().split('(')[0].trim();

  // Numeric types
  if (['INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'REAL', 'FLOAT', 'DOUBLE', 'NUMERIC', 'DECIMAL'].includes(upperType)) {
    return 'numeric';
  }

  // Blob types
  if (upperType === 'BLOB') {
    return 'blob';
  }

  // Default to text
  return 'text';
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
  const {
    tableInfo,
    data,
    isReadOnly = false,
    pagination,
    sortState: externalSortState,
    onSortChange,
    onCellEdit,
    onEditStateChange,
  } = options;

  // Internal sort state (used if no external state provided)
  const [internalSortState, setInternalSortState] = useState<SortState>([]);

  // Edit state for inline cell editing
  const [editState, setEditState] = useState<CellEditState | null>(null);

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

  /**
   * Check if a column is editable (not generated, not BLOB)
   */
  const isColumnEditable = useCallback(
    (columnName: string): boolean => {
      if (!tableInfo) return false;
      const column = tableInfo.columns.find((c) => c.name === columnName);
      if (!column) return false;
      // Generated columns cannot be edited
      if (column.generated !== null) return false;
      // BLOB columns cannot be edited inline
      if (column.type.toUpperCase() === 'BLOB') return false;
      return true;
    },
    [tableInfo]
  );

  /**
   * Attempt to start editing a cell
   */
  const startEdit = useCallback(
    (rowIndex: number, columnName: string): EditAttemptResult => {
      // Check read-only mode
      if (isReadOnly) {
        return {
          allowed: false,
          blockedReason: 'read-only',
          message: 'Database is read-only',
        };
      }

      // Check column info
      if (!tableInfo) {
        return { allowed: false, blockedReason: 'read-only', message: 'No table selected' };
      }

      const column = tableInfo.columns.find((c) => c.name === columnName);
      if (!column) {
        return { allowed: false, blockedReason: 'read-only', message: 'Column not found' };
      }

      // Check if generated column
      if (column.generated !== null) {
        return {
          allowed: false,
          blockedReason: 'generated-column',
          message: 'Generated columns cannot be edited',
        };
      }

      // Check if BLOB column
      if (column.type.toUpperCase() === 'BLOB') {
        return {
          allowed: false,
          blockedReason: 'blob-column',
          message: 'BLOB columns cannot be edited inline',
        };
      }

      // Get the current value
      const row = data[rowIndex];
      if (!row) {
        return { allowed: false, blockedReason: 'read-only', message: 'Row not found' };
      }

      const originalValue = row[columnName] as CellValue;
      const currentValue = originalValue === null ? '' : String(originalValue);

      // Enter edit mode
      setEditState({
        rowIndex,
        columnName,
        originalValue,
        currentValue,
        isDirty: false,
      });

      // Notify parent
      onEditStateChange?.(true);

      return { allowed: true };
    },
    [isReadOnly, tableInfo, data, onEditStateChange]
  );

  /**
   * Update the current edit value
   */
  const updateEditValue = useCallback((value: string) => {
    setEditState((prev) => {
      if (!prev) return null;
      const originalString = prev.originalValue === null ? '' : String(prev.originalValue);
      return {
        ...prev,
        currentValue: value,
        isDirty: value !== originalString,
      };
    });
  }, []);

  /**
   * Commit the current edit (save)
   */
  const commitEdit = useCallback(async (): Promise<boolean> => {
    if (!editState) return false;
    if (!editState.isDirty) {
      // No changes, just exit edit mode
      setEditState(null);
      onEditStateChange?.(false);
      return true;
    }

    // Parse the value based on column type
    const column = tableInfo?.columns.find((c) => c.name === editState.columnName);
    let newValue: CellValue = editState.currentValue;

    if (column) {
      const typeCategory = getColumnTypeCategory(column.type);
      if (editState.currentValue === '' || editState.currentValue.toLowerCase() === 'null') {
        newValue = null;
      } else if (typeCategory === 'numeric') {
        const parsed = parseFloat(editState.currentValue);
        if (!Number.isNaN(parsed)) {
          newValue = parsed;
        }
      }
    }

    // Call the edit callback
    if (onCellEdit) {
      try {
        const success = await onCellEdit(editState.rowIndex, editState.columnName, newValue);
        if (success) {
          setEditState(null);
          onEditStateChange?.(false);
          return true;
        } else {
          // Rollback: keep edit state but revert to original
          setEditState((prev) =>
            prev
              ? {
                  ...prev,
                  currentValue: prev.originalValue === null ? '' : String(prev.originalValue),
                  isDirty: false,
                }
              : null
          );
          return false;
        }
      } catch {
        // Error - rollback
        setEditState((prev) =>
          prev
            ? {
                ...prev,
                currentValue: prev.originalValue === null ? '' : String(prev.originalValue),
                isDirty: false,
              }
            : null
        );
        return false;
      }
    }

    // No callback, just exit edit mode
    setEditState(null);
    onEditStateChange?.(false);
    return true;
  }, [editState, tableInfo, onCellEdit, onEditStateChange]);

  /**
   * Cancel the current edit (discard)
   */
  const cancelEdit = useCallback(() => {
    setEditState(null);
    onEditStateChange?.(false);
  }, [onEditStateChange]);

  return {
    table,
    columns,
    hasData,
    isEmpty,
    sortState,
    handleSortClick,
    getSortDirection,
    getSortIndex,
    editState,
    startEdit,
    updateEditValue,
    commitEdit,
    cancelEdit,
    isColumnEditable,
    isReadOnly,
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
