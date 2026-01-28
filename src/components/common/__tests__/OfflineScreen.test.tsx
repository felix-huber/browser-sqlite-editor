import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OfflineScreen } from '../OfflineScreen'

describe('OfflineScreen', () => {
  let originalLocation: Location
  let originalNavigator: Navigator

  beforeEach(() => {
    // Mock window.location.reload
    originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: vi.fn() },
      writable: true,
    })

    // Mock navigator.onLine
    originalNavigator = window.navigator
    Object.defineProperty(window, 'navigator', {
      value: { ...originalNavigator, onLine: false },
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    })
    Object.defineProperty(window, 'navigator', {
      value: originalNavigator,
      writable: true,
    })
    vi.restoreAllMocks()
  })

  it('renders message and retry button', () => {
    render(<OfflineScreen />)

    expect(screen.getByTestId('offline-screen')).toBeInTheDocument()
    expect(screen.getByTestId('offline-message')).toBeInTheDocument()
    expect(screen.getByTestId('retry-button')).toBeInTheDocument()
    expect(screen.getByText("You're offline")).toBeInTheDocument()
    expect(screen.getByText('Retry Connection')).toBeInTheDocument()
  })

  it('displays default message', () => {
    render(<OfflineScreen />)

    expect(screen.getByTestId('offline-message')).toHaveTextContent(
      'You appear to be offline. Connect to the internet to load the app.'
    )
  })

  it('displays custom message when provided', () => {
    const customMessage = 'Custom offline message for testing'
    render(<OfflineScreen message={customMessage} />)

    expect(screen.getByTestId('offline-message')).toHaveTextContent(customMessage)
  })

  it('retry button triggers reload when online', () => {
    // Set navigator.onLine to true
    Object.defineProperty(window, 'navigator', {
      value: { ...originalNavigator, onLine: true },
      writable: true,
    })

    render(<OfflineScreen />)

    const retryButton = screen.getByTestId('retry-button')
    fireEvent.click(retryButton)

    expect(window.location.reload).toHaveBeenCalled()
  })

  it('retry button does not reload when still offline (no custom handler)', () => {
    // navigator.onLine is false by default in beforeEach
    render(<OfflineScreen />)

    const retryButton = screen.getByTestId('retry-button')
    fireEvent.click(retryButton)

    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('retry button calls custom onRetry handler when provided', () => {
    const onRetry = vi.fn()
    render(<OfflineScreen onRetry={onRetry} />)

    const retryButton = screen.getByTestId('retry-button')
    fireEvent.click(retryButton)

    expect(onRetry).toHaveBeenCalled()
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('online event triggers auto-reload', () => {
    render(<OfflineScreen />)

    // Simulate going back online
    window.dispatchEvent(new Event('online'))

    expect(window.location.reload).toHaveBeenCalled()
  })

  it('cleans up online event listener on unmount', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = render(<OfflineScreen />)

    expect(addEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function))

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function))
  })

  it('has proper accessibility attributes', () => {
    render(<OfflineScreen />)

    const offlineScreen = screen.getByTestId('offline-screen')
    expect(offlineScreen).toHaveAttribute('role', 'alert')
    expect(offlineScreen).toHaveAttribute('aria-live', 'polite')
  })

  it('renders airplane icon', () => {
    render(<OfflineScreen />)

    const icon = screen.getByTestId('offline-icon')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })
})
