/**
 * FK Validation Dialog for ERD drag-to-create foreign key flow.
 *
 * Shows validation results and allows configuring ON DELETE/UPDATE actions
 * before creating the FK relationship via table rebuild.
 */

import { useState, useCallback, useEffect } from 'react'
import type { ForeignKeyAction } from '../../types/index'

// =============================================================================
// Types
// =============================================================================

/**
 * Column info for FK validation
 */
export interface ColumnInfo {
  name: string
  type: string
  isPrimaryKey: boolean
  isUnique: boolean
  isNotNull: boolean
}

/**
 * Table info for FK validation
 */
export interface TableInfo {
  name: string
  columns: ColumnInfo[]
}

/**
 * Validation error types
 */
export type ValidationErrorType =
  | 'PARENT_NOT_UNIQUE'
  | 'TYPE_MISMATCH'
  | 'DUPLICATE_FK'
  | 'SELF_REFERENCE_SAME_COLUMN'
  | 'READ_ONLY'

/**
 * Validation result
 */
export interface ValidationError {
  type: ValidationErrorType
  message: string
  isBlocking: boolean // If true, prevents FK creation
}

/**
 * Pending FK creation info from drag
 */
export interface PendingFKInfo {
  /** Child table (source of FK) */
  childTable: string
  /** Child column */
  childColumn: string
  /** Parent table (referenced) */
  parentTable: string
  /** Parent column (referenced) */
  parentColumn: string
}

/**
 * Props for FKValidationDialog
 */
export interface FKValidationDialogProps {
  /** Whether dialog is open */
  isOpen: boolean
  /** Pending FK info */
  pendingFK: PendingFKInfo | null
  /** Validation errors */
  errors: ValidationError[]
  /** Whether validation is in progress */
  isValidating: boolean
  /** Whether FK creation is in progress */
  isCreating: boolean
  /** Callback when dialog is closed */
  onClose: () => void
  /** Callback when FK is confirmed for creation */
  onCreate: (onDelete: ForeignKeyAction, onUpdate: ForeignKeyAction) => void
}

// =============================================================================
// FK Actions
// =============================================================================

const FK_ACTIONS: ForeignKeyAction[] = [
  'NO ACTION',
  'RESTRICT',
  'CASCADE',
  'SET NULL',
  'SET DEFAULT',
]

// =============================================================================
// Component
// =============================================================================

/**
 * Dialog for validating and creating foreign keys via drag-and-drop.
 */
export function FKValidationDialog({
  isOpen,
  pendingFK,
  errors,
  isValidating,
  isCreating,
  onClose,
  onCreate,
}: FKValidationDialogProps) {
  const [onDelete, setOnDelete] = useState<ForeignKeyAction>('NO ACTION')
  const [onUpdate, setOnUpdate] = useState<ForeignKeyAction>('NO ACTION')

  // Reset actions when dialog opens with new FK
  useEffect(() => {
    if (isOpen) {
      setOnDelete('NO ACTION')
      setOnUpdate('NO ACTION')
    }
  }, [isOpen, pendingFK?.childColumn, pendingFK?.parentColumn])

  const handleCreate = useCallback(() => {
    onCreate(onDelete, onUpdate)
  }, [onCreate, onDelete, onUpdate])

  const hasBlockingErrors = errors.some((e) => e.isBlocking)
  const canCreate = !isValidating && !isCreating && !hasBlockingErrors

  if (!isOpen || !pendingFK) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="fk-validation-dialog-overlay"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4"
        data-testid="fk-validation-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-navy-200">
          <h2 className="text-lg font-semibold text-navy-800">
            Create Foreign Key?
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* FK Reference Display */}
          <div className="bg-navy-50 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-navy-500 font-medium">From:</span>
              <code
                className="px-2 py-0.5 bg-navy-100 rounded text-navy-800"
                data-testid="fk-child-ref"
              >
                {pendingFK.childTable}.{pendingFK.childColumn}
              </code>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-navy-500 font-medium">To:</span>
              <code
                className="px-2 py-0.5 bg-navy-100 rounded text-navy-800"
                data-testid="fk-parent-ref"
              >
                {pendingFK.parentTable}.{pendingFK.parentColumn}
              </code>
            </div>
          </div>

          {/* Validation Errors */}
          {errors.length > 0 && (
            <div className="space-y-2" data-testid="validation-errors">
              {errors.map((error, index) => (
                <div
                  key={index}
                  className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
                    error.isBlocking
                      ? 'bg-red-50 border border-red-200 text-red-700'
                      : 'bg-amber-50 border border-amber-200 text-amber-700'
                  }`}
                  data-testid={`validation-error-${index}`}
                  data-error-type={error.type}
                >
                  <span className="shrink-0">
                    {error.isBlocking ? '❌' : '⚠️'}
                  </span>
                  <span>{error.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Validation in progress */}
          {isValidating && (
            <div
              className="flex items-center gap-2 text-navy-500 text-sm"
              data-testid="validation-loading"
            >
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>Validating foreign key...</span>
            </div>
          )}

          {/* FK Actions */}
          {!isValidating && (
            <div className="space-y-3">
              {/* ON DELETE */}
              <div className="flex items-center gap-3">
                <label
                  htmlFor="fk-on-delete"
                  className="text-sm font-medium text-navy-600 w-24"
                >
                  ON DELETE
                </label>
                <select
                  id="fk-on-delete"
                  value={onDelete}
                  onChange={(e) => setOnDelete(e.target.value as ForeignKeyAction)}
                  className="flex-1 px-3 py-1.5 border border-navy-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy-500"
                  data-testid="fk-on-delete-select"
                  disabled={isCreating}
                >
                  {FK_ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
              </div>

              {/* ON UPDATE */}
              <div className="flex items-center gap-3">
                <label
                  htmlFor="fk-on-update"
                  className="text-sm font-medium text-navy-600 w-24"
                >
                  ON UPDATE
                </label>
                <select
                  id="fk-on-update"
                  value={onUpdate}
                  onChange={(e) => setOnUpdate(e.target.value as ForeignKeyAction)}
                  className="flex-1 px-3 py-1.5 border border-navy-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy-500"
                  data-testid="fk-on-update-select"
                  disabled={isCreating}
                >
                  {FK_ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-navy-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-navy-600 hover:text-navy-800 hover:bg-navy-50 rounded-md transition-colors"
            data-testid="fk-cancel-button"
            disabled={isCreating}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              canCreate
                ? 'bg-navy-600 text-white hover:bg-navy-700'
                : 'bg-navy-200 text-navy-400 cursor-not-allowed'
            }`}
            data-testid="fk-create-button"
          >
            {isCreating ? (
              <span className="flex items-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Creating...
              </span>
            ) : (
              'Create'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validates a pending FK relationship.
 *
 * @param pendingFK - The pending FK info
 * @param childTableInfo - Info about the child table
 * @param parentTableInfo - Info about the parent table
 * @param existingFKs - Existing FKs from the child table
 * @returns Array of validation errors
 */
export function validateForeignKey(
  pendingFK: PendingFKInfo,
  childTableInfo: TableInfo,
  parentTableInfo: TableInfo,
  existingFKs: Array<{ childColumn: string; parentTable: string; parentColumn: string }>
): ValidationError[] {
  const errors: ValidationError[] = []

  // Find column info
  const childCol = childTableInfo.columns.find(
    (c) => c.name.toLowerCase() === pendingFK.childColumn.toLowerCase()
  )
  const parentCol = parentTableInfo.columns.find(
    (c) => c.name.toLowerCase() === pendingFK.parentColumn.toLowerCase()
  )

  // 1. Parent column must be PK or UNIQUE (SQLite requirement)
  if (parentCol && !parentCol.isPrimaryKey && !parentCol.isUnique) {
    errors.push({
      type: 'PARENT_NOT_UNIQUE',
      message: `Parent column "${pendingFK.parentColumn}" must be PRIMARY KEY or UNIQUE`,
      isBlocking: true,
    })
  }

  // 2. Type compatibility check (warning only, not blocking)
  if (childCol && parentCol) {
    const childType = normalizeType(childCol.type)
    const parentType = normalizeType(parentCol.type)
    if (childType !== parentType) {
      errors.push({
        type: 'TYPE_MISMATCH',
        message: `Type mismatch: "${pendingFK.childColumn}" (${childCol.type}) → "${pendingFK.parentColumn}" (${parentCol.type})`,
        isBlocking: false, // SQLite allows this but it's a warning
      })
    }
  }

  // 3. Check for duplicate FK
  const isDuplicate = existingFKs.some(
    (fk) =>
      fk.childColumn.toLowerCase() === pendingFK.childColumn.toLowerCase() &&
      fk.parentTable.toLowerCase() === pendingFK.parentTable.toLowerCase() &&
      fk.parentColumn.toLowerCase() === pendingFK.parentColumn.toLowerCase()
  )
  if (isDuplicate) {
    errors.push({
      type: 'DUPLICATE_FK',
      message: 'This foreign key relationship already exists',
      isBlocking: true,
    })
  }

  // 4. Self-reference same column check
  if (
    pendingFK.childTable.toLowerCase() === pendingFK.parentTable.toLowerCase() &&
    pendingFK.childColumn.toLowerCase() === pendingFK.parentColumn.toLowerCase()
  ) {
    errors.push({
      type: 'SELF_REFERENCE_SAME_COLUMN',
      message: 'Cannot create FK referencing the same column',
      isBlocking: true,
    })
  }

  return errors
}

/**
 * Normalizes SQLite type for comparison.
 */
function normalizeType(type: string): string {
  const upper = type.toUpperCase().trim()
  // SQLite type affinity rules
  if (upper.includes('INT')) return 'INTEGER'
  if (upper.includes('CHAR') || upper.includes('TEXT') || upper.includes('CLOB'))
    return 'TEXT'
  if (upper.includes('BLOB') || upper === '') return 'BLOB'
  if (
    upper.includes('REAL') ||
    upper.includes('FLOAT') ||
    upper.includes('DOUB')
  )
    return 'REAL'
  return 'NUMERIC'
}

export default FKValidationDialog
