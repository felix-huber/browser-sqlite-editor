/**
 * StorageFullBanner Component
 *
 * Persistent banner displayed when storage quota is exceeded.
 * Fixed at top of screen, below header.
 *
 * Features:
 * - Red error styling
 * - "Storage full - writes disabled" message
 * - "Free space" link that opens QuotaExceededModal
 * - Persists until storage is freed
 */

import { useStorageStatus } from '../../store';

export interface StorageFullBannerProps {
  /** Callback when "Free space" is clicked */
  onFreeSpaceClick: () => void;
}

/**
 * StorageFullBanner component
 */
export function StorageFullBanner({ onFreeSpaceClick }: StorageFullBannerProps) {
  const storageStatus = useStorageStatus();

  // Only show when quota is exceeded
  if (storageStatus !== 'quota_exceeded') {
    return null;
  }

  return (
    <div
      className="bg-red-50 border-b border-red-300 px-4 py-2 flex items-center justify-between gap-4"
      role="alert"
      aria-live="polite"
      data-testid="storage-full-banner"
    >
      <div className="flex items-center gap-3">
        {/* Warning icon */}
        <svg
          className="w-5 h-5 text-red-600 shrink-0"
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
          Storage full — writes disabled
        </span>
      </div>

      <button
        onClick={onFreeSpaceClick}
        className="text-sm font-medium text-red-700 hover:text-red-800 underline underline-offset-2 shrink-0 transition-colors"
        data-testid="free-space-link"
      >
        Free space
      </button>
    </div>
  );
}

export default StorageFullBanner;
