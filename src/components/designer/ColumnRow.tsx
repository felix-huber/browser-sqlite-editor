/**
 * ColumnRow Component
 *
 * A single row in the table designer column list.
 * Displays column properties: name, type, constraints (PK, NN, UQ).
 *
 * Features:
 * - Inline editing of name, type, default value
 * - Toggle buttons for constraints
 * - Delete button with optional confirmation
 * - Disabled state for read-only mode
 */

import { memo, useCallback, useRef, useEffect } from 'react';
import type { DesignerColumnDraft } from '../../types';

// =============================================================================
// Constants
// =============================================================================

/** Common SQLite column types for dropdown */
export const COMMON_COLUMN_TYPES = [
  'TEXT',
  'INTEGER',
  'REAL',
  'BLOB',
  'NUMERIC',
  'VARCHAR(255)',
  'BOOLEAN',
  'DATETIME',
  'DATE',
  'TIME',
];

// =============================================================================
// Types
// =============================================================================

export interface ColumnRowProps {
  /** Column data */
  column: DesignerColumnDraft;
  /** Whether this row is disabled (read-only mode) */
  disabled?: boolean;
  /** Whether to show delete confirmation */
  showDeleteConfirm?: boolean;
  /** Called when column properties change */
  onChange: (id: string, updates: Partial<DesignerColumnDraft>) => void;
  /** Called when delete is requested */
  onDelete: (id: string) => void;
  /** Called to toggle delete confirmation visibility */
  onToggleDeleteConfirm?: (id: string, show: boolean) => void;
  /** Whether this is the first column (for auto-focus on add) */
  isNew?: boolean;
  /** Index for display (1-based) */
  index: number;
}

// =============================================================================
// Component
// =============================================================================

export const ColumnRow = memo(function ColumnRow({
  column,
  disabled = false,
  showDeleteConfirm = false,
  onChange,
  onDelete,
  onToggleDeleteConfirm,
  isNew = false,
  index,
}: ColumnRowProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus name input when newly added
  useEffect(() => {
    if (isNew && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isNew]);

  // Handle name change
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(column.id, { name: e.target.value });
    },
    [column.id, onChange]
  );

  // Handle type change
  const handleTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      onChange(column.id, { type: e.target.value });
    },
    [column.id, onChange]
  );

  // Handle default value change
  const handleDefaultChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.trim() || null;
      onChange(column.id, { defaultValue: value });
    },
    [column.id, onChange]
  );

  // Toggle primary key
  const handlePkToggle = useCallback(() => {
    onChange(column.id, { isPrimaryKey: !column.isPrimaryKey });
  }, [column.id, column.isPrimaryKey, onChange]);

  // Toggle not null
  const handleNnToggle = useCallback(() => {
    onChange(column.id, { isNotNull: !column.isNotNull });
  }, [column.id, column.isNotNull, onChange]);

  // Toggle unique
  const handleUqToggle = useCallback(() => {
    onChange(column.id, { isUnique: !column.isUnique });
  }, [column.id, column.isUnique, onChange]);

  // Handle delete button click
  const handleDeleteClick = useCallback(() => {
    if (column.isExisting && onToggleDeleteConfirm) {
      // Show confirmation for existing columns
      onToggleDeleteConfirm(column.id, true);
    } else {
      // Delete immediately for new columns
      onDelete(column.id);
    }
  }, [column.id, column.isExisting, onDelete, onToggleDeleteConfirm]);

  // Handle confirm delete
  const handleConfirmDelete = useCallback(() => {
    onDelete(column.id);
  }, [column.id, onDelete]);

  // Handle cancel delete
  const handleCancelDelete = useCallback(() => {
    if (onToggleDeleteConfirm) {
      onToggleDeleteConfirm(column.id, false);
    }
  }, [column.id, onToggleDeleteConfirm]);

  return (
    <div
      className={`flex items-center gap-2 p-2 border rounded-lg bg-white ${
        disabled ? 'opacity-60' : ''
      } ${showDeleteConfirm ? 'ring-2 ring-red-200' : ''}`}
      data-testid={`column-row-${column.id}`}
    >
      {/* Index */}
      <span className="w-6 text-center text-xs text-gray-400 font-mono">
        {index}
      </span>

      {/* Name input */}
      <input
        ref={nameInputRef}
        type="text"
        value={column.name}
        onChange={handleNameChange}
        disabled={disabled}
        placeholder="Column name"
        className={`flex-1 min-w-0 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
        }`}
        data-testid={`column-name-${column.id}`}
      />

      {/* Type select/input */}
      <div className="relative">
        <input
          type="text"
          value={column.type}
          onChange={handleTypeChange}
          disabled={disabled}
          placeholder="Type"
          list={`column-types-${column.id}`}
          className={`w-28 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
          }`}
          data-testid={`column-type-${column.id}`}
        />
        <datalist id={`column-types-${column.id}`}>
          {COMMON_COLUMN_TYPES.map((type) => (
            <option key={type} value={type} />
          ))}
        </datalist>
      </div>

      {/* Default value */}
      <input
        type="text"
        value={column.defaultValue ?? ''}
        onChange={handleDefaultChange}
        disabled={disabled}
        placeholder="Default"
        className={`w-20 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
        }`}
        data-testid={`column-default-${column.id}`}
      />

      {/* Constraint toggles */}
      <div className="flex gap-1">
        {/* Primary Key */}
        <button
          type="button"
          onClick={handlePkToggle}
          disabled={disabled}
          title="Primary Key"
          className={`w-7 h-7 text-xs font-bold rounded border transition-colors ${
            column.isPrimaryKey
              ? 'bg-yellow-100 border-yellow-400 text-yellow-700'
              : 'bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100'
          } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          data-testid={`column-pk-${column.id}`}
        >
          PK
        </button>

        {/* Not Null */}
        <button
          type="button"
          onClick={handleNnToggle}
          disabled={disabled}
          title="Not Null"
          className={`w-7 h-7 text-xs font-bold rounded border transition-colors ${
            column.isNotNull
              ? 'bg-blue-100 border-blue-400 text-blue-700'
              : 'bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100'
          } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          data-testid={`column-nn-${column.id}`}
        >
          NN
        </button>

        {/* Unique */}
        <button
          type="button"
          onClick={handleUqToggle}
          disabled={disabled}
          title="Unique"
          className={`w-7 h-7 text-xs font-bold rounded border transition-colors ${
            column.isUnique
              ? 'bg-purple-100 border-purple-400 text-purple-700'
              : 'bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100'
          } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          data-testid={`column-uq-${column.id}`}
        >
          UQ
        </button>
      </div>

      {/* Delete button or confirmation */}
      {showDeleteConfirm ? (
        <div className="flex gap-1" data-testid={`column-delete-confirm-${column.id}`}>
          <button
            type="button"
            onClick={handleConfirmDelete}
            className="px-2 py-1 text-xs text-white bg-red-500 rounded hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
            data-testid={`column-confirm-delete-${column.id}`}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={handleCancelDelete}
            className="px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400"
            data-testid={`column-cancel-delete-${column.id}`}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleDeleteClick}
          disabled={disabled}
          title="Remove column"
          className={`w-7 h-7 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors ${
            disabled ? 'cursor-not-allowed opacity-50' : ''
          }`}
          data-testid={`column-delete-${column.id}`}
        >
          <svg
            className="w-4 h-4 mx-auto"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
});

export default ColumnRow;
