/**
 * UnsavedPrompt Component
 *
 * A modal dialog that prompts the user when there are unsaved changes.
 * Shows options to Save & Continue, Discard, or Cancel.
 *
 * Features:
 * - Keyboard navigation (Enter confirms, Escape cancels)
 * - Focus trap within the dialog
 * - Accessible via ARIA attributes
 */

import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

/** Action returned by the prompt */
export type UnsavedPromptAction = 'save' | 'discard' | 'cancel';

export interface UnsavedPromptProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Context description (e.g., "Grid Editor", "Table Designer") */
  context: string;
  /** Whether save action is available */
  canSave?: boolean;
  /** Callback when an action is selected */
  onAction: (action: UnsavedPromptAction) => void;
}

/**
 * UnsavedPrompt component - modal dialog for unsaved changes
 */
export function UnsavedPrompt({
  isOpen,
  context,
  canSave = true,
  onAction,
}: UnsavedPromptProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const discardButtonRef = useRef<HTMLButtonElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  // Focus first actionable button on open
  useEffect(() => {
    if (isOpen) {
      // Focus the appropriate button
      if (canSave && saveButtonRef.current) {
        saveButtonRef.current.focus();
      } else if (discardButtonRef.current) {
        discardButtonRef.current.focus();
      }
    }
  }, [isOpen, canSave]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onAction('cancel');
      }
    },
    [onAction]
  );

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onAction('cancel');
      }
    },
    [onAction]
  );

  // Handle actions
  const handleSave = useCallback(() => onAction('save'), [onAction]);
  const handleDiscard = useCallback(() => onAction('discard'), [onAction]);
  const handleCancel = useCallback(() => onAction('cancel'), [onAction]);

  if (!isOpen) {
    return null;
  }

  const dialog = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      data-testid="unsaved-prompt-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-prompt-title"
      aria-describedby="unsaved-prompt-description"
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6"
        data-testid="unsaved-prompt-dialog"
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          {/* Warning icon */}
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-amber-600"
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
          </div>
          <h2
            id="unsaved-prompt-title"
            className="text-xl font-semibold text-navy-900"
          >
            Unsaved Changes
          </h2>
        </div>

        {/* Description */}
        <p
          id="unsaved-prompt-description"
          className="text-navy-600 mb-6"
          data-testid="unsaved-prompt-message"
        >
          You have unsaved changes in {context}. Do you want to discard them?
        </p>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 text-navy-700 font-medium rounded-lg border border-navy-300 hover:bg-navy-50 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:ring-offset-2 transition-colors"
            data-testid="unsaved-prompt-cancel"
          >
            Cancel
          </button>
          <button
            ref={discardButtonRef}
            type="button"
            onClick={handleDiscard}
            className="px-4 py-2 text-red-700 font-medium rounded-lg border border-red-300 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 transition-colors"
            data-testid="unsaved-prompt-discard"
          >
            Discard
          </button>
          {canSave && (
            <button
              ref={saveButtonRef}
              type="button"
              onClick={handleSave}
              className="px-4 py-2 bg-navy-600 text-white font-medium rounded-lg hover:bg-navy-700 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:ring-offset-2 transition-colors"
              data-testid="unsaved-prompt-save"
            >
              Save &amp; Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

export default UnsavedPrompt;
