import { Component, type ReactNode, type ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Optional callback when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  /** Optional fallback render function for custom error UI */
  fallbackRender?: (props: {
    error: Error
    resetError: () => void
  }) => ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  showDetails: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })

    // Log error to console for debugging
    console.error('[ErrorBoundary] Caught error:', error)
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack)

    // Call optional error callback
    this.props.onError?.(error, errorInfo)
  }

  resetError = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    })
  }

  toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }))
  }

  reloadPage = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    const { hasError, error, errorInfo, showDetails } = this.state
    const { children, fallbackRender } = this.props

    if (hasError && error) {
      // Use custom fallback if provided
      if (fallbackRender) {
        return fallbackRender({ error, resetError: this.resetError })
      }

      // Default error UI
      return (
        <div
          className="flex items-center justify-center min-h-64 p-6"
          role="alert"
          aria-live="assertive"
          data-testid="error-boundary-fallback"
        >
          <div className="max-w-md w-full bg-white border border-red-200 rounded-lg shadow-sm">
            {/* Header */}
            <div className="p-4 border-b border-red-100 bg-red-50 rounded-t-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <svg
                    className="w-5 h-5 text-red-600"
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
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-red-800">
                    Something went wrong
                  </h2>
                  <p className="text-sm text-red-600">
                    An error occurred while rendering this component.
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Error message */}
              <p className="text-sm text-navy-600">
                {error.message || 'An unexpected error occurred.'}
              </p>

              {/* Collapsible technical details */}
              <div className="border border-navy-200 rounded">
                <button
                  onClick={this.toggleDetails}
                  className="w-full px-3 py-2 text-left text-sm font-medium text-navy-700 hover:bg-navy-50 flex items-center justify-between"
                  aria-expanded={showDetails}
                  data-testid="toggle-details-button"
                >
                  <span>Technical Details</span>
                  <svg
                    className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {showDetails && (
                  <div
                    className="px-3 py-2 border-t border-navy-200 bg-navy-50"
                    data-testid="error-details"
                  >
                    <pre className="text-xs text-navy-600 overflow-x-auto whitespace-pre-wrap font-mono">
                      <strong>Error:</strong> {error.name}: {error.message}
                      {'\n\n'}
                      <strong>Stack:</strong>
                      {'\n'}
                      {error.stack}
                      {errorInfo?.componentStack && (
                        <>
                          {'\n\n'}
                          <strong>Component Stack:</strong>
                          {'\n'}
                          {errorInfo.componentStack}
                        </>
                      )}
                    </pre>
                  </div>
                )}
              </div>

              {/* Recovery actions */}
              <div className="flex gap-3">
                <button
                  onClick={this.resetError}
                  className="flex-1 px-4 py-2 bg-navy-600 text-white text-sm font-medium rounded hover:bg-navy-700 transition-colors"
                  data-testid="retry-button"
                >
                  Retry
                </button>
                <button
                  onClick={this.reloadPage}
                  className="flex-1 px-4 py-2 bg-white text-navy-700 text-sm font-medium border border-navy-300 rounded hover:bg-navy-50 transition-colors"
                  data-testid="reload-button"
                >
                  Reload Page
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return children
  }
}

export default ErrorBoundary
