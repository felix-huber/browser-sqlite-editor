/**
 * ImportPreview Component
 *
 * A preview grid component for file imports showing:
 * - First 10 rows of data
 * - Column headers with original/normalized names
 * - Type dropdowns for each column
 * - Mismatch cell highlighting when values don't match selected type
 * - Row count display
 */

import { useState, useCallback, useMemo } from 'react';

export type ColumnType = 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB';

export interface PreviewColumn {
  /** Normalized name (used for table) */
  name: string;
  /** Original name from file header */
  originalName?: string;
  /** Inferred type */
  type: string;
}

export interface ImportPreviewProps {
  /** Column definitions */
  columns: PreviewColumn[];
  /** All rows of data */
  rows: unknown[][];
  /** Callback when column types are changed */
  onColumnsChange?: (columns: PreviewColumn[]) => void;
  /** Callback when column names are changed */
  onColumnRename?: (index: number, newName: string) => void;
  /** Maximum rows to preview */
  maxPreviewRows?: number;
}

/** Number of preview rows to show */
const DEFAULT_PREVIEW_ROWS = 10;

/** Available SQLite column types */
const COLUMN_TYPES: ColumnType[] = ['TEXT', 'INTEGER', 'REAL', 'BLOB'];

/**
 * Check if a value matches the expected type
 */
function valueMatchesType(value: unknown, type: ColumnType): boolean {
  // NULL matches any type
  if (value === null || value === undefined) {
    return true;
  }

  const str = String(value).trim();
  if (str === '') return true;

  switch (type) {
    case 'INTEGER': {
      const num = Number(str);
      return !Number.isNaN(num) && Number.isInteger(num);
    }
    case 'REAL': {
      const num = Number(str);
      return !Number.isNaN(num);
    }
    case 'BLOB':
      // BLOB accepts anything (but rarely used for import)
      return true;
    case 'TEXT':
    default:
      // TEXT accepts anything
      return true;
  }
}

/**
 * Format cell value for display
 */
function formatCellValue(value: unknown): { display: string; isNull: boolean } {
  if (value === null || value === undefined) {
    return { display: 'NULL', isNull: true };
  }
  return { display: String(value), isNull: false };
}

/**
 * ImportPreview component
 */
export function ImportPreview({
  columns,
  rows,
  onColumnsChange,
  onColumnRename,
  maxPreviewRows = DEFAULT_PREVIEW_ROWS,
}: ImportPreviewProps) {
  // Track if we're editing a column name
  const [editingColumn, setEditingColumn] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const previewRows = useMemo(() => rows.slice(0, maxPreviewRows), [rows, maxPreviewRows]);

  // Handle type change for a column
  const handleTypeChange = useCallback(
    (columnIndex: number, newType: ColumnType) => {
      if (!onColumnsChange) return;

      const newColumns = columns.map((col, i) =>
        i === columnIndex ? { ...col, type: newType } : col
      );
      onColumnsChange(newColumns);
    },
    [columns, onColumnsChange]
  );

  // Start editing column name
  const handleStartEdit = useCallback((index: number, currentName: string) => {
    setEditingColumn(index);
    setEditValue(currentName);
  }, []);

  // Save column name edit
  const handleSaveEdit = useCallback(() => {
    if (editingColumn === null || !onColumnRename) return;

    const trimmed = editValue.trim();
    if (trimmed && trimmed !== columns[editingColumn]?.name) {
      onColumnRename(editingColumn, trimmed);
    }
    setEditingColumn(null);
    setEditValue('');
  }, [editingColumn, editValue, columns, onColumnRename]);

  // Cancel column name edit
  const handleCancelEdit = useCallback(() => {
    setEditingColumn(null);
    setEditValue('');
  }, []);

  // Handle key press in edit input
  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSaveEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancelEdit();
      }
    },
    [handleSaveEdit, handleCancelEdit]
  );

  // Calculate mismatch cells
  const mismatchCells = useMemo(() => {
    const mismatches = new Set<string>();

    previewRows.forEach((row, rowIdx) => {
      row.forEach((cell, colIdx) => {
        const colType = (columns[colIdx]?.type || 'TEXT') as ColumnType;
        if (!valueMatchesType(cell, colType)) {
          mismatches.add(`${rowIdx}-${colIdx}`);
        }
      });
    });

    return mismatches;
  }, [previewRows, columns]);

  const mismatchCount = mismatchCells.size;

  return (
    <div className="space-y-2">
      {/* Header with row count */}
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-navy-700">
          Previewing {Math.min(maxPreviewRows, rows.length)} of {rows.length.toLocaleString()} rows
        </label>
        {mismatchCount > 0 && (
          <span
            className="text-sm text-amber-600 flex items-center gap-1"
            data-testid="mismatch-warning"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            {mismatchCount} type {mismatchCount === 1 ? 'mismatch' : 'mismatches'}
          </span>
        )}
      </div>

      {/* Preview table */}
      <div className="border border-navy-200 rounded-lg overflow-hidden" data-testid="import-preview">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="preview-table">
            <thead className="bg-navy-50">
              <tr>
                {columns.map((col, i) => {
                  const showNormalization =
                    col.originalName &&
                    col.originalName !== col.name &&
                    col.originalName.trim() !== '';

                  return (
                    <th
                      key={i}
                      className="px-3 py-2 text-left border-r border-navy-200 last:border-r-0"
                      data-testid={`column-header-${i}`}
                    >
                      {/* Column name with edit */}
                      <div className="space-y-1">
                        {editingColumn === i ? (
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleSaveEdit}
                            onKeyDown={handleEditKeyDown}
                            className="w-full px-1 py-0.5 text-sm font-medium border border-navy-300 rounded focus:outline-none focus:ring-1 focus:ring-navy-500"
                            autoFocus
                            data-testid={`column-name-input-${i}`}
                          />
                        ) : (
                          <div className="flex items-center gap-1">
                            <span
                              className={`font-medium text-navy-700 ${onColumnRename ? 'cursor-pointer hover:text-navy-900' : ''}`}
                              onClick={() =>
                                onColumnRename && handleStartEdit(i, col.name)
                              }
                              title={onColumnRename ? 'Click to rename' : undefined}
                              data-testid={`column-name-${i}`}
                            >
                              {col.name}
                            </span>
                            {onColumnRename && (
                              <button
                                onClick={() => handleStartEdit(i, col.name)}
                                className="p-0.5 text-navy-400 hover:text-navy-600 transition-colors"
                                aria-label={`Edit column ${col.name}`}
                                data-testid={`edit-column-btn-${i}`}
                              >
                                <svg
                                  className="w-3 h-3"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                  />
                                </svg>
                              </button>
                            )}
                          </div>
                        )}

                        {/* Header normalization display */}
                        {showNormalization && (
                          <div
                            className="text-xs text-navy-500 font-normal"
                            data-testid={`header-normalization-${i}`}
                          >
                            {col.originalName} → {col.name}
                          </div>
                        )}

                        {/* Type dropdown */}
                        <select
                          value={col.type}
                          onChange={(e) =>
                            handleTypeChange(i, e.target.value as ColumnType)
                          }
                          disabled={!onColumnsChange}
                          className="w-full px-1 py-0.5 text-xs border border-navy-200 rounded bg-white text-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-500 disabled:bg-navy-100 disabled:cursor-not-allowed"
                          data-testid={`type-dropdown-${i}`}
                          aria-label={`Type for column ${col.name}`}
                        >
                          {COLUMN_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className="border-t border-navy-200 hover:bg-navy-50"
                  data-testid={`preview-row-${rowIdx}`}
                >
                  {row.map((cell, cellIdx) => {
                    const { display, isNull } = formatCellValue(cell);
                    const isMismatch = mismatchCells.has(`${rowIdx}-${cellIdx}`);

                    return (
                      <td
                        key={cellIdx}
                        className={`px-3 py-2 border-r border-navy-200 last:border-r-0 max-w-[200px] truncate ${
                          isMismatch
                            ? 'bg-amber-50 text-amber-800'
                            : isNull
                              ? 'text-navy-400 italic'
                              : 'text-navy-900'
                        }`}
                        title={
                          isMismatch
                            ? `Value doesn't match type ${columns[cellIdx]?.type}`
                            : display
                        }
                        data-testid={`cell-${rowIdx}-${cellIdx}`}
                        data-mismatch={isMismatch ? 'true' : undefined}
                      >
                        {isNull ? (
                          <span className="italic">NULL</span>
                        ) : (
                          display
                        )}
                        {isMismatch && (
                          <span className="ml-1 text-amber-600" aria-hidden="true">
                            ⚠
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default ImportPreview;
