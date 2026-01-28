import { useEffect, useCallback } from 'react'

interface OfflineScreenProps {
  /** Optional custom message to display */
  message?: string
  /** Callback when retry is triggered (defaults to page reload) */
  onRetry?: () => void
}

/**
 * OfflineScreen component displays when the app is offline and content is unavailable.
 * Shows a centered message with airplane icon, retry button, and auto-retries on 'online' event.
 */
export function OfflineScreen({
  message = 'You appear to be offline. Connect to the internet to load the app.',
  onRetry,
}: OfflineScreenProps) {
  const handleRetry = useCallback(() => {
    if (onRetry) {
      onRetry()
    } else if (navigator.onLine) {
      window.location.reload()
    }
  }, [onRetry])

  // Auto-reload when connection is restored
  useEffect(() => {
    const handleOnline = () => {
      window.location.reload()
    }

    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  return (
    <div
      className="flex items-center justify-center min-h-screen bg-navy-50 p-6"
      role="alert"
      aria-live="polite"
      data-testid="offline-screen"
    >
      <div className="max-w-md w-full text-center">
        {/* Airplane icon */}
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-navy-100 flex items-center justify-center">
          <svg
            className="w-10 h-10 text-navy-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
            data-testid="offline-icon"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </div>

        {/* Status message */}
        <h1 className="text-xl font-semibold text-navy-800 mb-2">
          You're offline
        </h1>
        <p className="text-navy-600 mb-6" data-testid="offline-message">
          {message}
        </p>

        {/* Retry button */}
        <button
          onClick={handleRetry}
          className="px-6 py-3 bg-navy-600 text-white font-medium rounded-lg hover:bg-navy-700 transition-colors focus:outline-none focus:ring-2 focus:ring-navy-500 focus:ring-offset-2"
          data-testid="retry-button"
        >
          Retry Connection
        </button>

        {/* Connection status hint */}
        <p className="mt-4 text-sm text-navy-400">
          The page will automatically reload when you're back online.
        </p>
      </div>
    </div>
  )
}

export default OfflineScreen
