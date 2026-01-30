import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from '../ErrorBoundary'

// Suppress console.error during tests since we expect errors
const originalConsoleError = console.error
beforeEach(() => {
  console.error = vi.fn()
})
afterEach(() => {
  console.error = originalConsoleError
})

// Component that throws an error
function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message')
  }
  return <div data-testid="child-component">Child content</div>
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    )

    expect(screen.getByTestId('child-component')).toBeInTheDocument()
    expect(screen.getByText('Child content')).toBeInTheDocument()
  })

  it('catches thrown error and displays error UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Test error message')).toBeInTheDocument()
  })

  it('displays recovery options (Retry and Reload)', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByTestId('retry-button')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
    expect(screen.getByTestId('reload-button')).toBeInTheDocument()
    expect(screen.getByText('Reload Page')).toBeInTheDocument()
  })

  it('retry button attempts to re-render component', () => {
    let shouldThrow = true

    function ConditionalThrower() {
      if (shouldThrow) {
        throw new Error('Conditional error')
      }
      return <div data-testid="recovered-component">Recovered!</div>
    }

    render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>
    )

    // Initially shows error UI
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()

    // Fix the error condition
    shouldThrow = false

    // Click retry
    fireEvent.click(screen.getByTestId('retry-button'))

    // Should now render the recovered component
    expect(screen.getByTestId('recovered-component')).toBeInTheDocument()
    expect(screen.getByText('Recovered!')).toBeInTheDocument()
  })

  it('logs error to console', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(console.error).toHaveBeenCalledWith(
      '[ErrorBoundary] Caught error:',
      expect.any(Error)
    )
    expect(console.error).toHaveBeenCalledWith(
      '[ErrorBoundary] Component stack:',
      expect.any(String)
    )
  })

  it('calls onError callback when error is caught', () => {
    const onError = vi.fn()

    render(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        componentStack: expect.any(String),
      })
    )
  })

  it('shows collapsible technical details', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    // Details should be collapsed initially
    expect(screen.queryByTestId('error-details')).not.toBeInTheDocument()

    // Click to expand
    fireEvent.click(screen.getByTestId('toggle-details-button'))

    // Details should now be visible
    const detailsElement = screen.getByTestId('error-details')
    expect(detailsElement).toBeInTheDocument()
    expect(detailsElement.textContent).toContain('Error:')
    expect(detailsElement.textContent).toContain('Stack:')
  })

  it('toggles technical details on repeated clicks', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    const toggleButton = screen.getByTestId('toggle-details-button')

    // Initially collapsed
    expect(screen.queryByTestId('error-details')).not.toBeInTheDocument()

    // First click - expand
    fireEvent.click(toggleButton)
    expect(screen.getByTestId('error-details')).toBeInTheDocument()

    // Second click - collapse
    fireEvent.click(toggleButton)
    expect(screen.queryByTestId('error-details')).not.toBeInTheDocument()
  })

  it('uses custom fallback render when provided', () => {
    const customFallback = vi.fn(({ error, resetError }) => (
      <div data-testid="custom-fallback">
        <span>Custom error: {error.message}</span>
        <button onClick={resetError} data-testid="custom-reset">
          Custom Reset
        </button>
      </div>
    ))

    render(
      <ErrorBoundary fallbackRender={customFallback}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()
    expect(screen.getByText('Custom error: Test error message')).toBeInTheDocument()
    expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument()
  })

  it('custom fallback reset button works', () => {
    let shouldThrow = true

    function ConditionalThrower() {
      if (shouldThrow) {
        throw new Error('Custom conditional error')
      }
      return <div data-testid="custom-recovered">Custom recovered!</div>
    }

    render(
      <ErrorBoundary
        fallbackRender={({ error, resetError }) => (
          <div data-testid="custom-fallback">
            <span>{error.message}</span>
            <button onClick={resetError} data-testid="custom-reset">
              Reset
            </button>
          </div>
        )}
      >
        <ConditionalThrower />
      </ErrorBoundary>
    )

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()

    // Fix error condition and reset
    shouldThrow = false
    fireEvent.click(screen.getByTestId('custom-reset'))

    expect(screen.getByTestId('custom-recovered')).toBeInTheDocument()
  })

  it('has proper accessibility attributes', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    const fallback = screen.getByTestId('error-boundary-fallback')
    expect(fallback).toHaveAttribute('role', 'alert')
    expect(fallback).toHaveAttribute('aria-live', 'assertive')

    const toggleButton = screen.getByTestId('toggle-details-button')
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggleButton)
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true')
  })
})
