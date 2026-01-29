/**
 * DataGrid Component
 *
 * A high-performance data grid using TanStack Table + Virtual.
 * Features:
 * - Virtual scrolling for 100k+ rows
 * - Column headers with type indicators
 * - Generated column indicators
 * - Row selection with checkboxes
 * - Sticky header during scroll
 * - Resizable columns
 */

import { memo, useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  useDataGrid,
  ROW_HEIGHT,
  getColumnTypeCategory,
  type DataRow,
  type CellValue,
  type UseDataGridOptions,
  type SortState,
  type SortDirection,
  type FilterState,
  type ColumnFilter,
  type TextFilterOperator,
  type NumericFilterOperator,
  type CellEditState,
} from './useDataGrid';
import { useGridVirtualizer } from './useGridVirtualizer';
import { AddRowDialog } from './AddRowDialog';
import { DeleteRowsDialog } from './DeleteRowsDialog';
import type { TableInfo, ColumnInfo } from '../../types';

// =============================================================================
// Constants
// =============================================================================

/** Default overscan count (rows to render outside visible area) */
const DEFAULT_OVERSCAN = 5;

/** Minimum column width in pixels */
const MIN_COLUMN_WIDTH = 50;

/** Default column width in pixels */
const DEFAULT_COLUMN_WIDTH = 150;

/** Checkbox column width */
const CHECKBOX_COLUMN_WIDTH = 40;

// =============================================================================
// Types
// =============================================================================

/** Result of add row attempt */
export interface AddRowResult {
  /** Whether the insert succeeded */
  success: boolean;
  /** If failed, whether a form is needed for required fields */
  needsForm?: boolean;
  /** Error message if failed */
  error?: string;
}

/** Result of delete rows attempt */
export interface DeleteRowsResult {
  /** Whether the delete succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Number of rows deleted (may differ from requested if some already gone) */
  deletedCount?: number;
}

export interface DataGridProps {
  /** Table schema information */
  tableInfo: TableInfo | null;
  /** Data rows to display */
  data: DataRow[];
  /** Whether the grid is in read-only mode */
  isReadOnly?: boolean;
  /** Height of the grid container (required for virtualization) */
  height: number;
  /** Optional className for the container */
  className?: string;
  /** Called when selected rows change */
  onSelectionChange?: (selectedRowIndices: Set<number>) => void;
  /** Called when column widths change */
  onColumnResize?: (columnId: string, width: number) => void;
  /** Sort state for columns */
  sortState?: SortState;
  /** Called when sort state changes */
  onSortChange?: (sortState: SortState) => void;
  /** Filter state for columns */
  filterState?: FilterState;
  /** Called when filter state changes */
  onFilterChange?: (filterState: FilterState) => void;
  /** Called when a cell edit is committed */
  onCellEdit?: (rowIndex: number, columnName: string, newValue: CellValue) => Promise<boolean>;
  /** Called when edit mode changes (for tracking unsaved edits) */
  onEditStateChange?: (isEditing: boolean) => void;
  /**
   * Called when add row is requested.
   * If values is undefined, attempt DEFAULT VALUES insert.
   * If values is provided, insert with those values.
   */
  onAddRow?: (values?: Record<string, unknown>) => Promise<AddRowResult>;
  /** Called after a successful row insert with the new row index */
  onRowAdded?: (rowIndex: number) => void;
  /**
   * Called when delete rows is requested.
   * Receives the row indices to delete.
   */
  onDeleteRows?: (rowIndices: number[]) => Promise<DeleteRowsResult>;
  /** Called after rows are deleted with the count of deleted rows */
  onRowsDeleted?: (count: number) => void;
  /** Whether the table has foreign key relationships (for cascade warning) */
  hasForeignKeys?: boolean;
}

// =============================================================================
// Type Icons
// =============================================================================

const TYPE_ICONS: Record<string, string> = {
  INTEGER: '123',
  INT: '123',
  BIGINT: '123',
  SMALLINT: '123',
  TINYINT: '123',
  TEXT: 'Aa',
  VARCHAR: 'Aa',
  CHAR: 'Aa',
  CLOB: 'Aa',
  REAL: '1.2',
  FLOAT: '1.2',
  DOUBLE: '1.2',
  NUMERIC: '1.2',
  DECIMAL: '1.2',
  BLOB: '01',
  BOOLEAN: '✓',
  DATE: '📅',
  DATETIME: '📅',
  TIMESTAMP: '📅',
};

/**
 * Get type indicator for a column type
 */
function getTypeIndicator(type: string): string {
  if (!type) return '?';
  const upperType = type.toUpperCase().split('(')[0].trim();
  return TYPE_ICONS[upperType] || '?';
}

/**
 * Get display name for a type
 */
function getTypeDisplayName(type: string): string {
  if (!type) return 'UNKNOWN';
  return type.toUpperCase();
}

// =============================================================================
// Cell Renderers (Memoized)
// =============================================================================

interface CellProps {
  value: unknown;
}

const CellRenderer = memo(function CellRenderer({ value }: CellProps) {
  // NULL values: italic gray "(null)" - distinguishable from literal string "null"
  if (value === null) {
    return (
      <span
        className="italic"
        style={{ color: '#6b7280' }}
        aria-label="NULL value"
        data-testid="cell-null"
      >
        (null)
      </span>
    );
  }

  // BLOB values: monospace, gray background, "[BLOB, N bytes]" format
  if (value instanceof Uint8Array) {
    const byteCount = value.length;
    return (
      <span
        className="font-mono text-xs px-1 rounded"
        style={{ backgroundColor: '#f3f4f6', color: '#6b7280' }}
        aria-label={`Binary data, ${byteCount} bytes`}
        data-testid="cell-blob"
      >
        [BLOB, {byteCount} bytes]
      </span>
    );
  }

  // Numeric values: monospace tabular nums
  if (typeof value === 'number') {
    return <span className="font-mono tabular-nums">{value}</span>;
  }

  // Text values: rendered as-is via React (auto-escapes HTML entities)
  // This prevents XSS - any HTML/script tags are displayed as literal text
  const stringValue = String(value);

  // Empty string: render empty cell (not NULL)
  if (stringValue === '') {
    return <span data-testid="cell-empty"></span>;
  }

  // Truncate long values
  if (stringValue.length > 100) {
    return (
      <span title={stringValue}>
        {stringValue.slice(0, 100)}…
      </span>
    );
  }

  return <span>{stringValue}</span>;
});

// =============================================================================
// Tooltip Component
// =============================================================================

interface TooltipProps {
  message: string;
  visible: boolean;
  position: { x: number; y: number };
}

const Tooltip = memo(function Tooltip({ message, visible, position }: TooltipProps) {
  if (!visible) return null;

  return (
    <div
      className="fixed z-[100] px-2 py-1 text-sm text-white bg-gray-800 rounded shadow-lg pointer-events-none"
      style={{
        left: position.x,
        top: position.y - 30,
        transform: 'translateX(-50%)',
      }}
      data-testid="edit-blocked-tooltip"
    >
      {message}
    </div>
  );
});

// =============================================================================
// EditableCell Component
// =============================================================================

interface EditableCellProps {
  value: unknown;
  columnType: string;
  editState: CellEditState | null;
  isEditing: boolean;
  onUpdateValue: (value: string) => void;
  onCommit: () => Promise<boolean>;
  onCancel: () => void;
  onMoveToNextCell?: () => void;
}

const EditableCell = memo(function EditableCell({
  value,
  columnType,
  editState,
  isEditing,
  onUpdateValue,
  onCommit,
  onCancel,
  onMoveToNextCell,
}: EditableCellProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const typeCategory = getColumnTypeCategory(columnType);
  const isMultiline = typeof value === 'string' && (value.includes('\n') || value.length > 50);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        onCommit().then((success) => {
          if (success && onMoveToNextCell) {
            onMoveToNextCell();
          }
        });
      }
    },
    [onCommit, onCancel, onMoveToNextCell]
  );

  // Handle blur (click outside)
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      // Check if focus is moving to another element within the grid
      const relatedTarget = e.relatedTarget as HTMLElement;
      if (relatedTarget?.closest('[data-row-index]')) {
        // Focus is moving to another cell, commit
        onCommit();
      } else if (!relatedTarget?.closest('.edit-input-container')) {
        // Focus is moving outside, commit
        onCommit();
      }
    },
    [onCommit]
  );

  if (!isEditing) {
    return <CellRenderer value={value} />;
  }

  const currentValue = editState?.currentValue ?? '';
  const isDirty = editState?.isDirty ?? false;

  // Use textarea for multiline content
  if (isMultiline) {
    return (
      <div className="edit-input-container absolute inset-0 z-10">
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={currentValue}
          onChange={(e) => onUpdateValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={`w-full h-full px-1 border-2 rounded resize-none ${
            isDirty ? 'bg-yellow-50 border-yellow-400' : 'border-blue-500'
          }`}
          data-testid="edit-textarea"
        />
      </div>
    );
  }

  return (
    <div className="edit-input-container absolute inset-0 z-10">
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={currentValue}
        onChange={(e) => onUpdateValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={`w-full h-full px-1 border-2 rounded ${
          isDirty ? 'bg-yellow-50 border-yellow-400' : 'border-blue-500'
        }`}
        inputMode={typeCategory === 'numeric' ? 'decimal' : 'text'}
        data-testid="edit-input"
      />
    </div>
  );
});

// =============================================================================
// Filter Popover Component
// =============================================================================

interface FilterPopoverProps {
  columnName: string;
  columnType: string;
  currentFilter: ColumnFilter | null;
  onApplyFilter: (filter: ColumnFilter | null) => void;
  onClose: () => void;
}

const TEXT_OPERATORS: { value: TextFilterOperator; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'equals', label: 'Equals' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
];

const NUMERIC_OPERATORS: { value: NumericFilterOperator; label: string }[] = [
  { value: 'eq', label: 'Equals' },
  { value: 'neq', label: 'Not equals' },
  { value: 'gt', label: 'Greater than' },
  { value: 'lt', label: 'Less than' },
  { value: 'gte', label: 'Greater or equal' },
  { value: 'lte', label: 'Less or equal' },
  { value: 'between', label: 'Between' },
];

const FilterPopover = memo(function FilterPopover({
  columnName,
  columnType,
  currentFilter,
  onApplyFilter,
  onClose,
}: FilterPopoverProps) {
  const typeCategory = getColumnTypeCategory(columnType);

  // Initialize state from current filter or defaults
  const [operator, setOperator] = useState<string>(() => {
    if (currentFilter) return currentFilter.operator;
    if (typeCategory === 'numeric') return 'eq';
    return 'contains';
  });
  const [value, setValue] = useState<string>(() => {
    if (currentFilter?.value !== undefined) return String(currentFilter.value);
    return '';
  });
  const [value2, setValue2] = useState<string>(() => {
    if (currentFilter?.value2 !== undefined) return String(currentFilter.value2);
    return '';
  });

  const needsValue = !['is_empty', 'is_not_empty', 'is_null', 'is_not_null'].includes(operator);
  const needsSecondValue = operator === 'between';

  const handleApply = () => {
    // Validate input
    if (needsValue && !value.trim()) {
      return; // Don't apply empty value filters
    }
    if (needsSecondValue && !value2.trim()) {
      return;
    }

    // Validate numeric inputs
    if (typeCategory === 'numeric' && needsValue) {
      const parsed = parseFloat(value);
      if (Number.isNaN(parsed)) {
        return; // Don't apply filters with invalid numeric values
      }
    }
    if (needsSecondValue) {
      const parsed2 = parseFloat(value2);
      if (Number.isNaN(parsed2)) {
        return;
      }
    }

    const filter: ColumnFilter = {
      column: columnName,
      operator: operator as ColumnFilter['operator'],
    };

    if (needsValue) {
      if (typeCategory === 'numeric') {
        filter.value = parseFloat(value);
      } else {
        filter.value = value;
      }
    }

    if (needsSecondValue) {
      filter.value2 = parseFloat(value2);
    }

    onApplyFilter(filter);
    onClose();
  };

  const handleClear = () => {
    onApplyFilter(null);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // Prevent clicks inside popover from closing it
  const handlePopoverClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 p-3 min-w-[200px]"
      onClick={handlePopoverClick}
      onKeyDown={handleKeyDown}
      data-testid={`filter-popover-${columnName}`}
    >
      <div className="text-xs font-semibold text-gray-600 mb-2">
        Filter: {columnName}
      </div>

      {/* Operator select */}
      <div className="mb-2">
        <select
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          data-testid={`filter-operator-${columnName}`}
        >
          {typeCategory === 'numeric' ? (
            <>
              <optgroup label="Numeric">
                {NUMERIC_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Null">
                <option value="is_null">Is NULL</option>
                <option value="is_not_null">Is not NULL</option>
              </optgroup>
            </>
          ) : (
            <>
              <optgroup label="Text">
                {TEXT_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Null">
                <option value="is_null">Is NULL</option>
                <option value="is_not_null">Is not NULL</option>
              </optgroup>
            </>
          )}
        </select>
      </div>

      {/* Value input(s) */}
      {needsValue && (
        <div className="mb-2">
          <input
            type={typeCategory === 'numeric' ? 'number' : 'text'}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            placeholder={typeCategory === 'numeric' ? 'Enter number...' : 'Enter text...'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            data-testid={`filter-value-${columnName}`}
          />
        </div>
      )}

      {needsSecondValue && (
        <div className="mb-2">
          <input
            type="number"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            placeholder="And..."
            value={value2}
            onChange={(e) => setValue2(e.target.value)}
            data-testid={`filter-value2-${columnName}`}
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          className="flex-1 px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          onClick={handleApply}
          data-testid={`filter-apply-${columnName}`}
        >
          Apply
        </button>
        {currentFilter && (
          <button
            className="flex-1 px-2 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            onClick={handleClear}
            data-testid={`filter-clear-${columnName}`}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
});

// =============================================================================
// Header Components
// =============================================================================

interface ColumnHeaderProps {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isGenerated: boolean;
  generatedType: 'stored' | 'virtual' | null;
  width: number;
  isResizing: boolean;
  onResizeStart: () => void;
  sortDirection: SortDirection | null;
  sortIndex: number | null;
  onSortClick: (addToSort: boolean) => void;
  currentFilter: ColumnFilter | null;
  onFilterChange: (filter: ColumnFilter | null) => void;
}

const ColumnHeader = memo(function ColumnHeader({
  name,
  type,
  isPrimaryKey,
  isGenerated,
  generatedType,
  width,
  isResizing,
  onResizeStart,
  sortDirection,
  sortIndex,
  onSortClick,
  currentFilter,
  onFilterChange,
}: ColumnHeaderProps) {
  const [showFilter, setShowFilter] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);

  const handleClick = (e: React.MouseEvent) => {
    // Don't trigger sort if clicking on resize handle or filter icon
    const target = e.target as HTMLElement;
    if (target.classList.contains('cursor-col-resize')) return;
    if (target.closest('[data-filter-icon]')) return;
    onSortClick(e.shiftKey);
  };

  const handleFilterClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowFilter(!showFilter);
  };

  // Close filter popover when clicking outside
  useEffect(() => {
    if (!showFilter) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setShowFilter(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilter]);

  const hasActiveFilter = currentFilter !== null;

  return (
    <div
      ref={headerRef}
      className="relative flex items-center gap-1 px-2 h-full overflow-hidden cursor-pointer select-none hover:bg-gray-200"
      style={{ width }}
      onClick={handleClick}
      role="columnheader"
      aria-sort={sortDirection === 'asc' ? 'ascending' : sortDirection === 'desc' ? 'descending' : 'none'}
    >
      {/* Type indicator */}
      <span
        className="text-xs text-gray-500 font-mono flex-shrink-0"
        title={getTypeDisplayName(type)}
      >
        {getTypeIndicator(type)}
      </span>

      {/* Column name */}
      <span className="truncate font-medium" title={name}>
        {name}
      </span>

      {/* Sort indicator */}
      {sortDirection && (
        <span
          className="text-blue-600 flex-shrink-0 font-bold text-sm"
          data-testid={`sort-indicator-${name}`}
          title={`Sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}${sortIndex ? ` (${sortIndex})` : ''}`}
        >
          {sortDirection === 'asc' ? '▲' : '▼'}
          {sortIndex && <sup className="text-xs">{sortIndex}</sup>}
        </span>
      )}

      {/* Filter icon */}
      <button
        data-filter-icon
        className={`flex-shrink-0 p-0.5 rounded hover:bg-gray-300 ${
          hasActiveFilter ? 'text-blue-600' : 'text-gray-400'
        }`}
        onClick={handleFilterClick}
        title={hasActiveFilter ? 'Filter active (click to edit)' : 'Add filter'}
        data-testid={`filter-icon-${name}`}
      >
        <svg
          className="w-3.5 h-3.5"
          fill={hasActiveFilter ? 'currentColor' : 'none'}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>
      </button>

      {/* Primary key indicator */}
      {isPrimaryKey && (
        <span className="text-amber-500 flex-shrink-0" title="Primary Key">
          🔑
        </span>
      )}

      {/* Generated column indicator */}
      {isGenerated && (
        <span
          className="text-blue-500 flex-shrink-0 cursor-help"
          title={`Generated column (${generatedType || 'unknown'})`}
        >
          ⚡
        </span>
      )}

      {/* Resize handle */}
      <div
        className={`absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 ${
          isResizing ? 'bg-blue-500' : ''
        }`}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart();
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart();
        }}
      />

      {/* Filter popover */}
      {showFilter && (
        <FilterPopover
          columnName={name}
          columnType={type}
          currentFilter={currentFilter}
          onApplyFilter={onFilterChange}
          onClose={() => setShowFilter(false)}
        />
      )}
    </div>
  );
});

// =============================================================================
// Row Component
// =============================================================================

interface GridRowProps {
  row: ReturnType<ReturnType<typeof useDataGrid>['table']['getRowModel']>['rows'][0];
  style: React.CSSProperties;
  isSelected: boolean;
  isReadOnly: boolean;
  onToggleSelect: (event: React.MouseEvent) => void;
  columnWidths: Record<string, number>;
  editState: CellEditState | null;
  onCellDoubleClick: (rowIndex: number, columnName: string, e: React.MouseEvent) => void;
  onUpdateEditValue: (value: string) => void;
  onCommitEdit: () => Promise<boolean>;
  onCancelEdit: () => void;
  onMoveToNextCell: (rowIndex: number, columnName: string) => void;
}

const GridRow = memo(function GridRow({
  row,
  style,
  isSelected,
  isReadOnly,
  onToggleSelect,
  columnWidths,
  editState,
  onCellDoubleClick,
  onUpdateEditValue,
  onCommitEdit,
  onCancelEdit,
  onMoveToNextCell,
}: GridRowProps) {
  const isRowEditing = editState?.rowIndex === row.index;

  return (
    <div
      className={`flex items-center border-b border-gray-200 ${
        isSelected ? 'bg-blue-50' : row.index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
      } hover:bg-blue-100`}
      style={style}
      data-row-index={row.index}
    >
      {/* Checkbox cell */}
      <div
        className="flex-shrink-0 flex items-center justify-center"
        style={{ width: CHECKBOX_COLUMN_WIDTH, height: ROW_HEIGHT }}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onToggleSelect(e.nativeEvent as unknown as React.MouseEvent)}
          onClick={(e) => onToggleSelect(e)}
          disabled={isReadOnly}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid={`row-checkbox-${row.index}`}
        />
      </div>

      {/* Data cells */}
      {row.getVisibleCells().map((cell) => {
        const width = columnWidths[cell.column.id] || DEFAULT_COLUMN_WIDTH;
        const columnName = cell.column.id;
        const columnType = cell.column.columnDef.meta?.type || 'TEXT';
        const isCellEditing = isRowEditing && editState?.columnName === columnName;
        const isDirty = isCellEditing && editState?.isDirty;

        return (
          <div
            key={cell.id}
            className={`flex-shrink-0 px-2 overflow-hidden text-ellipsis whitespace-nowrap relative ${
              isDirty ? 'bg-yellow-50' : ''
            }`}
            style={{ width, height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
            onDoubleClick={(e) => onCellDoubleClick(row.index, columnName, e)}
            data-testid={`cell-${row.index}-${columnName}`}
          >
            <EditableCell
              value={cell.getValue()}
              columnType={columnType}
              editState={editState}
              isEditing={isCellEditing}
              onUpdateValue={onUpdateEditValue}
              onCommit={onCommitEdit}
              onCancel={onCancelEdit}
              onMoveToNextCell={() => onMoveToNextCell(row.index, columnName)}
            />
          </div>
        );
      })}
    </div>
  );
});

// =============================================================================
// Main DataGrid Component
// =============================================================================

/** Toolbar height in pixels */
const TOOLBAR_HEIGHT = 40;

export const DataGrid = memo(function DataGrid({
  tableInfo,
  data,
  isReadOnly = false,
  height,
  className = '',
  onSelectionChange,
  onColumnResize,
  sortState: externalSortState,
  onSortChange,
  filterState: externalFilterState,
  onFilterChange,
  onCellEdit,
  onEditStateChange,
  onAddRow,
  onRowAdded,
  onDeleteRows,
  onRowsDeleted,
  hasForeignKeys = false,
}: DataGridProps) {
  // Column widths state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Selected rows state
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  // Track last clicked row for shift+click range selection
  const lastClickedRowRef = useRef<number | null>(null);

  // Filter state (internal if not controlled)
  const [internalFilterState, setInternalFilterState] = useState<FilterState>([]);
  const filterState = externalFilterState ?? internalFilterState;

  // Tooltip state for blocked edit attempts
  const [tooltip, setTooltip] = useState<{ message: string; visible: boolean; position: { x: number; y: number } }>({
    message: '',
    visible: false,
    position: { x: 0, y: 0 },
  });

  // Add row dialog state
  const [showAddRowDialog, setShowAddRowDialog] = useState(false);
  const [addRowError, setAddRowError] = useState<string | null>(null);
  const [isAddingRow, setIsAddingRow] = useState(false);

  // Delete rows dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Container ref for keyboard handling
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Set up data grid hook
  const dataGridOptions: UseDataGridOptions = useMemo(
    () => ({
      tableInfo,
      data,
      isReadOnly,
      sortState: externalSortState,
      onSortChange,
      onCellEdit,
      onEditStateChange,
    }),
    [tableInfo, data, isReadOnly, externalSortState, onSortChange, onCellEdit, onEditStateChange]
  );

  const {
    table,
    columns,
    isEmpty,
    handleSortClick,
    getSortDirection,
    getSortIndex,
    editState,
    startEdit,
    updateEditValue,
    commitEdit,
    cancelEdit,
    isColumnEditable,
  } = useDataGrid(dataGridOptions);

  // Set up virtualizer
  const { containerRef, virtualItems, totalHeight } = useGridVirtualizer({
    rowCount: data.length,
    viewportHeight: height - ROW_HEIGHT, // Subtract header height
    overscan: DEFAULT_OVERSCAN,
  });

  // Initialize column widths when columns change
  useEffect(() => {
    if (columns.length > 0) {
      setColumnWidths((prev) => {
        const newWidths: Record<string, number> = {};
        let hasNewColumns = false;
        columns.forEach((col) => {
          if (col.id && !(col.id in prev)) {
            newWidths[col.id] = DEFAULT_COLUMN_WIDTH;
            hasNewColumns = true;
          }
        });
        return hasNewColumns ? { ...prev, ...newWidths } : prev;
      });
    }
  }, [columns]);

  // Handle column resize
  const handleResizeStart = useCallback(
    (columnId: string) => {
      setResizingColumn(columnId);
      resizeStartX.current = 0;
      resizeStartWidth.current = columnWidths[columnId] || DEFAULT_COLUMN_WIDTH;
    },
    [columnWidths]
  );

  useEffect(() => {
    if (!resizingColumn) return;

    // Track the current width during resize for the callback
    let currentWidth = columnWidths[resizingColumn] || DEFAULT_COLUMN_WIDTH;

    const handleMove = (clientX: number) => {
      if (resizeStartX.current === 0) {
        resizeStartX.current = clientX;
        return;
      }

      const delta = clientX - resizeStartX.current;
      const newWidth = Math.max(MIN_COLUMN_WIDTH, resizeStartWidth.current + delta);
      currentWidth = newWidth;

      setColumnWidths((prev) => ({
        ...prev,
        [resizingColumn]: newWidth,
      }));
    };

    const handleEnd = () => {
      if (resizingColumn && onColumnResize) {
        onColumnResize(resizingColumn, currentWidth);
      }
      setResizingColumn(null);
    };

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const handleMouseUp = () => handleEnd();
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX);
      }
    };
    const handleTouchEnd = () => handleEnd();

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [resizingColumn, onColumnResize, columnWidths]);

  // Handle row selection (with shift+click range selection support)
  const handleToggleSelect = useCallback(
    (rowIndex: number, event?: React.MouseEvent) => {
      // Check if read-only - do nothing
      if (isReadOnly) return;

      setSelectedRows((prev) => {
        const next = new Set(prev);

        // Shift+click: range selection
        if (event?.shiftKey && lastClickedRowRef.current !== null) {
          const start = Math.min(lastClickedRowRef.current, rowIndex);
          const end = Math.max(lastClickedRowRef.current, rowIndex);
          for (let i = start; i <= end; i++) {
            next.add(i);
          }
        } else {
          // Normal click: toggle single row
          if (next.has(rowIndex)) {
            next.delete(rowIndex);
          } else {
            next.add(rowIndex);
          }
          // Update last clicked for future shift+clicks
          lastClickedRowRef.current = rowIndex;
        }

        onSelectionChange?.(next);
        return next;
      });
    },
    [onSelectionChange, isReadOnly]
  );

  // Handle select all
  const handleSelectAll = useCallback(() => {
    // Check if read-only - do nothing
    if (isReadOnly) return;

    setSelectedRows((prev) => {
      const allSelected = prev.size === data.length;
      const next = allSelected ? new Set<number>() : new Set(data.map((_, i) => i));
      onSelectionChange?.(next);
      return next;
    });
  }, [data.length, onSelectionChange, isReadOnly]);

  // Get filter for a specific column
  const getFilter = useCallback(
    (columnId: string): ColumnFilter | null => {
      return filterState.find((f) => f.column === columnId) ?? null;
    },
    [filterState]
  );

  // Handle filter change for a column
  const handleFilterChange = useCallback(
    (columnId: string, filter: ColumnFilter | null) => {
      const updateFilterState = (newState: FilterState) => {
        if (onFilterChange) {
          onFilterChange(newState);
        } else {
          setInternalFilterState(newState);
        }
      };

      if (filter === null) {
        // Remove filter for this column
        updateFilterState(filterState.filter((f) => f.column !== columnId));
      } else {
        // Add or update filter
        const existingIndex = filterState.findIndex((f) => f.column === columnId);
        if (existingIndex >= 0) {
          const newState = [...filterState];
          newState[existingIndex] = filter;
          updateFilterState(newState);
        } else {
          updateFilterState([...filterState, filter]);
        }
      }
    },
    [filterState, onFilterChange]
  );

  // Handle clear all filters
  const handleClearAllFilters = useCallback(() => {
    if (onFilterChange) {
      onFilterChange([]);
    } else {
      setInternalFilterState([]);
    }
  }, [onFilterChange]);

  // Handle cell double-click for editing
  const handleCellDoubleClick = useCallback(
    (rowIndex: number, columnName: string, e: React.MouseEvent) => {
      const result = startEdit(rowIndex, columnName);
      if (!result.allowed && result.message) {
        // Show tooltip at mouse position
        setTooltip({
          message: result.message,
          visible: true,
          position: { x: e.clientX, y: e.clientY },
        });
        // Hide tooltip after 2 seconds
        setTimeout(() => {
          setTooltip((prev) => ({ ...prev, visible: false }));
        }, 2000);
      }
    },
    [startEdit]
  );

  // Handle move to next cell (for Tab key)
  const handleMoveToNextCell = useCallback(
    (currentRowIndex: number, currentColumnName: string) => {
      // Find the next editable column
      const columnIndex = columns.findIndex((col) => col.id === currentColumnName);
      if (columnIndex === -1) return;

      // Try next columns in same row
      for (let i = columnIndex + 1; i < columns.length; i++) {
        const colName = columns[i].id;
        if (colName && isColumnEditable(colName)) {
          startEdit(currentRowIndex, colName);
          return;
        }
      }

      // Try first editable column in next row
      if (currentRowIndex < data.length - 1) {
        for (let i = 0; i < columns.length; i++) {
          const colName = columns[i].id;
          if (colName && isColumnEditable(colName)) {
            startEdit(currentRowIndex + 1, colName);
            return;
          }
        }
      }
    },
    [columns, data.length, isColumnEditable, startEdit]
  );

  // Get columns that require user input (NOT NULL without DEFAULT, not generated)
  const requiredColumns = useMemo((): ColumnInfo[] => {
    if (!tableInfo) return [];
    return tableInfo.columns.filter((col) => {
      // Skip generated columns
      if (col.generated !== null) return false;
      // Include columns that are NOT NULL and have no default
      if (col.notnull && col.dfltValue === null) return true;
      return false;
    });
  }, [tableInfo]);

  // Handle add row button click
  const handleAddRowClick = useCallback(async () => {
    if (!onAddRow || isReadOnly) return;

    setIsAddingRow(true);
    setAddRowError(null);

    try {
      // First try DEFAULT VALUES insert
      const result = await onAddRow();

      if (result.success) {
        // Success! New row added
        onRowAdded?.(data.length); // Index of new row
        setIsAddingRow(false);
      } else if (result.needsForm) {
        // Need to show form for required fields
        setShowAddRowDialog(true);
        setIsAddingRow(false);
      } else {
        // Other error
        setAddRowError(result.error || 'Failed to add row');
        setIsAddingRow(false);
      }
    } catch (err) {
      setAddRowError(err instanceof Error ? err.message : 'Failed to add row');
      setIsAddingRow(false);
    }
  }, [onAddRow, isReadOnly, data.length, onRowAdded]);

  // Handle add row dialog submit
  const handleAddRowSubmit = useCallback(async (values: Record<string, unknown>) => {
    if (!onAddRow) return;

    setIsAddingRow(true);
    setAddRowError(null);

    try {
      const result = await onAddRow(values);

      if (result.success) {
        setShowAddRowDialog(false);
        onRowAdded?.(data.length);
      } else {
        setAddRowError(result.error || 'Failed to add row');
      }
    } catch (err) {
      setAddRowError(err instanceof Error ? err.message : 'Failed to add row');
    } finally {
      setIsAddingRow(false);
    }
  }, [onAddRow, data.length, onRowAdded]);

  // Handle add row dialog close
  const handleAddRowDialogClose = useCallback(() => {
    setShowAddRowDialog(false);
    setAddRowError(null);
    setIsAddingRow(false);
  }, []);

  // Handle delete button click
  const handleDeleteClick = useCallback(() => {
    if (selectedRows.size === 0 || isReadOnly || !onDeleteRows) return;
    setDeleteError(null);
    setShowDeleteDialog(true);
  }, [selectedRows.size, isReadOnly, onDeleteRows]);

  // Handle delete confirm
  const handleDeleteConfirm = useCallback(async () => {
    if (!onDeleteRows || selectedRows.size === 0) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const rowIndices = Array.from(selectedRows).sort((a, b) => b - a); // Sort descending for stable deletion
      const result = await onDeleteRows(rowIndices);

      if (result.success) {
        setShowDeleteDialog(false);
        setSelectedRows(new Set());
        onSelectionChange?.(new Set());
        lastClickedRowRef.current = null;
        onRowsDeleted?.(result.deletedCount ?? rowIndices.length);
      } else {
        setDeleteError(result.error || 'Failed to delete rows');
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete rows');
    } finally {
      setIsDeleting(false);
    }
  }, [onDeleteRows, selectedRows, onSelectionChange, onRowsDeleted]);

  // Handle delete dialog close
  const handleDeleteDialogClose = useCallback(() => {
    setShowDeleteDialog(false);
    setDeleteError(null);
    setIsDeleting(false);
  }, []);

  // Keyboard shortcut handler for Cmd/Ctrl+Shift+N and Delete/Backspace
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if we're in an edit input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Cmd/Ctrl+Shift+N for add row
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (!isReadOnly && onAddRow && !showAddRowDialog) {
          handleAddRowClick();
        }
      }

      // Delete or Backspace for delete rows
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRows.size > 0) {
        e.preventDefault();
        if (!isReadOnly && onDeleteRows && !showDeleteDialog) {
          handleDeleteClick();
        }
      }
    };

    // Only listen when grid is focused or exists
    const container = gridContainerRef.current;
    if (container) {
      // Use document for global shortcut
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isReadOnly, onAddRow, showAddRowDialog, handleAddRowClick, onDeleteRows, selectedRows.size, showDeleteDialog, handleDeleteClick]);

  // Get rows from table
  const rows = table.getRowModel().rows;

  // Calculate total width for header
  const totalWidth = useMemo(() => {
    return (
      CHECKBOX_COLUMN_WIDTH +
      columns.reduce((sum, col) => sum + (columnWidths[col.id!] || DEFAULT_COLUMN_WIDTH), 0)
    );
  }, [columns, columnWidths]);

  // Empty state
  if (isEmpty) {
    return (
      <div
        className={`flex items-center justify-center text-gray-500 ${className}`}
        style={{ height }}
      >
        No table selected
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div ref={gridContainerRef} className={`flex flex-col ${className}`} style={{ height }}>
        {/* Toolbar (even when empty, to allow adding rows) */}
        {(onAddRow || onDeleteRows) && (
          <div
            className="flex-shrink-0 bg-gray-50 border-b border-gray-200 px-3 flex items-center gap-2"
            style={{ height: TOOLBAR_HEIGHT }}
            data-testid="grid-toolbar"
          >
            {onAddRow && (
              <button
                onClick={handleAddRowClick}
                disabled={isReadOnly || isAddingRow}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={isReadOnly ? 'Database is read-only' : 'Add new row (Cmd/Ctrl+Shift+N)'}
                data-testid="add-row-button"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Row
              </button>
            )}
            {onDeleteRows && (
              <button
                onClick={handleDeleteClick}
                disabled={isReadOnly || selectedRows.size === 0 || isDeleting}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={isReadOnly ? 'Database is read-only' : selectedRows.size === 0 ? 'Select rows to delete' : `Delete ${selectedRows.size} row(s) (Delete/Backspace)`}
                data-testid="delete-rows-button"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete{selectedRows.size > 0 ? ` (${selectedRows.size})` : ''}
              </button>
            )}
          </div>
        )}

        <div className="flex-1 flex items-center justify-center text-gray-500">
          No data
        </div>

        {/* Add Row Dialog */}
        <AddRowDialog
          isOpen={showAddRowDialog}
          requiredColumns={requiredColumns}
          allColumns={tableInfo?.columns ?? []}
          onClose={handleAddRowDialogClose}
          onSubmit={handleAddRowSubmit}
          isSubmitting={isAddingRow}
          error={addRowError}
        />

        {/* Delete Rows Dialog */}
        <DeleteRowsDialog
          isOpen={showDeleteDialog}
          rowCount={selectedRows.size}
          hasForeignKeys={hasForeignKeys}
          onClose={handleDeleteDialogClose}
          onConfirm={handleDeleteConfirm}
          isDeleting={isDeleting}
          error={deleteError}
        />
      </div>
    );
  }

  return (
    <div ref={gridContainerRef} className={`flex flex-col ${className}`} style={{ height }}>
      {/* Toolbar */}
      {(onAddRow || onDeleteRows) && (
        <div
          className="flex-shrink-0 bg-gray-50 border-b border-gray-200 px-3 flex items-center gap-2"
          style={{ height: TOOLBAR_HEIGHT }}
          data-testid="grid-toolbar"
        >
          {onAddRow && (
            <button
              onClick={handleAddRowClick}
              disabled={isReadOnly || isAddingRow}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title={isReadOnly ? 'Database is read-only' : 'Add new row (Cmd/Ctrl+Shift+N)'}
              data-testid="add-row-button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Row
            </button>
          )}
          {onDeleteRows && (
            <button
              onClick={handleDeleteClick}
              disabled={isReadOnly || selectedRows.size === 0 || isDeleting}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title={isReadOnly ? 'Database is read-only' : selectedRows.size === 0 ? 'Select rows to delete' : `Delete ${selectedRows.size} row(s) (Delete/Backspace)`}
              data-testid="delete-rows-button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete{selectedRows.size > 0 ? ` (${selectedRows.size})` : ''}
            </button>
          )}
        </div>
      )}

      {/* Filter status bar (shown when filters active) */}
      {filterState.length > 0 && (
        <div
          className="flex-shrink-0 bg-blue-50 border-b border-blue-200 px-3 py-1 flex items-center gap-2"
          data-testid="filter-status-bar"
        >
          <span className="text-sm text-blue-700">
            <span className="font-medium">{filterState.length}</span> filter{filterState.length !== 1 ? 's' : ''} active
          </span>
          <button
            className="text-xs text-blue-600 hover:text-blue-800 underline"
            onClick={handleClearAllFilters}
            data-testid="clear-all-filters"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Header (sticky) */}
      <div
        className="flex-shrink-0 bg-gray-100 border-b-2 border-gray-300 overflow-hidden"
        style={{ height: ROW_HEIGHT }}
      >
        <div className="flex items-center" style={{ width: totalWidth }}>
          {/* Select all checkbox */}
          <div
            className="flex-shrink-0 flex items-center justify-center"
            style={{ width: CHECKBOX_COLUMN_WIDTH, height: ROW_HEIGHT }}
          >
            <input
              type="checkbox"
              checked={selectedRows.size === data.length && data.length > 0}
              onChange={handleSelectAll}
              disabled={isReadOnly}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="select-all-checkbox"
            />
          </div>

          {/* Column headers */}
          {table.getHeaderGroups().map((headerGroup) =>
            headerGroup.headers.map((header) => {
              const meta = header.column.columnDef.meta;
              const width = columnWidths[header.column.id] || DEFAULT_COLUMN_WIDTH;
              const columnId = header.column.id;
              return (
                <div
                  key={header.id}
                  className="flex-shrink-0 relative"
                  style={{ width, height: ROW_HEIGHT }}
                >
                  <ColumnHeader
                    name={String(header.column.columnDef.header)}
                    type={meta?.type || ''}
                    isPrimaryKey={meta?.isPrimaryKey || false}
                    isGenerated={meta?.isGenerated || false}
                    generatedType={meta?.generatedType || null}
                    width={width}
                    isResizing={resizingColumn === columnId}
                    onResizeStart={() => handleResizeStart(columnId)}
                    sortDirection={getSortDirection(columnId)}
                    sortIndex={getSortIndex(columnId)}
                    onSortClick={(addToSort) => handleSortClick(columnId, addToSort)}
                    currentFilter={getFilter(columnId)}
                    onFilterChange={(filter) => handleFilterChange(columnId, filter)}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Virtualized body */}
      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        className="flex-1 overflow-auto"
        style={{ contain: 'strict' }}
      >
        <div
          style={{
            height: totalHeight,
            width: totalWidth,
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;

            return (
              <GridRow
                key={row.id}
                row={row}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: totalWidth,
                  height: ROW_HEIGHT,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                isSelected={selectedRows.has(virtualRow.index)}
                isReadOnly={isReadOnly}
                onToggleSelect={(e) => handleToggleSelect(virtualRow.index, e)}
                columnWidths={columnWidths}
                editState={editState}
                onCellDoubleClick={handleCellDoubleClick}
                onUpdateEditValue={updateEditValue}
                onCommitEdit={commitEdit}
                onCancelEdit={cancelEdit}
                onMoveToNextCell={handleMoveToNextCell}
              />
            );
          })}
        </div>
      </div>

      {/* Tooltip for blocked edit attempts */}
      <Tooltip message={tooltip.message} visible={tooltip.visible} position={tooltip.position} />

      {/* Add Row Dialog */}
      <AddRowDialog
        isOpen={showAddRowDialog}
        requiredColumns={requiredColumns}
        allColumns={tableInfo?.columns ?? []}
        onClose={handleAddRowDialogClose}
        onSubmit={handleAddRowSubmit}
        isSubmitting={isAddingRow}
        error={addRowError}
      />

      {/* Delete Rows Dialog */}
      <DeleteRowsDialog
        isOpen={showDeleteDialog}
        rowCount={selectedRows.size}
        hasForeignKeys={hasForeignKeys}
        onClose={handleDeleteDialogClose}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
        error={deleteError}
      />
    </div>
  );
});

export default DataGrid;
