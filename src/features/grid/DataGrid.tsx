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
  type DataRow,
  type CellValue,
  type UseDataGridOptions,
  type SortState,
  type FilterState,
  type ColumnFilter,
} from './useDataGrid';
import { useGridVirtualizer } from './useGridVirtualizer';
import { AddRowDialog } from './AddRowDialog';
import { DeleteRowsDialog } from './DeleteRowsDialog';
import { Tooltip } from './GridCell';
import { ColumnHeader } from './GridHeader';
import { GridRow } from './GridRow';
import {
  CellContextMenu,
  copyCellValue,
  parsePastedValue,
  generateBlobFilename,
  downloadBlob,
} from './CellContextMenu';
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

export interface GridEditActions {
  commit: () => Promise<boolean>;
  cancel: () => void;
  hasEdit: boolean;
  isDirty: boolean;
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
  /** Provide edit actions so the parent can commit/discard pending edits */
  onEditActionsChange?: (actions: GridEditActions | null) => void;
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
// Context Menu State
// =============================================================================

interface CellContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  rowIndex: number;
  columnName: string;
  cellValue: CellValue;
  columnInfo: ColumnInfo | null;
}

// =============================================================================
// Row Component
// =============================================================================

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
  onEditActionsChange,
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

  // Cell context menu state
  const [contextMenu, setContextMenu] = useState<CellContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    rowIndex: -1,
    columnName: '',
    cellValue: null,
    columnInfo: null,
  });

  // Container ref for keyboard handling
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Track focused cell for keyboard navigation
  const [focusedCell, setFocusedCell] = useState<{row: number; col: number} | null>(null);

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

  useEffect(() => {
    if (!onEditActionsChange) return;
    if (editState) {
      onEditActionsChange({
        commit: commitEdit,
        cancel: cancelEdit,
        hasEdit: true,
        isDirty: editState.isDirty,
      });
      return;
    }
    onEditActionsChange(null);
  }, [onEditActionsChange, editState, commitEdit, cancelEdit]);

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
  }, [data, onSelectionChange, isReadOnly]);

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

  // Handle cell click (for focus management)
  const handleCellClick = useCallback((rowIndex: number, colIndex: number, event: React.MouseEvent<HTMLDivElement>) => {
    setFocusedCell({ row: rowIndex, col: colIndex });
    event.currentTarget.focus();
  }, []);

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

  // ==========================================================================
  // Cell Context Menu Handlers
  // ==========================================================================

  // Open context menu on right-click
  const handleCellContextMenu = useCallback(
    (rowIndex: number, columnName: string, cellValue: CellValue, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const columnInfo = tableInfo?.columns.find((c) => c.name === columnName) ?? null;

      setContextMenu({
        isOpen: true,
        x: e.clientX,
        y: e.clientY,
        rowIndex,
        columnName,
        cellValue,
        columnInfo,
      });
    },
    [tableInfo]
  );

  // Close context menu
  const handleContextMenuClose = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Copy cell value to clipboard
  const handleContextMenuCopy = useCallback(async () => {
    try {
      await copyCellValue(contextMenu.cellValue);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
    handleContextMenuClose();
  }, [contextMenu.cellValue, handleContextMenuClose]);

  // Paste from clipboard
  const handleContextMenuPaste = useCallback(async () => {
    if (!onCellEdit || isReadOnly || !contextMenu.columnInfo) {
      handleContextMenuClose();
      return;
    }

    // Check if column is editable
    const isGenerated = contextMenu.columnInfo.generated !== null;
    if (isGenerated) {
      handleContextMenuClose();
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      const parsedValue = parsePastedValue(text, contextMenu.columnInfo.type);
      await onCellEdit(contextMenu.rowIndex, contextMenu.columnName, parsedValue);
    } catch (err) {
      console.error('Failed to paste:', err);
    }
    handleContextMenuClose();
  }, [onCellEdit, isReadOnly, contextMenu, handleContextMenuClose]);

  // Set cell to NULL
  const handleContextMenuSetNull = useCallback(async () => {
    if (!onCellEdit || isReadOnly || !contextMenu.columnInfo) {
      handleContextMenuClose();
      return;
    }

    // Check if column is editable
    const isGenerated = contextMenu.columnInfo.generated !== null;
    if (isGenerated) {
      handleContextMenuClose();
      return;
    }

    try {
      await onCellEdit(contextMenu.rowIndex, contextMenu.columnName, null);
    } catch (err) {
      console.error('Failed to set NULL:', err);
    }
    handleContextMenuClose();
  }, [onCellEdit, isReadOnly, contextMenu, handleContextMenuClose]);

  // Save BLOB as file
  const handleContextMenuSaveBlob = useCallback(() => {
    if (!(contextMenu.cellValue instanceof Uint8Array)) {
      handleContextMenuClose();
      return;
    }

    const filename = generateBlobFilename(contextMenu.columnName, contextMenu.rowIndex);
    downloadBlob(contextMenu.cellValue, filename);
    handleContextMenuClose();
  }, [contextMenu, handleContextMenuClose]);

  // Delete the row from context menu
  const handleContextMenuDeleteRow = useCallback(() => {
    if (isReadOnly || !onDeleteRows) {
      handleContextMenuClose();
      return;
    }

    // Select the row and show delete dialog
    setSelectedRows(new Set([contextMenu.rowIndex]));
    onSelectionChange?.(new Set([contextMenu.rowIndex]));
    lastClickedRowRef.current = contextMenu.rowIndex;
    setDeleteError(null);
    setShowDeleteDialog(true);
    handleContextMenuClose();
  }, [isReadOnly, onDeleteRows, contextMenu.rowIndex, onSelectionChange, handleContextMenuClose]);

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

  // Handle keyboard navigation within the grid
  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Skip if we're in an edit input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Arrow key navigation
      if (focusedCell && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        let newRow = focusedCell.row;
        let newCol = focusedCell.col;

        switch (e.key) {
          case 'ArrowUp':
            newRow = Math.max(0, focusedCell.row - 1);
            break;
          case 'ArrowDown':
            newRow = Math.min(data.length - 1, focusedCell.row + 1);
            break;
          case 'ArrowLeft':
            newCol = Math.max(0, focusedCell.col - 1);
            break;
          case 'ArrowRight':
            newCol = Math.min(columns.length - 1, focusedCell.col + 1);
            break;
        }

        setFocusedCell({ row: newRow, col: newCol });
      }

      // Enter to start editing
      if (e.key === 'Enter' && focusedCell && !editState) {
        e.preventDefault();
        const colName = columns[focusedCell.col]?.id;
        if (colName) {
          startEdit(focusedCell.row, colName);
        }
      }

      // Escape to cancel edit
      if (e.key === 'Escape' && editState) {
        e.preventDefault();
        cancelEdit();
      }

      // Space to toggle selection
      if (e.key === ' ' && focusedCell && !editState) {
        e.preventDefault();
        handleToggleSelect(focusedCell.row);
      }

      // Home/End navigation
      if (e.key === 'Home' && focusedCell) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          setFocusedCell({ row: 0, col: 0 });
        } else {
          setFocusedCell({ row: focusedCell.row, col: 0 });
        }
      }

      if (e.key === 'End' && focusedCell) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          setFocusedCell({ row: data.length - 1, col: columns.length - 1 });
        } else {
          setFocusedCell({ row: focusedCell.row, col: columns.length - 1 });
        }
      }
    },
    [focusedCell, data.length, columns, editState, startEdit, cancelEdit, handleToggleSelect]
  );

  // Keyboard shortcut handler for Cmd/Ctrl+Shift+N and Delete/Backspace
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if we're in an edit input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT') {
        const input = target as HTMLInputElement;
        if (input.type !== 'checkbox' && input.type !== 'radio') {
          return;
        }
      }
      if (target.tagName === 'TEXTAREA' || target.isContentEditable) {
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
    <div
      ref={gridContainerRef}
      className={`flex flex-col ${className}`}
      style={{ height }}
      data-testid="data-grid"
    >
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
    <div
      ref={gridContainerRef}
      className={`flex flex-col ${className}`}
      style={{ height }}
      data-testid="data-grid"
      role="grid"
      aria-label={tableInfo?.name ? `Data grid for ${tableInfo.name} table` : 'Data grid'}
      aria-rowcount={data.length + 1} // +1 for header row
      aria-colcount={columns.length + 1} // +1 for checkbox column
      aria-readonly={isReadOnly}
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
    >
      {/* Toolbar */}
      {(onAddRow || onDeleteRows) && (
        <div
          className="flex-shrink-0 bg-gray-50 border-b border-gray-200 px-3 flex items-center gap-2"
          style={{ height: TOOLBAR_HEIGHT }}
          data-testid="grid-toolbar"
          role="toolbar"
          aria-label="Grid actions"
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
        role="row"
        aria-rowindex={1}
      >
        <div className="flex items-center" style={{ width: totalWidth }}>
          {/* Select all checkbox */}
          <div
            className="flex-shrink-0 flex items-center justify-center"
            style={{ width: CHECKBOX_COLUMN_WIDTH, height: ROW_HEIGHT }}
            role="columnheader"
            aria-label="Select all rows"
          >
            <input
              type="checkbox"
              checked={selectedRows.size === data.length && data.length > 0}
              onChange={handleSelectAll}
              disabled={isReadOnly}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="select-all-checkbox"
              aria-label="Select all rows"
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
                onCellContextMenu={handleCellContextMenu}
                onUpdateEditValue={updateEditValue}
                onCommitEdit={commitEdit}
                onCancelEdit={cancelEdit}
                onMoveToNextCell={handleMoveToNextCell}
                focusedCell={focusedCell}
                onCellClick={handleCellClick}
                rowHeight={ROW_HEIGHT}
                checkboxColumnWidth={CHECKBOX_COLUMN_WIDTH}
                defaultColumnWidth={DEFAULT_COLUMN_WIDTH}
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

      {/* Cell Context Menu */}
      {contextMenu.isOpen && (
        <CellContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleContextMenuClose}
          cellValue={contextMenu.cellValue}
          columnInfo={contextMenu.columnInfo}
          rowIndex={contextMenu.rowIndex}
          isReadOnly={isReadOnly}
          onCopy={handleContextMenuCopy}
          onPaste={handleContextMenuPaste}
          onSetNull={handleContextMenuSetNull}
          onSaveBlob={handleContextMenuSaveBlob}
          onDeleteRow={handleContextMenuDeleteRow}
        />
      )}
    </div>
  );
});

export default DataGrid;
