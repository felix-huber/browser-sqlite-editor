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
import { useDataGrid, ROW_HEIGHT, type DataRow, type UseDataGridOptions } from './useDataGrid';
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
}: ColumnHeaderProps) {
  return (
    <div
      className="flex items-center gap-1 px-2 h-full overflow-hidden"
      style={{ width }}
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
          onResizeStart();
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          onResizeStart();
        }}
      />
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
}: DataGridProps) {
  // Column widths state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Selected rows state
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  // Set up data grid hook
  const dataGridOptions: UseDataGridOptions = useMemo(
    () => ({
      tableInfo,
      data,
      isReadOnly,
    }),
    [tableInfo, data, isReadOnly]
  );

  const { table, columns, isEmpty } = useDataGrid(dataGridOptions);

  // Set up virtualizer
  const { containerRef, virtualItems, totalHeight } = useGridVirtualizer({
    rowCount: data.length,
    viewportHeight: height - ROW_HEIGHT, // Subtract header height
    overscan: DEFAULT_OVERSCAN,
  });

  // Initialize column widths when columns change
  useEffect(() => {
    if (columns.length > 0) {
      const newWidths: Record<string, number> = {};
      columns.forEach((col) => {
        if (col.id && !(col.id in columnWidths)) {
          newWidths[col.id] = DEFAULT_COLUMN_WIDTH;
        }
      });
      if (Object.keys(newWidths).length > 0) {
        setColumnWidths((prev) => ({ ...prev, ...newWidths }));
      }
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

    const handleMouseMove = (e: MouseEvent) => {
      if (resizeStartX.current === 0) {
        resizeStartX.current = e.clientX;
        return;
      }

      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(MIN_COLUMN_WIDTH, resizeStartWidth.current + delta);

      setColumnWidths((prev) => ({
        ...prev,
        [resizingColumn]: newWidth,
      }));
    };

    const handleMouseUp = () => {
      if (resizingColumn && onColumnResize) {
        onColumnResize(resizingColumn, columnWidths[resizingColumn] || DEFAULT_COLUMN_WIDTH);
      }
      setResizingColumn(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
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
                    isResizing={resizingColumn === header.column.id}
                    onResizeStart={() => handleResizeStart(header.column.id)}
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
