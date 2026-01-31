/**
 * DesignerPreviewModal Component
 *
 * Modal dialog for previewing DDL changes before applying them.
 * Integrates the shared DDLDiffPreview component with:
 * - Original vs proposed CREATE TABLE SQL (side-by-side)
 * - Affected indexes and triggers (collapsible)
 * - Dependent views warning (from pre-flight dependency scan)
 * - Net effect summary
 * - Confirm/Cancel buttons with keyboard shortcuts (Enter/Escape)
 */

import { useEffect, useCallback, useState } from 'react';
import type { TableInfo, DesignerColumnDraft } from '../../types';
import { useFocusTrap } from '../../shared/hooks/useFocusTrap';
import { DDLDiffPreview as SharedDDLDiffPreview } from '../../shared/components/DDLDiffPreview';
import { useDesignerPreview } from './useDesignerPreview';

// =============================================================================
// Types
// =============================================================================

export interface DesignerPreviewModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Existing table info (null for create mode - modal won't show) */
  existingTable: TableInfo | null;
  /** Current column drafts from designer */
  columns: DesignerColumnDraft[];
  /** New table name */
  tableName: string;
  /** Whether database is read-only */
  isReadOnly?: boolean;
  /** Whether apply operation is in progress */
  isApplying?: boolean;
  /** Rollback error message to display */
  rollbackError?: string;
  /** Called when user confirms changes (Enter or Confirm button) */
  onConfirm: () => void;
  /** Called when user cancels (Escape or Cancel button) */
  onCancel: () => void;
}

// =============================================================================
// Helper Components
// =============================================================================

function LoadingSpinner() {
  return (
    <div className="flex items-center gap-2 text-navy-400">
      <svg
        className="animate-spin h-4 w-4"
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
      <span className="text-sm">Scanning for dependencies...</span>
    </div>
  );
}

function DependentViewsWarning({
  views,
  triggers,
}: {
  views: Array<{ name: string; sql: string }>;
  triggers: Array<{ name: string; sql: string }>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (views.length === 0 && triggers.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="dependent-views-warning"
      className="bg-amber-900/20 border border-amber-700/50 rounded-lg overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-amber-900/30 transition-colors"
        data-testid="dependent-views-toggle"
      >
        <svg
          className={`w-4 h-4 text-amber-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <svg
          className="w-4 h-4 text-amber-500"
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
        <span className="text-sm font-medium text-amber-300">
          {views.length + triggers.length} dependent object(s) may be affected
        </span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 space-y-2" data-testid="dependent-views-list">
          {views.map((view) => (
            <div key={`view-${view.name}`} className="ml-6 text-sm">
              <div className="flex items-center gap-2 text-amber-200">
                <svg
                  className="w-4 h-4 text-amber-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                <span className="text-amber-400">View:</span>
                <code className="px-1.5 py-0.5 bg-amber-900/50 rounded text-amber-100 font-mono text-xs">
                  {view.name}
                </code>
              </div>
            </div>
          ))}
          {triggers.map((trigger) => (
            <div key={`trigger-${trigger.name}`} className="ml-6 text-sm">
              <div className="flex items-center gap-2 text-amber-200">
                <svg
                  className="w-4 h-4 text-amber-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                <span className="text-amber-400">Trigger:</span>
                <code className="px-1.5 py-0.5 bg-amber-900/50 rounded text-amber-100 font-mono text-xs">
                  {trigger.name}
                </code>
              </div>
            </div>
          ))}
          <div className="ml-6 mt-2 text-xs text-amber-400/80">
            These objects may fail after the rebuild. The operation will be rolled back if validation fails.
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function DesignerPreviewModal({
  isOpen,
  existingTable,
  columns,
  tableName,
  isReadOnly = false,
  isApplying = false,
  rollbackError,
  onConfirm,
  onCancel,
}: DesignerPreviewModalProps) {
  // Focus trap for accessibility
  const { containerRef } = useFocusTrap<HTMLDivElement>({
    isActive: isOpen,
    autoFocus: true,
    returnFocus: true,
    initialFocusSelector: '[data-testid="preview-confirm-button"]',
  });

  // Get preview data from hook
  const previewData = useDesignerPreview({
    existingTable,
    columns,
    tableName,
    isReadOnly,
  });

  // Keyboard shortcuts (Enter to confirm, Escape to cancel)
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isOpen) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        // Only confirm if valid and not already applying
        if (previewData.validation.isValid && !isApplying && !previewData.isLoading) {
          event.preventDefault();
          event.stopPropagation();
          onConfirm();
        }
      }
    },
    [isOpen, onCancel, onConfirm, previewData.validation.isValid, isApplying, previewData.isLoading]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget && !isApplying) {
        onCancel();
      }
    },
    [onCancel, isApplying]
  );

  // Don't render if not open or no existing table (create mode doesn't need modal)
  if (!isOpen || !existingTable) {
    return null;
  }

  const canConfirm =
    previewData.validation.isValid && !isApplying && !previewData.isLoading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
      data-testid="designer-preview-modal"
    >
      <div
        ref={containerRef}
        className="bg-navy-800 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-navy-700 flex items-center justify-between">
          <div>
            <h2
              id="preview-modal-title"
              className="text-lg font-semibold text-navy-100"
            >
              Preview Changes
            </h2>
            <p className="text-sm text-navy-400 mt-1">
              {previewData.analysis.changeType === 'add_columns'
                ? 'Simple column additions (ALTER TABLE)'
                : previewData.analysis.changeType === 'rebuild'
                ? 'Table rebuild required'
                : 'No structural changes detected'}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isApplying}
            className="text-navy-400 hover:text-navy-200 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded p-1"
            aria-label="Close"
            data-testid="preview-close-button"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Loading indicator */}
          {previewData.isLoading && <LoadingSpinner />}

          {/* Scan error */}
          {previewData.scanError && (
            <div
              className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 text-sm text-red-300"
              data-testid="scan-error"
            >
              <span className="font-medium">Dependency scan failed:</span>{' '}
              {previewData.scanError}
            </div>
          )}

          {/* Shared DDL Diff Preview */}
          <SharedDDLDiffPreview
            originalSql={previewData.originalSql}
            proposedSql={previewData.proposedSql}
            dependentObjects={previewData.dependentObjects}
            netEffectSummary={previewData.netEffectSummary}
            rollbackError={rollbackError}
          />

          {/* Dependent Views Warning (from pre-flight scan) */}
          {!previewData.isLoading && (
            <DependentViewsWarning
              views={previewData.dependentViews}
              triggers={previewData.dependentTriggers}
            />
          )}

          {/* Validation Messages */}
          {(previewData.validation.errors.length > 0 ||
            previewData.validation.warnings.length > 0) && (
            <div className="space-y-2">
              {previewData.validation.errors.map((error, idx) => (
                <div
                  key={`error-${idx}`}
                  className="flex items-start gap-2 p-3 rounded-lg bg-red-900/20 border border-red-700/50"
                  data-testid="validation-error"
                >
                  <svg
                    className="w-5 h-5 text-red-500 shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm text-red-300">{error}</span>
                </div>
              ))}

              {previewData.validation.warnings.map((warning, idx) => (
                <div
                  key={`warning-${idx}`}
                  className="flex items-start gap-2 p-3 rounded-lg bg-amber-900/20 border border-amber-700/50"
                  data-testid="validation-warning"
                >
                  <svg
                    className="w-5 h-5 text-amber-500 shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm text-amber-300">{warning}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with buttons */}
        <div className="px-6 py-4 border-t border-navy-700 flex items-center justify-between">
          <div className="text-sm text-navy-400">
            {!previewData.validation.hasChanges && (
              <span data-testid="no-changes-message">No changes to apply</span>
            )}
            {previewData.validation.hasChanges && !previewData.isLoading && (
              <span className="text-navy-500">
                Press <kbd className="px-1.5 py-0.5 bg-navy-700 rounded text-xs">Enter</kbd> to
                confirm or <kbd className="px-1.5 py-0.5 bg-navy-700 rounded text-xs">Esc</kbd> to
                cancel
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isApplying}
              className="px-4 py-2 text-navy-200 font-medium rounded-lg border border-navy-600 hover:bg-navy-700 focus:outline-none focus:ring-2 focus:ring-navy-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid="preview-cancel-button"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!canConfirm}
              title={
                !previewData.validation.isValid
                  ? previewData.validation.errors[0] || 'No changes to apply'
                  : isApplying
                  ? 'Applying changes...'
                  : previewData.isLoading
                  ? 'Scanning dependencies...'
                  : 'Apply changes'
              }
              className={`px-4 py-2 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-navy-800 transition-colors ${
                canConfirm
                  ? 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-600'
                  : 'bg-navy-600 text-navy-400 cursor-not-allowed'
              }`}
              data-testid="preview-confirm-button"
            >
              {isApplying ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
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
                  Applying...
                </span>
              ) : (
                'Confirm'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DesignerPreviewModal;
