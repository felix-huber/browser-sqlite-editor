/**
 * OperationSpinner Component
 *
 * An overlay spinner for blocking operations like import, export, and DDL execution.
 *
 * Features:
 * - Semi-transparent backdrop
 * - Centered spinner with operation label
 * - Progress percentage when available
 * - Cancel button for cancellable operations
 * - Accessible with ARIA live regions
 */

import { memo } from 'react';

export interface OperationSpinnerProps {
  /** Whether the spinner is visible */
  isVisible: boolean;
  /** Operation label to display */
  label?: string;
  /** Progress percentage (0-100), undefined for indeterminate */
  progress?: number;
  /** Whether the operation can be cancelled */
  cancellable?: boolean;
  /** Cancel callback */
  onCancel?: () => void;
  /** Additional CSS classes for the overlay */
  className?: string;
}

/**
 * Spinner SVG component
 */
const SpinnerIcon = memo(function SpinnerIcon() {
  return (
    <svg
      className="w-12 h-12 text-blue-600 animate-spin"
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
});

/**
 * OperationSpinner - Blocking overlay with spinner for long operations
 */
export const OperationSpinner = memo(function OperationSpinner({
  isVisible,
  label,
  progress,
  cancellable = false,
  onCancel,
  className = '',
}: OperationSpinnerProps) {
  if (!isVisible) {
    return null;
  }

  const hasProgress = progress !== undefined;
  const roundedProgress = hasProgress ? Math.round(progress) : 0;

  return (
    <div
      className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 ${className}`}
      data-testid="operation-spinner-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="operation-spinner-label"
      aria-describedby={hasProgress ? 'operation-spinner-progress' : undefined}
    >
      <div
        className="bg-white rounded-lg shadow-xl p-6 flex flex-col items-center gap-4 min-w-[200px]"
        data-testid="operation-spinner-dialog"
      >
        {/* Spinner */}
        <SpinnerIcon />

        {/* Label */}
        {label && (
          <span
            id="operation-spinner-label"
            className="text-lg font-medium text-gray-900"
            data-testid="operation-spinner-label"
          >
            {label}
          </span>
        )}

        {/* Progress */}
        {hasProgress && (
          <div className="w-full">
            {/* Progress bar */}
            <div
              className="h-2 bg-gray-200 rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={roundedProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={label || 'Operation progress'}
            >
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
                data-testid="operation-spinner-progress-fill"
              />
            </div>
            {/* Percentage text */}
            <span
              id="operation-spinner-progress"
              className="block text-center text-sm text-gray-600 mt-2"
              data-testid="operation-spinner-progress"
            >
              {roundedProgress}%
            </span>
          </div>
        )}

        {/* Cancel button */}
        {cancellable && onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
            data-testid="operation-spinner-cancel"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Screen reader live region for progress updates */}
      {hasProgress && (
        <div
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
        >
          {label ? `${label}: ${roundedProgress}% complete` : `${roundedProgress}% complete`}
        </div>
      )}
    </div>
  );
});

export default OperationSpinner;
