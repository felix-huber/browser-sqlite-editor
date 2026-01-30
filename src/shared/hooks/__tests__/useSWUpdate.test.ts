import { renderHook, act, waitFor } from '@testing-library/react'
import { useSWUpdate } from '../useSWUpdate'

// Store the onNeedRefresh callback for testing
let storedOnNeedRefresh: (() => void) | null = null
const mockUpdateSW = vi.fn()

vi.mock('virtual:pwa-register', () => ({
  registerSW: vi.fn((options: { onNeedRefresh?: () => void }) => {
    storedOnNeedRefresh = options.onNeedRefresh ?? null
    return mockUpdateSW
  }),
}))

// Helper to trigger the stored callback
const triggerNeedRefresh = () => {
  storedOnNeedRefresh?.()
}

// Import after mock setup
const { registerSW } = await import('virtual:pwa-register')

describe('useSWUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    storedOnNeedRefresh = null
  })

  it('initially returns needsRefresh as false', async () => {
    const { result } = renderHook(() => useSWUpdate())

    // Wait for the async effect to settle
    await waitFor(() => {
      expect(registerSW).toHaveBeenCalled()
    })

    expect(result.current.needsRefresh).toBe(false)
  })

  it('sets needsRefresh to true when onNeedRefresh is called', async () => {
    const { result } = renderHook(() => useSWUpdate())

    // Wait for the async registration to complete
    await waitFor(() => {
      expect(registerSW).toHaveBeenCalled()
    })

    // Trigger the onNeedRefresh callback
    act(() => {
      triggerNeedRefresh()
    })

    expect(result.current.needsRefresh).toBe(true)
  })

  it('calls updateSW(true) when updateServiceWorker is invoked', async () => {
    const { result } = renderHook(() => useSWUpdate())

    // Wait for the async registration
    await waitFor(() => {
      expect(registerSW).toHaveBeenCalled()
    })

    // Trigger needsRefresh
    act(() => {
      triggerNeedRefresh()
    })

    // Call updateServiceWorker
    act(() => {
      result.current.updateServiceWorker()
    })

    // The mock returned by registerSW should have been called with true
    const mockUpdateSW = vi.mocked(registerSW).mock.results[0]?.value
    expect(mockUpdateSW).toHaveBeenCalledWith(true)
  })

  it('sets needsRefresh to false when dismiss is called', async () => {
    const { result } = renderHook(() => useSWUpdate())

    // Wait for the async registration
    await waitFor(() => {
      expect(registerSW).toHaveBeenCalled()
    })

    // Trigger needsRefresh
    act(() => {
      triggerNeedRefresh()
    })

    expect(result.current.needsRefresh).toBe(true)

    // Dismiss
    act(() => {
      result.current.dismiss()
    })

    expect(result.current.needsRefresh).toBe(false)
  })

  it('stores dismissed version in localStorage', async () => {
    const { result } = renderHook(() => useSWUpdate())

    // Wait for the async registration
    await waitFor(() => {
      expect(registerSW).toHaveBeenCalled()
    })

    // Trigger needsRefresh
    act(() => {
      triggerNeedRefresh()
    })

    // Dismiss
    act(() => {
      result.current.dismiss()
    })

    // Check localStorage was updated
    expect(localStorage.getItem('sw-update-dismissed-version')).toBeTruthy()
  })
})
