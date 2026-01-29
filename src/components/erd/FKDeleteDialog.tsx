/**
 * Confirmation dialog for deleting a foreign key.
 *
 * Shows:
 * - Warning about data integrity implications
 * - FK reference info
 * - Type constraint name to confirm (for safety)
 * - Delete/Cancel buttons
 */

import { useState, useCallback, useEffect, useRef } from 'react'

export interface FKDeleteDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** FK information */
  fkInfo: {
    childTable: string
    childColumn: string
    parentTable: string
    parentColumn: string
  }
  /** Whether delete operation is in progress */
  isDeleting: boolean
  /** Called when delete is confirmed */
  onConfirm: () => void
  /** Called when cancel is clicked or dialog is closed */
  onClose: () => void
}

export function FKDeleteDialog({
  isOpen,
  fkInfo,
  isDeleting,
  onConfirm,
  onClose,
}: FKDeleteDialogProps) {
  const [confirmText, setConfirmText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Generate the constraint name for confirmation
  // Format: childTable_childColumn_fk
  const constraintName = `${fkInfo.childTable}_${fkInfo.childColumn}_fk`
  const isConfirmValid = confirmText === constraintName

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setConfirmText('')
      // Focus input after a short delay
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  const handleConfirm = useCallback(() => {
    if (isConfirmValid) {
      onConfirm()
    }
  }, [isConfirmValid, onConfirm])

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isDeleting) {
        onClose()
      }
    },
    [isDeleting, onClose]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && isConfirmValid && !isDeleting) {
        handleConfirm()
      }
    },
    [isConfirmValid, isDeleting, handleConfirm]
  )

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleOverlayClick}
      data-testid="fk-delete-dialog-overlay"
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4"
        data-testid="fk-delete-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-navy-200">
          <h2 className="text-lg font-semibold text-red-600">
            Delete Foreign Key
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Warning */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 space-y-2">
            <div className="flex items-start gap-2">
              <svg
                className="w-5 h-5 shrink-0 mt-0.5"
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
              <div>
                <strong>Warning:</strong> Deleting this foreign key will remove
                referential integrity constraints. This may allow orphaned records
                if the child table references non-existent parent records.
              </div>
            </div>
          </div>

          {/* FK Reference Display */}
          <div className="bg-navy-50 rounded-lg p-4 space-y-2">
            <div className="text-sm font-medium text-navy-700 mb-2">
              Foreign key to delete:
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-navy-500 font-medium w-14">From:</span>
              <code
                className="px-2 py-0.5 bg-navy-100 rounded text-navy-800"
                data-testid="fk-delete-child-ref"
              >
                {fkInfo.childTable}.{fkInfo.childColumn}
              </code>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-navy-500 font-medium w-14">To:</span>
              <code
                className="px-2 py-0.5 bg-navy-100 rounded text-navy-800"
                data-testid="fk-delete-parent-ref"
              >
                {fkInfo.parentTable}.{fkInfo.parentColumn}
              </code>
            </div>
          </div>

          {/* Confirmation input */}
          <div className="space-y-2">
            <label
              htmlFor="fk-delete-confirm-input"
              className="block text-sm text-navy-600"
            >
              Type{' '}
              <code className="px-1 py-0.5 bg-navy-100 rounded text-navy-800 font-mono text-xs">
                {constraintName}
              </code>{' '}
              to confirm:
            </label>
            <input
              ref={inputRef}
              id="fk-delete-confirm-input"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full px-3 py-2 border border-navy-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent font-mono"
              placeholder={constraintName}
              data-testid="fk-delete-confirm-input"
              disabled={isDeleting}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {/* Info about table rebuild */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
            <strong>Note:</strong> This requires a table rebuild for{' '}
            <code className="px-1 py-0.5 bg-amber-100 rounded">
              {fkInfo.childTable}
            </code>
            . The operation is transactional and safe.
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-navy-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-navy-600 hover:text-navy-800 hover:bg-navy-50 rounded-md transition-colors"
            data-testid="fk-delete-cancel-button"
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isConfirmValid || isDeleting}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              isConfirmValid && !isDeleting
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-red-200 text-red-400 cursor-not-allowed'
            }`}
            data-testid="fk-delete-confirm-button"
          >
            {isDeleting ? (
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
                Deleting...
              </span>
            ) : (
              'Delete Foreign Key'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default FKDeleteDialog
