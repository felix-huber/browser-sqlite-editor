/**
 * ConfirmDialog Component
 *
 * A reusable confirmation dialog for destructive operations.
 * Supports three variants:
 * 1. Simple confirm: 'Are you sure?' with Cancel/Delete
 * 2. Type-to-confirm: Must type confirmation text to enable Delete button
 * 3. With dependency warning: Lists affected objects before confirming
 *
 * Features:
 * - Destructive styling (red button)
 * - Typed action description
 * - Warning about cascading effects
 * - Keyboard navigation (Enter confirms when enabled, Escape cancels)
 * - Focus trap within the dialog
 * - Accessible via ARIA attributes
 */

import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../hooks/useFocusTrap';

// =============================================================================
// Types
// =============================================================================

/** Dependent object that will be affected by the destructive operation */
export interface DependentObject {
  /** Type of object (e.g., 'view', 'trigger', 'index', 'foreign_key') */
  type: 'view' | 'trigger' | 'index' | 'foreign_key' | 'table';
  /** Name of the object */
  name: string;
}

export interface ConfirmDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Title of the dialog */
  title: string;
  /** Description/message to display */
  message: string;
  /** Text for the confirm button */
  confirmLabel?: string;
  /** Text for the cancel button */
  cancelLabel?: string;
  /** Whether this requires type-to-confirm (for highly destructive actions) */
  requiresTypeConfirm?: boolean;
  /** Text that must be typed to confirm (when requiresTypeConfirm is true) */
  confirmText?: string;
  /** List of dependent objects that will be affected */
  dependentObjects?: DependentObject[];
  /** Whether the confirm operation is in progress */
  isConfirming?: boolean;
  /** Called when the dialog is cancelled */
  onCancel: () => void;
  /** Called when the action is confirmed */
  onConfirm: () => void;
}

// =============================================================================
// Helper Components
// =============================================================================

/** Warning icon SVG */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

/** Spinner icon for loading state */
function SpinnerIcon() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
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
  );
}

/** Icon mapping for dependent object types */
function DependentObjectIcon({ type }: { type: DependentObject['type'] }) {
  const iconClasses = 'w-4 h-4 text-amber-600';

  switch (type) {
    case 'view':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      );
    case 'trigger':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    case 'index':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
      );
    case 'foreign_key':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      );
    case 'table':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      );
    default:
      return null;
  }
}

// =============================================================================
// Main Component
// =============================================================================

export const ConfirmDialog = memo(function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  requiresTypeConfirm = false,
  confirmText = '',
  dependentObjects = [],
  isConfirming = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [typedText, setTypedText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus trap for accessibility
  const { containerRef: focusTrapRef } = useFocusTrap({
    isActive: isOpen,
    autoFocus: true,
    returnFocus: true,
  });

  // Determine if confirm is allowed
  const isConfirmEnabled = requiresTypeConfirm
    ? typedText === confirmText
    : true;

  // Reset typed text when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setTypedText('');
      // Focus appropriate element after a short delay
      setTimeout(() => {
        if (requiresTypeConfirm && inputRef.current) {
          inputRef.current.focus();
        } else if (confirmButtonRef.current) {
          confirmButtonRef.current.focus();
        }
      }, 50);
    }
  }, [isOpen, requiresTypeConfirm]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isConfirming) {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && isConfirmEnabled && !isConfirming) {
        e.preventDefault();
        onConfirm();
      }
    },
    [isConfirmEnabled, isConfirming, onCancel, onConfirm]
  );

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isConfirming) {
        onCancel();
      }
    },
    [isConfirming, onCancel]
  );

  // Handle confirm button click
  const handleConfirm = useCallback(() => {
    if (isConfirmEnabled && !isConfirming) {
      onConfirm();
    }
  }, [isConfirmEnabled, isConfirming, onConfirm]);

  // Handle cancel button click
  const handleCancel = useCallback(() => {
    if (!isConfirming) {
      onCancel();
    }
  }, [isConfirming, onCancel]);

  if (!isOpen) {
    return null;
  }

  const hasDependencies = dependentObjects.length > 0;

  const dialog = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      data-testid="confirm-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <div
        ref={focusTrapRef as React.RefObject<HTMLDivElement>}
        className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4"
        data-testid="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-navy-200">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <WarningIcon className="w-5 h-5 text-red-600" />
            </div>
            <h2
              id="confirm-dialog-title"
              className="text-lg font-semibold text-red-600"
              data-testid="confirm-dialog-title"
            >
              {title}
            </h2>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Message */}
          <p
            id="confirm-dialog-description"
            className="text-navy-600"
            data-testid="confirm-dialog-message"
          >
            {message}
          </p>

          {/* Dependency warning */}
          {hasDependencies && (
            <div
              className="bg-amber-50 border border-amber-200 rounded-lg p-4"
              data-testid="confirm-dialog-dependencies"
            >
              <div className="flex items-start gap-2 mb-2">
                <WarningIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <span className="text-sm font-medium text-amber-800">
                  This will also affect the following objects:
                </span>
              </div>
              <ul className="space-y-1 ml-7" data-testid="confirm-dialog-dependency-list">
                {dependentObjects.map((obj, index) => (
                  <li
                    key={`${obj.type}-${obj.name}-${index}`}
                    className="flex items-center gap-2 text-sm text-amber-700"
                    data-testid={`dependency-item-${index}`}
                  >
                    <DependentObjectIcon type={obj.type} />
                    <span>{obj.type.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}:</span>
                    <code className="px-1 py-0.5 bg-amber-100 rounded text-amber-800 font-mono text-xs">
                      {obj.name}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Type-to-confirm input */}
          {requiresTypeConfirm && (
            <div className="space-y-2" data-testid="confirm-dialog-type-confirm">
              <label
                htmlFor="confirm-dialog-input"
                className="block text-sm text-navy-600"
              >
                Type{' '}
                <code className="px-1 py-0.5 bg-navy-100 rounded text-navy-800 font-mono text-xs">
                  {confirmText}
                </code>{' '}
                to confirm:
              </label>
              <input
                ref={inputRef}
                id="confirm-dialog-input"
                type="text"
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                className="w-full px-3 py-2 border border-navy-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent font-mono"
                placeholder={confirmText}
                data-testid="confirm-dialog-input"
                disabled={isConfirming}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-navy-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isConfirming}
            className="px-4 py-2 text-sm font-medium text-navy-600 hover:text-navy-800 hover:bg-navy-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={handleConfirm}
            disabled={!isConfirmEnabled || isConfirming}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              isConfirmEnabled && !isConfirming
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-red-200 text-red-400 cursor-not-allowed'
            }`}
            data-testid="confirm-dialog-confirm"
          >
            {isConfirming ? (
              <span className="flex items-center gap-2">
                <SpinnerIcon />
                Processing...
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
});

export default ConfirmDialog;
