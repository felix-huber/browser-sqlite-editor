/**
 * TableDesigner Component
 *
 * A form for creating or editing SQLite tables.
 *
 * Features:
 * - Table name input with validation (no spaces, no reserved words)
 * - Column list with ColumnRow components
 * - Add column button (appends new column at end)
 * - Remove column (with confirmation if column has data)
 * - Read-only guard: disables all inputs when DB is read-only
 * - Edit mode: loads existing table schema into form
 * - Create mode: starts with empty form
 * - Tracks dirty state (changes since last save)
 * - Inline validation errors
 * - Submit button disabled until form is valid
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ColumnRow, SQLITE_RESERVED_WORDS } from './ColumnRow';
import { extractGeneratedExpressionFromCreateSql } from '../../core/db/generated-columns';
import type { DesignerColumnDraft, TableInfo } from '../../types';

// Re-export SQLITE_RESERVED_WORDS for backwards compatibility
export { SQLITE_RESERVED_WORDS };

// =============================================================================
// Drag and Drop State
// =============================================================================

interface DragState {
  draggedId: string | null;
  dropTargetId: string | null;
}

/** Validation debounce delay in ms */
const VALIDATION_DEBOUNCE_MS = 150;

// =============================================================================
// Types
// =============================================================================

export interface TableDesignerProps {
  /** Whether in read-only mode (disables all inputs) */
  isReadOnly?: boolean;
  /** Existing table info for edit mode (null for create mode) */
  existingTable?: TableInfo | null;
  /** List of existing table names (for uniqueness validation) */
  existingTableNames?: string[];
  /** Called when form is submitted */
  onSubmit?: (tableName: string, columns: DesignerColumnDraft[]) => void;
  /** Called when form is cancelled */
  onCancel?: () => void;
  /** Called when dirty state changes */
  onDirtyChange?: (isDirty: boolean) => void;
  /** Called when table name or columns change (for preview/parent state) */
  onDraftChange?: (tableName: string, columns: DesignerColumnDraft[]) => void;
  /** Increment to reset dirty tracking after a successful save */
  resetToken?: number;
}

export interface TableNameValidation {
  valid: boolean;
  error?: string;
}

// =============================================================================
// Helpers
// =============================================================================

/** Generate unique ID for columns */
function generateId(): string {
  return `col-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Create an empty column draft */
function createEmptyColumn(): DesignerColumnDraft {
  return {
    id: generateId(),
    name: '',
    type: 'TEXT',
    isPrimaryKey: false,
    isNotNull: false,
    isUnique: false,
    defaultValue: null,
    isExisting: false,
  };
}

/** Convert TableInfo to DesignerColumnDraft array */
function tableInfoToColumns(tableInfo: TableInfo): DesignerColumnDraft[] {
  return tableInfo.columns.map((col) => ({
    id: generateId(),
    name: col.name,
    type: col.type || 'TEXT',
    isPrimaryKey: col.pk > 0,
    isNotNull: col.notnull,
    isUnique: false, // Would need to check indexes to determine
    defaultValue: col.dfltValue,
    isExisting: true,
    originalName: col.name,
    generated: col.generated,
    generatedExpression:
      col.generated && tableInfo.createSql
        ? extractGeneratedExpressionFromCreateSql(tableInfo.createSql, col.name)
        : null,
  }));
}

/**
 * Validate a table name
 */
export function validateTableName(
  name: string,
  existingNames: string[] = [],
  isEditing = false,
  originalName?: string
): TableNameValidation {
  const trimmed = name.trim();

  // Check empty
  if (trimmed.length === 0) {
    return { valid: false, error: 'Table name is required' };
  }

  // Check for spaces (SQLite allows them with quoting, but we disallow for simplicity)
  if (/\s/.test(trimmed)) {
    return { valid: false, error: 'Table name cannot contain spaces' };
  }

  // Check for reserved words (case-insensitive)
  if (SQLITE_RESERVED_WORDS.has(trimmed.toUpperCase())) {
    return { valid: false, error: `"${trimmed}" is a SQLite reserved word` };
  }

  // Check first character - must be letter or underscore
  if (!/^[a-zA-Z_]/.test(trimmed)) {
    return { valid: false, error: 'Table name must start with a letter or underscore' };
  }

  // Check valid characters (alphanumeric and underscore only)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return { valid: false, error: 'Table name can only contain letters, numbers, and underscores' };
  }

  // Check uniqueness (skip if editing and name hasn't changed)
  if (isEditing && originalName && trimmed.toLowerCase() === originalName.toLowerCase()) {
    // Name unchanged, skip uniqueness check
  } else {
    const isDuplicate = existingNames.some(
      (existing) => existing.toLowerCase() === trimmed.toLowerCase()
    );
    if (isDuplicate) {
      return { valid: false, error: 'A table with this name already exists' };
    }
  }

  return { valid: true };
}

/**
 * Check if form is valid for submission
 */
function validateForm(
  tableName: string,
  columns: DesignerColumnDraft[],
  existingNames: string[],
  isEditing: boolean,
  originalName?: string
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  // Validate table name
  const nameValidation = validateTableName(tableName, existingNames, isEditing, originalName);
  if (!nameValidation.valid && nameValidation.error) {
    errors.tableName = nameValidation.error;
  }

  // Must have at least one column
  if (columns.length === 0) {
    errors.columns = 'At least one column is required';
  }

  // Validate each column has a name
  columns.forEach((col) => {
    if (!col.name.trim()) {
      errors[`column-${col.id}`] = 'Column name is required';
    }
  });

  // Check for duplicate column names
  const namesSeen = new Set<string>();
  columns.forEach((col) => {
    const lower = col.name.toLowerCase().trim();
    if (lower && namesSeen.has(lower)) {
      errors[`column-${col.id}`] = 'A column with this name already exists';
    }
    namesSeen.add(lower);
  });

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

// =============================================================================
// Component
// =============================================================================

export function TableDesigner({
  isReadOnly = false,
  existingTable = null,
  existingTableNames = [],
  onSubmit,
  onCancel,
  onDirtyChange,
  onDraftChange,
  resetToken,
}: TableDesignerProps) {
  // Form state
  const [tableName, setTableName] = useState('');
  const tableNameInputRef = useRef<HTMLInputElement | null>(null);
  const [columns, setColumns] = useState<DesignerColumnDraft[]>(() => [createEmptyColumn()]);
  const initializedTableRef = useRef<string | null>(null);
  const tableNameEditedRef = useRef(false);
  const columnsEditedRef = useRef(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newColumnId, setNewColumnId] = useState<string | null>(null);
  const initialColumnsRef = useRef(columns);

  // Validation state
  const [tableNameError, setTableNameError] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);

  // Drag and drop state
  const [dragState, setDragState] = useState<DragState>({ draggedId: null, dropTargetId: null });

  // Track dirty state
  const [isDirty, setIsDirty] = useState(false);
  const initialStateRef = useRef<{ tableName: string; columns: DesignerColumnDraft[] } | null>(null);
  const didInitRef = useRef(false);
  const lastResetTokenRef = useRef<number | undefined>(resetToken);

  // Derived state
  const isEditing = existingTable !== null;
  const originalTableName = existingTable?.name;

  // Initialize form from existing table or create empty
  useEffect(() => {
    if (existingTable) {
      const tableNameValue = existingTable.name;
      const isFirstLoad = initializedTableRef.current === null;
      const isSameTable = initializedTableRef.current === tableNameValue;
      if (!isSameTable) {
        initializedTableRef.current = tableNameValue;
        if (!isFirstLoad) {
          tableNameEditedRef.current = false;
          columnsEditedRef.current = false;
        }
      }

      const cols = tableInfoToColumns(existingTable);
      if (!tableNameEditedRef.current) {
        setTableName(tableNameValue);
      }
      if (!columnsEditedRef.current) {
        setColumns(cols);
      }
      initialStateRef.current = { tableName: tableNameValue, columns: cols };
      if (!tableNameEditedRef.current && !columnsEditedRef.current) {
        setIsDirty(false);
        setHasInteracted(false);
      }
      didInitRef.current = true;
      return;
    }

    if (didInitRef.current) {
      const emptyCol = createEmptyColumn();
      initializedTableRef.current = null;
      tableNameEditedRef.current = false;
      columnsEditedRef.current = false;
      setTableName('');
      setColumns([emptyCol]);
      initialStateRef.current = { tableName: '', columns: [emptyCol] };
      setIsDirty(false);
      setHasInteracted(false);
      return;
    }

    initialStateRef.current = { tableName: '', columns: initialColumnsRef.current };
    setIsDirty(false);
    setHasInteracted(false);
    didInitRef.current = true;
  }, [existingTable]);

  // Track dirty state
  useEffect(() => {
    if (!initialStateRef.current) return;

    const initial = initialStateRef.current;
    const nameChanged = tableName !== initial.tableName;
    const columnsChanged =
      columns.length !== initial.columns.length ||
      columns.some((col, i) => {
        const orig = initial.columns[i];
        if (!orig) return true;
        return (
          col.name !== orig.name ||
          col.type !== orig.type ||
          col.isPrimaryKey !== orig.isPrimaryKey ||
          col.isNotNull !== orig.isNotNull ||
          col.isUnique !== orig.isUnique ||
          col.defaultValue !== orig.defaultValue
        );
      });

    const dirty = nameChanged || columnsChanged;
    setIsDirty(dirty);
    onDirtyChange?.(dirty);
  }, [tableName, columns, onDirtyChange]);

  useEffect(() => {
    if (resetToken === undefined) return;
    if (lastResetTokenRef.current === resetToken) return;
    lastResetTokenRef.current = resetToken;
    tableNameEditedRef.current = false;
    columnsEditedRef.current = false;
    initialStateRef.current = { tableName, columns };
    setIsDirty(false);
    setHasInteracted(false);
    onDirtyChange?.(false);
  }, [resetToken, tableName, columns, onDirtyChange]);

  // Notify parent of draft changes for live preview
  useEffect(() => {
    onDraftChange?.(tableName, columns);
  }, [tableName, columns, onDraftChange]);

  // Debounced table name validation
  useEffect(() => {
    if (!hasInteracted) return;

    const timer = setTimeout(() => {
      const result = validateTableName(
        tableName,
        existingTableNames,
        isEditing,
        originalTableName
      );
      setTableNameError(result.valid ? null : result.error ?? null);
    }, VALIDATION_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [tableName, existingTableNames, isEditing, originalTableName, hasInteracted]);

  // Form validation for submit
  const formValidation = useMemo(() => {
    return validateForm(tableName, columns, existingTableNames, isEditing, originalTableName);
  }, [tableName, columns, existingTableNames, isEditing, originalTableName]);

  // Handlers
  const handleTableNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    tableNameEditedRef.current = true;
    setTableName(e.target.value);
    if (!hasInteracted) setHasInteracted(true);
  }, [hasInteracted]);

  const handleTableNameFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    if (!isEditing) return;
    e.currentTarget.select();
  }, [isEditing]);

  const handleColumnChange = useCallback(
    (id: string, updates: Partial<DesignerColumnDraft>) => {
      columnsEditedRef.current = true;
      setColumns((prev) =>
        prev.map((col) => (col.id === id ? { ...col, ...updates } : col))
      );
    },
    []
  );

  const handleColumnInteract = useCallback(() => {
    if (!hasInteracted) setHasInteracted(true);
  }, [hasInteracted]);

  const handleAddColumn = useCallback(() => {
    columnsEditedRef.current = true;
    const newCol = createEmptyColumn();
    setColumns((prev) => [...prev, newCol]);
    setNewColumnId(newCol.id);
    // Clear the "new" status after a short delay
    setTimeout(() => setNewColumnId(null), 100);
  }, []);

  const handleDeleteColumn = useCallback((id: string) => {
    columnsEditedRef.current = true;
    setColumns((prev) => prev.filter((col) => col.id !== id));
    setDeleteConfirmId(null);
  }, []);

  const handleToggleDeleteConfirm = useCallback((id: string, show: boolean) => {
    setDeleteConfirmId(show ? id : null);
  }, []);

  // Drag and drop handlers
  const createDragHandlers = useCallback(
    (columnId: string) => ({
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', columnId);
        setDragState({ draggedId: columnId, dropTargetId: null });
      },
      onDragEnd: () => {
        setDragState({ draggedId: null, dropTargetId: null });
      },
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragState.draggedId && dragState.draggedId !== columnId) {
          setDragState((prev) => ({ ...prev, dropTargetId: columnId }));
        }
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId && draggedId !== columnId) {
          columnsEditedRef.current = true;
          setColumns((prev) => {
            const draggedIndex = prev.findIndex((c) => c.id === draggedId);
            const dropIndex = prev.findIndex((c) => c.id === columnId);
            if (draggedIndex === -1 || dropIndex === -1) return prev;

            const newColumns = [...prev];
            const [draggedCol] = newColumns.splice(draggedIndex, 1);
            newColumns.splice(dropIndex, 0, draggedCol);
            return newColumns;
          });
        }
        setDragState({ draggedId: null, dropTargetId: null });
      },
    }),
    [dragState.draggedId]
  );

  // Get column names for validation - returns names excluding a specific column ID
  // This prevents false positive duplicate errors when validating a column's own name
  const getOtherColumnNames = useCallback(
    (excludeId: string) => columns.filter((c) => c.id !== excludeId).map((c) => c.name),
    [columns]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!formValidation.valid || isReadOnly) return;
      const rawName = tableNameInputRef.current?.value ?? tableName;
      onSubmit?.(rawName.trim(), columns);
    },
    [formValidation.valid, isReadOnly, onSubmit, tableName, columns]
  );

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  // Show validation errors only after interaction
  const showTableNameError = hasInteracted && tableNameError;
  const showColumnError = hasInteracted && formValidation.errors.columns;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col h-full bg-gray-50"
      data-testid="table-designer"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b bg-white">
        <h2 className="text-lg font-semibold text-gray-900">
          {isEditing ? 'Edit Table' : 'Create Table'}
        </h2>
        {isReadOnly && (
          <p className="text-sm text-amber-600 mt-1" data-testid="readonly-notice">
            Read-only mode: editing is disabled
          </p>
        )}
      </div>

      {/* Table Name */}
      <div className="px-4 py-3 border-b bg-white">
        <label
          htmlFor="table-name-input"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Table Name
        </label>
        <input
          id="table-name-input"
          type="text"
          value={tableName}
          onChange={handleTableNameChange}
          onFocus={handleTableNameFocus}
          ref={tableNameInputRef}
          disabled={isReadOnly}
          placeholder="Enter table name"
          className={`w-full max-w-md px-3 py-2 border rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
            showTableNameError ? 'border-red-500' : 'border-gray-300'
          } ${isReadOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          data-testid="table-name-input"
          aria-invalid={showTableNameError ? 'true' : 'false'}
          aria-describedby={showTableNameError ? 'table-name-error' : undefined}
        />
        {showTableNameError && (
          <p
            id="table-name-error"
            className="mt-1 text-sm text-red-600"
            data-testid="table-name-error"
            role="alert"
          >
            {tableNameError}
          </p>
        )}
      </div>

      {/* Columns Section */}
      <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">Columns</h3>
          <button
            type="button"
            onClick={handleAddColumn}
            disabled={isReadOnly}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              isReadOnly
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
            }`}
            data-testid="add-column-button"
          >
            + Add Column
          </button>
        </div>

        {showColumnError && (
          <p
            className="mb-2 text-sm text-red-600"
            data-testid="columns-error"
            role="alert"
          >
            {formValidation.errors.columns}
          </p>
        )}

        {/* Column List */}
        <div className="space-y-2" data-testid="column-list">
          {columns.map((column, index) => (
            <ColumnRow
              key={column.id}
              column={column}
              disabled={isReadOnly}
              showDeleteConfirm={deleteConfirmId === column.id}
              onChange={handleColumnChange}
              onDelete={handleDeleteColumn}
              onToggleDeleteConfirm={handleToggleDeleteConfirm}
              isNew={newColumnId === column.id}
              index={index + 1}
              existingColumnNames={getOtherColumnNames(column.id)}
              externalNameError={
                hasInteracted ? formValidation.errors[`column-${column.id}`] ?? null : null
              }
              onInteract={handleColumnInteract}
              dragHandleProps={!isReadOnly ? createDragHandlers(column.id) : undefined}
              isDragging={dragState.draggedId === column.id}
              isDropTarget={dragState.dropTargetId === column.id}
            />
          ))}
        </div>

        {columns.length === 0 && (
          <div
            className="text-center py-8 text-gray-500"
            data-testid="no-columns-message"
          >
            No columns defined. Click "Add Column" to add one.
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t bg-white flex justify-between items-center">
        <div className="text-sm text-gray-500">
          {isDirty && (
            <span className="text-amber-600" data-testid="dirty-indicator">
              Unsaved changes
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 text-gray-700 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
            data-testid="cancel-button"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!formValidation.valid || isReadOnly}
            className={`px-4 py-2 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors ${
              !formValidation.valid || isReadOnly
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-600'
            }`}
            data-testid="submit-button"
          >
            {isEditing ? 'Save Changes' : 'Create Table'}
          </button>
        </div>
      </div>
    </form>
  );
}

export default TableDesigner;
