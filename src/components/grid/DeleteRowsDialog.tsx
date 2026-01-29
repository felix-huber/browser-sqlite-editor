/**
 * DeleteRowsDialog Component
 *
 * Confirmation dialog for deleting selected rows.
 * Shows warning about cascade deletions when FK relationships exist.
 */

import { memo, useCallback, useEffect, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

// =============================================================================
// Types
// =============================================================================

export interface DeleteRowsDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Number of rows to delete */
  rowCount: number;
  /** Whether deletion may cause cascade deletions */
  hasForeignKeys?: boolean;
  /** Called when the dialog is closed */
  onClose: () => void;
  /** Called when delete is confirmed */
  onConfirm: () => void;
  /** Whether a deletion is in progress */
  isDeleting?: boolean;
  /** Error message to display */
  error?: string | null;
}

// =============================================================================
// Component
// =============================================================================

export const DeleteRowsDialog = memo(function DeleteRowsDialog({
  isOpen,
  rowCount,
  hasForeignKeys = false,
  onClose,
  onConfirm,
  isDeleting = false,
  error = null,
}: DeleteRowsDialogProps) {
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  // Focus trap for accessibility
  const { containerRef: focusTrapRef } = useFocusTrap({
    isActive: isOpen,
    autoFocus: true,
    returnFocus: true,
  });

  // Focus delete button when dialog opens
  useEffect(() => {
    if (isOpen && deleteButtonRef.current) {
      setTimeout(() => {
        deleteButtonRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-rows-dialog-title"
      data-testid="delete-rows-dialog"
    >
      <div
        ref={focusTrapRef as React.RefObject<HTMLDivElement>}
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 id="delete-rows-dialog-title" className="text-lg font-semibold text-gray-900">
            Delete Rows?
          </h2>
        </div>

        {/* Content */}
        <div className="px-4 py-4 space-y-3">
          <p className="text-gray-700">
            Are you sure you want to delete{' '}
            <span className="font-semibold">{rowCount} row{rowCount !== 1 ? 's' : ''}</span>?
            This action cannot be undone.
          </p>

          {/* FK cascade warning */}
          {hasForeignKeys && (
            <div
              className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-sm text-amber-700"
              data-testid="fk-cascade-warning"
            >
              <span className="font-medium">Warning:</span> This may cause cascade deletions in related tables.
            </div>
          )}

          {/* Error message */}
          {error && (
            <div
              className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700"
              data-testid="delete-rows-error"
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
            disabled={isDeleting}
            data-testid="delete-rows-cancel"
          >
            Cancel
          </button>
          <button
            ref={deleteButtonRef}
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isDeleting}
            data-testid="delete-rows-confirm"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
});

export default DeleteRowsDialog;
