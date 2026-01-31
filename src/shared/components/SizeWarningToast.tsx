/**
 * SizeWarningToast Component
 *
 * Toast notification displayed when a database exceeds the size threshold.
 * Shows once per database per session (per storage mode).
 *
 * Features:
 * - Amber warning styling
 * - Shows database size and threshold
 * - Dismiss button
 * - Auto-positioned at bottom-right
 */

import { useEffect, useCallback } from 'react';
import { useSizeWarning, clearSizeWarning, SIZE_THRESHOLD_OPFS, SIZE_THRESHOLD_IDB } from '../../store';
import { formatBytes } from '../format/bytes';

/**
 * SizeWarningToast component
 */
export function SizeWarningToast() {
  const warning = useSizeWarning();

  const handleDismiss = useCallback(() => {
    clearSizeWarning();
  }, []);

  // Auto-dismiss after 10 seconds
  useEffect(() => {
    if (!warning) return;

    const timer = setTimeout(() => {
      clearSizeWarning();
    }, 10000);

    return () => clearTimeout(timer);
  }, [warning]);

  if (!warning) {
    return null;
  }

  const thresholdMB = warning.storageMode === 'opfs'
    ? Math.round(SIZE_THRESHOLD_OPFS / (1024 * 1024))
    : Math.round(SIZE_THRESHOLD_IDB / (1024 * 1024));
  const storageLabel = warning.storageMode === 'opfs' ? 'OPFS' : 'IndexedDB';

  return (
    <div
      className="fixed bottom-16 right-4 z-50 max-w-sm bg-amber-50 border border-amber-300 rounded-lg shadow-lg p-4"
      role="alert"
      aria-live="polite"
      data-testid="size-warning-toast"
    >
      <div className="flex items-start gap-3">
        {/* Warning icon */}
        <svg
          className="w-5 h-5 text-amber-600 shrink-0 mt-0.5"
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

        <div className="flex-1">
          <h3 className="text-sm font-semibold text-amber-800">
            Large Database Warning
          </h3>
          <p className="mt-1 text-sm text-amber-700">
            <span className="font-medium">{warning.dbId}</span> is {formatBytes(warning.sizeBytes)},
            exceeding the {thresholdMB}MB {storageLabel} threshold.
          </p>
          <p className="mt-2 text-xs text-amber-600">
            Consider archiving old data or running VACUUM to reclaim space.
          </p>
        </div>

        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          className="shrink-0 text-amber-500 hover:text-amber-700 transition-colors"
          aria-label="Dismiss warning"
          data-testid="size-warning-dismiss"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default SizeWarningToast;
