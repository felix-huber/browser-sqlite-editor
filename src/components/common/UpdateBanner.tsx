import { useSWUpdate } from '../../hooks/useSWUpdate'

/**
 * Banner shown when a service worker update is available.
 * Fixed at top of screen, blue info style (updates are good!).
 */
export function UpdateBanner() {
  const { needsRefresh, updateServiceWorker, dismiss } = useSWUpdate()

  if (!needsRefresh) {
    return null
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-40 bg-blue-600 text-white px-4 py-3 shadow-md animate-slide-down"
      role="alert"
      aria-live="polite"
      data-testid="update-banner"
    >
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Info icon */}
          <svg
            className="w-5 h-5 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-sm font-medium">
            A new version is available
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={updateServiceWorker}
            className="px-3 py-1.5 bg-white text-blue-700 text-sm font-medium rounded hover:bg-blue-50 transition-colors"
            data-testid="reload-now-button"
          >
            Reload Now
          </button>
          <button
            onClick={dismiss}
            className="px-3 py-1.5 bg-blue-700 text-white text-sm font-medium rounded hover:bg-blue-800 transition-colors"
            data-testid="dismiss-button"
            aria-label="Dismiss update notification"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

export default UpdateBanner
