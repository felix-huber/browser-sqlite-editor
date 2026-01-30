/**
 * ColumnRow Component
 *
 * A single row in the table designer column list.
 * Displays column properties: name, type, constraints (PK, NN, UQ).
 *
 * Features:
 * - Drag handle for reordering columns via drag-and-drop
 * - Inline editing of name, type, default value
 * - Toggle buttons for constraints
 * - Generated column support (read-only badge, disabled inputs)
 * - Delete button with optional confirmation
 * - Name validation on blur
 * - Auto-sets NOT NULL when PK is enabled
 * - Disabled state for read-only mode
 */

import { memo, useCallback, useRef, useEffect, useState } from 'react';
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

/** SQLite reserved words that cannot be used as column names */
export const SQLITE_RESERVED_WORDS = new Set([
  'ABORT', 'ACTION', 'ADD', 'AFTER', 'ALL', 'ALTER', 'ALWAYS', 'ANALYZE', 'AND',
  'AS', 'ASC', 'ATTACH', 'AUTOINCREMENT', 'BEFORE', 'BEGIN', 'BETWEEN', 'BY',
  'CASCADE', 'CASE', 'CAST', 'CHECK', 'COLLATE', 'COLUMN', 'COMMIT', 'CONFLICT',
  'CONSTRAINT', 'CREATE', 'CROSS', 'CURRENT', 'CURRENT_DATE', 'CURRENT_TIME',
  'CURRENT_TIMESTAMP', 'DATABASE', 'DEFAULT', 'DEFERRABLE', 'DEFERRED', 'DELETE',
  'DESC', 'DETACH', 'DISTINCT', 'DO', 'DROP', 'EACH', 'ELSE', 'END', 'ESCAPE',
  'EXCEPT', 'EXCLUDE', 'EXCLUSIVE', 'EXISTS', 'EXPLAIN', 'FAIL', 'FILTER',
  'FIRST', 'FOLLOWING', 'FOR', 'FOREIGN', 'FROM', 'FULL', 'GENERATED', 'GLOB',
  'GROUP', 'GROUPS', 'HAVING', 'IF', 'IGNORE', 'IMMEDIATE', 'IN', 'INDEX',
  'INDEXED', 'INITIALLY', 'INNER', 'INSERT', 'INSTEAD', 'INTERSECT', 'INTO',
  'IS', 'ISNULL', 'JOIN', 'KEY', 'LAST', 'LEFT', 'LIKE', 'LIMIT', 'MATCH',
  'MATERIALIZED', 'NATURAL', 'NO', 'NOT', 'NOTHING', 'NOTNULL', 'NULL', 'NULLS',
  'OF', 'OFFSET', 'ON', 'OR', 'ORDER', 'OTHERS', 'OUTER', 'OVER', 'PARTITION',
  'PLAN', 'PRAGMA', 'PRECEDING', 'PRIMARY', 'QUERY', 'RAISE', 'RANGE',
  'RECURSIVE', 'REFERENCES', 'REGEXP', 'REINDEX', 'RELEASE', 'RENAME', 'REPLACE',
  'RESTRICT', 'RETURNING', 'RIGHT', 'ROLLBACK', 'ROW', 'ROWS', 'SAVEPOINT',
  'SELECT', 'SET', 'TABLE', 'TEMP', 'TEMPORARY', 'THEN', 'TIES', 'TO',
  'TRANSACTION', 'TRIGGER', 'UNBOUNDED', 'UNION', 'UNIQUE', 'UPDATE', 'USING',
  'VACUUM', 'VALUES', 'VIEW', 'VIRTUAL', 'WHEN', 'WHERE', 'WINDOW', 'WITH',
  'WITHOUT',
]);

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
  /** List of other column names (for duplicate check) */
  existingColumnNames?: string[];
  /** Drag handlers from parent */
  dragHandleProps?: {
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  /** Whether this row is being dragged */
  isDragging?: boolean;
  /** Whether this row is a drop target */
  isDropTarget?: boolean;
  /** External validation error for the name field */
  externalNameError?: string | null;
  /** Notify parent of user interaction */
  onInteract?: () => void;
}

export interface ColumnNameValidation {
  valid: boolean;
  error?: string;
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate a column name
 */
export function validateColumnName(
  name: string,
  existingNames: string[] = [],
  originalName?: string
): ColumnNameValidation {
  const trimmed = name.trim();

  // Check empty
  if (trimmed.length === 0) {
    return { valid: false, error: 'Column name is required' };
  }

  // Check for spaces
  if (/\s/.test(trimmed)) {
    return { valid: false, error: 'Column name cannot contain spaces' };
  }

  // Check for reserved words (case-insensitive)
  if (SQLITE_RESERVED_WORDS.has(trimmed.toUpperCase())) {
    return { valid: false, error: `"${trimmed}" is a SQLite reserved word` };
  }

  // Check first character - must be letter or underscore
  if (!/^[a-zA-Z_]/.test(trimmed)) {
    return { valid: false, error: 'Column name must start with a letter or underscore' };
  }

  // Check valid characters (alphanumeric and underscore only)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return { valid: false, error: 'Column name can only contain letters, numbers, and underscores' };
  }

  // Check uniqueness (skip if name hasn't changed)
  if (originalName && trimmed.toLowerCase() === originalName.toLowerCase()) {
    // Name unchanged, skip uniqueness check
  } else {
    const isDuplicate = existingNames.some(
      (existing) => existing.toLowerCase() === trimmed.toLowerCase()
    );
    if (isDuplicate) {
      return { valid: false, error: 'A column with this name already exists' };
    }
  }

  return { valid: true };
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
  existingColumnNames = [],
  dragHandleProps,
  isDragging = false,
  isDropTarget = false,
  externalNameError = null,
  onInteract,
}: ColumnRowProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const displayNameError = externalNameError ?? nameError;

  // Determine if column is generated (should be read-only)
  const isGenerated = column.generated === 'stored' || column.generated === 'virtual';
  const isInputDisabled = disabled || isGenerated;

  // Auto-focus name input when newly added
  useEffect(() => {
    if (isNew && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isNew]);

  // Handle name change
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onInteract?.();
      onChange(column.id, { name: e.target.value });
      // Clear error on change (will validate on blur)
      if (nameError) {
        setNameError(null);
      }
    },
    [column.id, onChange, nameError, onInteract]
  );

  // Validate name on blur
  const handleNameBlur = useCallback(() => {
    onInteract?.();
    // The parent (TableDesigner) passes existingColumnNames excluding this column's name,
    // so we can safely check for duplicates without false positives from self-matching.
    // For existing columns, originalName is used to allow keeping the same name.
    const result = validateColumnName(column.name, existingColumnNames, column.originalName);
    setNameError(result.valid ? null : result.error ?? null);
  }, [column.name, column.originalName, existingColumnNames, onInteract]);

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

  // Toggle primary key - auto-sets NOT NULL
  const handlePkToggle = useCallback(() => {
    const newIsPrimaryKey = !column.isPrimaryKey;
    const updates: Partial<DesignerColumnDraft> = { isPrimaryKey: newIsPrimaryKey };
    // Auto-set NOT NULL when enabling PK
    if (newIsPrimaryKey && !column.isNotNull) {
      updates.isNotNull = true;
    }
    onChange(column.id, updates);
  }, [column.id, column.isPrimaryKey, column.isNotNull, onChange]);

  // Toggle not null
  const handleNnToggle = useCallback(() => {
    // Don't allow disabling NOT NULL if PK is set
    if (column.isPrimaryKey && column.isNotNull) {
      return; // PK columns must be NOT NULL
    }
    onChange(column.id, { isNotNull: !column.isNotNull });
  }, [column.id, column.isNotNull, column.isPrimaryKey, onChange]);

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
      className={`flex items-center gap-2 p-2 border rounded-lg bg-white transition-all ${
        disabled ? 'opacity-60' : ''
      } ${showDeleteConfirm ? 'ring-2 ring-red-200' : ''} ${
        isDragging ? 'opacity-50 shadow-lg' : ''
      } ${isDropTarget ? 'ring-2 ring-blue-400 bg-blue-50' : ''} ${
        isGenerated ? 'bg-gray-50' : ''
      }`}
      data-testid={`column-row-${column.id}`}
      draggable={!disabled && !isGenerated && !!dragHandleProps}
      onDragStart={dragHandleProps?.onDragStart}
      onDragEnd={dragHandleProps?.onDragEnd}
      onDragOver={dragHandleProps?.onDragOver}
      onDrop={dragHandleProps?.onDrop}
    >
      {/* Drag Handle */}
      <button
        type="button"
        className={`w-6 h-6 flex items-center justify-center cursor-grab text-gray-400 hover:text-gray-600 ${
          disabled || isGenerated ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        disabled={disabled || isGenerated}
        title="Drag to reorder"
        data-testid={`column-drag-${column.id}`}
        tabIndex={-1}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
        </svg>
      </button>

      {/* Index */}
      <span className="w-6 text-center text-xs text-gray-400 font-mono">
        {index}
      </span>

      {/* Name input */}
      <div className="flex-1 min-w-0 relative">
        <input
          ref={nameInputRef}
          type="text"
          value={column.name}
          onChange={handleNameChange}
          onBlur={handleNameBlur}
          disabled={isInputDisabled}
          placeholder="Column name"
          className={`w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            isInputDisabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
          } ${displayNameError ? 'border-red-500' : 'border-gray-300'}`}
          data-testid={`column-name-${column.id}`}
          aria-invalid={displayNameError ? 'true' : 'false'}
        />
        {displayNameError && (
          <p
            className="absolute left-0 top-full mt-0.5 text-xs text-red-600 whitespace-nowrap"
            data-testid={`column-name-error-${column.id}`}
            role="alert"
          >
            {displayNameError}
          </p>
        )}
      </div>

      {/* Type select/input */}
      <div className="relative">
        <input
          type="text"
          value={column.type}
          onChange={handleTypeChange}
          disabled={isInputDisabled}
          placeholder="Type"
          list={`column-types-${column.id}`}
          className={`w-28 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            isInputDisabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
          }`}
          data-testid={`column-type-${column.id}`}
        />
        <datalist id={`column-types-${column.id}`}>
          {COMMON_COLUMN_TYPES.map((type) => (
            <option key={type} value={type} />
          ))}
        </datalist>
      </div>

      {/* Generated column badge */}
      {isGenerated && (
        <span
          className={`px-2 py-0.5 text-xs font-medium rounded ${
            column.generated === 'stored'
              ? 'bg-green-100 text-green-700'
              : 'bg-cyan-100 text-cyan-700'
          }`}
          title={
            column.generatedExpression
              ? `AS (${column.generatedExpression})`
              : `${column.generated?.toUpperCase()} generated column`
          }
          data-testid={`column-generated-${column.id}`}
        >
          {column.generated === 'stored' ? 'STORED' : 'VIRTUAL'}
        </span>
      )}

      {/* Default value (only for non-generated columns) */}
      {!isGenerated && (
        <input
          type="text"
          value={column.defaultValue ?? ''}
          onChange={handleDefaultChange}
          disabled={isInputDisabled}
          placeholder="Default"
          className={`w-20 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            isInputDisabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
          }`}
          data-testid={`column-default-${column.id}`}
        />
      )}

      {/* Constraint toggles */}
      <div className="flex gap-1">
        {/* Primary Key */}
        <button
          type="button"
          onClick={handlePkToggle}
          disabled={isInputDisabled}
          title="Primary Key"
          className={`w-7 h-7 text-xs font-bold rounded border transition-colors ${
            column.isPrimaryKey
              ? 'bg-yellow-100 border-yellow-400 text-yellow-700'
              : 'bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100'
          } ${isInputDisabled ? 'cursor-not-allowed opacity-50' : ''}`}
          data-testid={`column-pk-${column.id}`}
        >
          PK
        </button>

        {/* Not Null */}
        <button
          type="button"
          onClick={handleNnToggle}
          disabled={isInputDisabled || (column.isPrimaryKey && column.isNotNull)}
          title={column.isPrimaryKey && column.isNotNull ? 'Primary key columns must be NOT NULL' : 'Not Null'}
          className={`w-7 h-7 text-xs font-bold rounded border transition-colors ${
            column.isNotNull
              ? 'bg-blue-100 border-blue-400 text-blue-700'
              : 'bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100'
          } ${isInputDisabled || (column.isPrimaryKey && column.isNotNull) ? 'cursor-not-allowed opacity-50' : ''}`}
          data-testid={`column-nn-${column.id}`}
        >
          NN
        </button>

        {/* Unique */}
        <button
          type="button"
          onClick={handleUqToggle}
          disabled={isInputDisabled}
          title="Unique"
          className={`w-7 h-7 text-xs font-bold rounded border transition-colors ${
            column.isUnique
              ? 'bg-purple-100 border-purple-400 text-purple-700'
              : 'bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100'
          } ${isInputDisabled ? 'cursor-not-allowed opacity-50' : ''}`}
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
