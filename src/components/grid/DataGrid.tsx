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
  type UseDataGridOptions,
  type SortState,
  type SortDirection,
  type FilterState,
  type ColumnFilter,
  type TextFilterOperator,
  type NumericFilterOperator,
} from './useDataGrid';
import { useGridVirtualizer } from './useGridVirtualizer';
import type { TableInfo } from '../../types';

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
  if (value === null) {
    return <span className="text-gray-400 italic">NULL</span>;
  }

  if (value instanceof Uint8Array) {
    return (
      <span className="text-purple-600 font-mono text-xs">
        BLOB ({value.length} bytes)
      </span>
    );
  }

  if (typeof value === 'number') {
    return <span className="font-mono tabular-nums">{value}</span>;
  }

  const stringValue = String(value);
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

    const filter: ColumnFilter = {
      column: columnName,
      operator: operator as ColumnFilter['operator'],
    };

    if (needsValue) {
      if (typeCategory === 'numeric') {
        filter.value = parseFloat(value) || 0;
      } else {
        filter.value = value;
      }
    }

    if (needsSecondValue) {
      filter.value2 = parseFloat(value2) || 0;
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
  onToggleSelect: () => void;
  columnWidths: Record<string, number>;
}

const GridRow = memo(function GridRow({
  row,
  style,
  isSelected,
  onToggleSelect,
  columnWidths,
}: GridRowProps) {
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
          onChange={onToggleSelect}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
      </div>

      {/* Data cells */}
      {row.getVisibleCells().map((cell) => {
        const width = columnWidths[cell.column.id] || DEFAULT_COLUMN_WIDTH;
        return (
          <div
            key={cell.id}
            className="flex-shrink-0 px-2 overflow-hidden text-ellipsis whitespace-nowrap"
            style={{ width, height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
          >
            <CellRenderer value={cell.getValue()} />
          </div>
        );
      })}
    </div>
  );
});

// =============================================================================
// Main DataGrid Component
// =============================================================================

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
}: DataGridProps) {
  // Column widths state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Selected rows state
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  // Filter state (internal if not controlled)
  const [internalFilterState, setInternalFilterState] = useState<FilterState>([]);
  const filterState = externalFilterState ?? internalFilterState;

  // Set up data grid hook
  const dataGridOptions: UseDataGridOptions = useMemo(
    () => ({
      tableInfo,
      data,
      isReadOnly,
      sortState: externalSortState,
      onSortChange,
    }),
    [tableInfo, data, isReadOnly, externalSortState, onSortChange]
  );

  const { table, columns, isEmpty, handleSortClick, getSortDirection, getSortIndex } = useDataGrid(dataGridOptions);

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

  // Handle row selection
  const handleToggleSelect = useCallback(
    (rowIndex: number) => {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (next.has(rowIndex)) {
          next.delete(rowIndex);
        } else {
          next.add(rowIndex);
        }
        onSelectionChange?.(next);
        return next;
      });
    },
    [onSelectionChange]
  );

  // Handle select all
  const handleSelectAll = useCallback(() => {
    setSelectedRows((prev) => {
      const allSelected = prev.size === data.length;
      const next = allSelected ? new Set<number>() : new Set(data.map((_, i) => i));
      onSelectionChange?.(next);
      return next;
    });
  }, [data.length, onSelectionChange]);

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
      <div
        className={`flex items-center justify-center text-gray-500 ${className}`}
        style={{ height }}
      >
        No data
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${className}`} style={{ height }}>
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
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
                onToggleSelect={() => handleToggleSelect(virtualRow.index)}
                columnWidths={columnWidths}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default DataGrid;
