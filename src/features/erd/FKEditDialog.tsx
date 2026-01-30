/**
 * Dialog for editing FK ON DELETE/UPDATE actions.
 *
 * Shows:
 * - Read-only info: From table.column -> To table.column
 * - ON DELETE dropdown
 * - ON UPDATE dropdown
 * - Save/Cancel buttons
 */

import { useState, useCallback, useEffect } from 'react'
import type { ForeignKeyAction } from '../../types/index'

export interface FKEditDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** FK information */
  fkInfo: {
    childTable: string
    childColumn: string
    parentTable: string
    parentColumn: string
    onDelete: ForeignKeyAction
    onUpdate: ForeignKeyAction
  }
  /** Whether save operation is in progress */
  isSaving: boolean
  /** Called when save is clicked */
  onSave: (onDelete: ForeignKeyAction, onUpdate: ForeignKeyAction) => void
  /** Called when cancel is clicked or dialog is closed */
  onClose: () => void
}

const FK_ACTIONS: ForeignKeyAction[] = [
  'NO ACTION',
  'RESTRICT',
  'CASCADE',
  'SET NULL',
  'SET DEFAULT',
]

export function FKEditDialog({
  isOpen,
  fkInfo,
  isSaving,
  onSave,
  onClose,
}: FKEditDialogProps) {
  const [onDelete, setOnDelete] = useState<ForeignKeyAction>(fkInfo.onDelete)
  const [onUpdate, setOnUpdate] = useState<ForeignKeyAction>(fkInfo.onUpdate)

  // Reset state when dialog opens with new FK
  useEffect(() => {
    if (isOpen) {
      setOnDelete(fkInfo.onDelete)
      setOnUpdate(fkInfo.onUpdate)
    }
  }, [isOpen, fkInfo.onDelete, fkInfo.onUpdate])

  const handleSave = useCallback(() => {
    onSave(onDelete, onUpdate)
  }, [onSave, onDelete, onUpdate])

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isSaving) {
        onClose()
      }
    },
    [isSaving, onClose]
  )

  const hasChanges =
    onDelete !== fkInfo.onDelete || onUpdate !== fkInfo.onUpdate

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleOverlayClick}
      data-testid="fk-edit-dialog-overlay"
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4"
        data-testid="fk-edit-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-navy-200">
          <h2 className="text-lg font-semibold text-navy-800">
            Edit Foreign Key
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* FK Reference Display (read-only) */}
          <div className="bg-navy-50 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-navy-500 font-medium w-14">From:</span>
              <code
                className="px-2 py-0.5 bg-navy-100 rounded text-navy-800"
                data-testid="fk-edit-child-ref"
              >
                {fkInfo.childTable}.{fkInfo.childColumn}
              </code>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-navy-500 font-medium w-14">To:</span>
              <code
                className="px-2 py-0.5 bg-navy-100 rounded text-navy-800"
                data-testid="fk-edit-parent-ref"
              >
                {fkInfo.parentTable}.{fkInfo.parentColumn}
              </code>
            </div>
          </div>

          {/* FK Actions */}
          <div className="space-y-3">
            {/* ON DELETE */}
            <div className="flex items-center gap-3">
              <label
                htmlFor="fk-edit-on-delete"
                className="text-sm font-medium text-navy-600 w-24"
              >
                ON DELETE
              </label>
              <select
                id="fk-edit-on-delete"
                value={onDelete}
                onChange={(e) => setOnDelete(e.target.value as ForeignKeyAction)}
                className="flex-1 px-3 py-1.5 border border-navy-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy-500"
                data-testid="fk-edit-on-delete-select"
                disabled={isSaving}
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
                htmlFor="fk-edit-on-update"
                className="text-sm font-medium text-navy-600 w-24"
              >
                ON UPDATE
              </label>
              <select
                id="fk-edit-on-update"
                value={onUpdate}
                onChange={(e) => setOnUpdate(e.target.value as ForeignKeyAction)}
                className="flex-1 px-3 py-1.5 border border-navy-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy-500"
                data-testid="fk-edit-on-update-select"
                disabled={isSaving}
              >
                {FK_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Info about table rebuild */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
            <strong>Note:</strong> Modifying FK actions requires a table rebuild.
            This operation is transactional and safe, but may take a moment for
            large tables.
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-navy-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-navy-600 hover:text-navy-800 hover:bg-navy-50 rounded-md transition-colors"
            data-testid="fk-edit-cancel-button"
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              hasChanges && !isSaving
                ? 'bg-navy-600 text-white hover:bg-navy-700'
                : 'bg-navy-200 text-navy-400 cursor-not-allowed'
            }`}
            data-testid="fk-edit-save-button"
          >
            {isSaving ? (
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
                Saving...
              </span>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default FKEditDialog
