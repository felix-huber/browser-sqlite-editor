/**
 * PersistenceErrorBanner Component
 *
 * Persistent red banner displayed when IndexedDB persistence is in degraded state.
 * Fixed at top of screen, below header.
 *
 * Features:
 * - Red error styling (red-100 bg, red-700 text)
 * - "Warning: Changes may not be saved" message
 * - "Details" link that opens PersistenceErrorModal
 * - Persists until successful save
 */

import { useIsDegradedPersistence } from '../../store';

export interface PersistenceErrorBannerProps {
  /** Callback when "Details" link is clicked */
  onDetailsClick: () => void;
}

/**
 * PersistenceErrorBanner component
 */
export function PersistenceErrorBanner({ onDetailsClick }: PersistenceErrorBannerProps) {
  const isDegraded = useIsDegradedPersistence();

  // Only show when persistence is degraded
  if (!isDegraded) {
    return null;
  }

  return (
    <div
      className="bg-red-100 border-b border-red-300 px-4 py-2 flex items-center justify-between gap-4"
      role="alert"
      aria-live="assertive"
      data-testid="persistence-error-banner"
    >
      <div className="flex items-center gap-3">
        {/* Warning icon */}
        <svg
          className="w-5 h-5 text-red-700 shrink-0"
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

        <span className="text-sm font-medium text-red-700">
          Warning: Changes may not be saved
        </span>
      </div>

      <button
        onClick={onDetailsClick}
        className="text-sm font-medium text-red-700 hover:text-red-800 underline underline-offset-2 shrink-0 transition-colors"
        data-testid="details-link"
      >
        Details
      </button>
    </div>
  );
}

export default PersistenceErrorBanner;
