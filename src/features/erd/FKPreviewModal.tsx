/**
 * FK Preview Modal
 *
 * Shows DDL diff preview for FK operations (create/edit/delete).
 * Reuses the shared DDLDiffPreview component from P3-04.
 *
 * Features:
 * - Side-by-side before/after SQL with diff highlighting
 * - Rebuild warning (FK changes require child table rebuild)
 * - Integration with FK validation errors
 * - Confirm/Cancel actions
 */

import { useMemo, useCallback } from 'react'
import { DDLDiffPreview } from '../../shared/components/DDLDiffPreview'
import { useFKPreview, type FKOperationInfo, type FKOperationType } from './hooks/useFKPreview'

// =============================================================================
// Types
// =============================================================================

export interface FKPreviewModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** FK operation info */
  operation: FKOperationInfo | null
  /** Whether the operation is in progress */
  isExecuting: boolean
  /** Validation errors to display */
  validationErrors?: Array<{ message: string; isBlocking: boolean }>
  /** Called when the operation is confirmed */
  onConfirm: () => void
  /** Called when the modal is closed */
  onClose: () => void
}

// =============================================================================
// Helper Functions
// =============================================================================

function getModalTitle(type: FKOperationType | undefined): string {
  switch (type) {
    case 'create':
      return 'Create Foreign Key'
    case 'edit':
      return 'Edit Foreign Key'
    case 'delete':
      return 'Delete Foreign Key'
    default:
      return 'Foreign Key Operation'
  }
}

function getConfirmButtonLabel(type: FKOperationType | undefined, isExecuting: boolean): string {
  if (isExecuting) {
    switch (type) {
      case 'create':
        return 'Creating...'
      case 'edit':
        return 'Saving...'
      case 'delete':
        return 'Deleting...'
      default:
        return 'Executing...'
    }
  }

  switch (type) {
    case 'create':
      return 'Create'
    case 'edit':
      return 'Save'
    case 'delete':
      return 'Delete'
    default:
      return 'Confirm'
  }
}

function getButtonColorClass(type: FKOperationType | undefined, enabled: boolean): string {
  if (!enabled) {
    return 'bg-navy-200 text-navy-400 cursor-not-allowed'
  }

  if (type === 'delete') {
    return 'bg-red-600 text-white hover:bg-red-700'
  }

  return 'bg-navy-600 text-white hover:bg-navy-700'
}

// =============================================================================
// Component
// =============================================================================

export function FKPreviewModal({
  isOpen,
  operation,
  isExecuting,
  validationErrors = [],
  onConfirm,
  onClose,
}: FKPreviewModalProps) {
  // Get preview data
  const preview = useFKPreview({
    operation,
    isActive: isOpen,
  })

  // Check if there are blocking validation errors
  const hasBlockingErrors = useMemo(
    () => validationErrors.some((e) => e.isBlocking),
    [validationErrors]
  )

  // Can confirm if not loading, not executing, and no blocking errors
  const canConfirm = !preview.isLoading && !isExecuting && !hasBlockingErrors && !preview.error

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isExecuting) {
        onClose()
      }
    },
    [isExecuting, onClose]
  )

  if (!isOpen || !operation) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleOverlayClick}
      data-testid="fk-preview-modal-overlay"
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col"
        data-testid="fk-preview-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-navy-200 shrink-0">
          <h2 className="text-lg font-semibold text-navy-800">
            {getModalTitle(operation.type)}
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          {/* FK Reference Display */}
          <div className="bg-navy-50 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-navy-500 font-medium w-14">From:</span>
              <code
                className="px-2 py-0.5 bg-navy-100 rounded text-navy-800"
                data-testid="fk-preview-child-ref"
              >
                {operation.childTable}.{operation.childColumn}
              </code>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-navy-500 font-medium w-14">To:</span>
              <code
                className="px-2 py-0.5 bg-navy-100 rounded text-navy-800"
                data-testid="fk-preview-parent-ref"
              >
                {operation.parentTable}.{operation.parentColumn}
              </code>
            </div>
          </div>

          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className="space-y-2" data-testid="fk-preview-validation-errors">
              {validationErrors.map((error, index) => (
                <div
                  key={index}
                  className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
                    error.isBlocking
                      ? 'bg-red-50 border border-red-200 text-red-700'
                      : 'bg-amber-50 border border-amber-200 text-amber-700'
                  }`}
                  data-testid={`fk-preview-error-${index}`}
                >
                  <span className="shrink-0">{error.isBlocking ? '❌' : '⚠️'}</span>
                  <span>{error.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Loading State */}
          {preview.isLoading && (
            <div
              className="flex items-center gap-2 text-navy-500 text-sm p-3 bg-navy-50 rounded-lg"
              data-testid="fk-preview-loading"
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
              <span>Loading preview...</span>
            </div>
          )}

          {/* Error State */}
          {preview.error && (
            <div
              className="flex items-start gap-2 p-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-700"
              data-testid="fk-preview-error"
            >
              <span className="shrink-0">❌</span>
              <span>{preview.error}</span>
            </div>
          )}

          {/* DDL Diff Preview */}
          {!preview.isLoading && !preview.error && (
            <div data-testid="fk-preview-diff">
              <DDLDiffPreview
                originalSql={preview.originalSql}
                proposedSql={preview.proposedSql}
                dependentObjects={preview.dependentObjects}
                netEffectSummary={preview.netEffectSummary}
              />
            </div>
          )}

          {/* Rebuild Warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
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
                <strong>Rebuild Required:</strong> Foreign key changes require rebuilding
                the child table ({operation.childTable}). This operation is transactional
                and safe, but may take a moment for large tables.
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-navy-200 flex justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-navy-600 hover:text-navy-800 hover:bg-navy-50 rounded-md transition-colors"
            data-testid="fk-preview-cancel-button"
            disabled={isExecuting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${getButtonColorClass(
              operation.type,
              canConfirm
            )}`}
            data-testid="fk-preview-confirm-button"
          >
            {isExecuting ? (
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
                {getConfirmButtonLabel(operation.type, true)}
              </span>
            ) : (
              getConfirmButtonLabel(operation.type, false)
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default FKPreviewModal
