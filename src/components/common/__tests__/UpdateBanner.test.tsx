import { render, screen, fireEvent } from '@testing-library/react'
import { UpdateBanner } from '../UpdateBanner'
import { useSWUpdate } from '../../../hooks/useSWUpdate'

// Mock the hook
vi.mock('../../../hooks/useSWUpdate')

const mockUseSWUpdate = vi.mocked(useSWUpdate)

describe('UpdateBanner', () => {
  const mockUpdateServiceWorker = vi.fn()
  const mockDismiss = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSWUpdate.mockReturnValue({
      needsRefresh: false,
      updateServiceWorker: mockUpdateServiceWorker,
      dismiss: mockDismiss,
    })
  })

  it('renders nothing when needsRefresh is false', () => {
    mockUseSWUpdate.mockReturnValue({
      needsRefresh: false,
      updateServiceWorker: mockUpdateServiceWorker,
      dismiss: mockDismiss,
    })

    const { container } = render(<UpdateBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders banner when needsRefresh is true', () => {
    mockUseSWUpdate.mockReturnValue({
      needsRefresh: true,
      updateServiceWorker: mockUpdateServiceWorker,
      dismiss: mockDismiss,
    })

    render(<UpdateBanner />)

    expect(screen.getByTestId('update-banner')).toBeInTheDocument()
    expect(screen.getByText('A new version is available')).toBeInTheDocument()
  })

  it('calls updateServiceWorker when Reload Now is clicked', () => {
    mockUseSWUpdate.mockReturnValue({
      needsRefresh: true,
      updateServiceWorker: mockUpdateServiceWorker,
      dismiss: mockDismiss,
    })

    render(<UpdateBanner />)

    fireEvent.click(screen.getByTestId('reload-now-button'))

    expect(mockUpdateServiceWorker).toHaveBeenCalledTimes(1)
  })

  it('calls dismiss when Dismiss is clicked', () => {
    mockUseSWUpdate.mockReturnValue({
      needsRefresh: true,
      updateServiceWorker: mockUpdateServiceWorker,
      dismiss: mockDismiss,
    })

    render(<UpdateBanner />)

    fireEvent.click(screen.getByTestId('dismiss-button'))

    expect(mockDismiss).toHaveBeenCalledTimes(1)
  })

  it('has proper accessibility attributes', () => {
    mockUseSWUpdate.mockReturnValue({
      needsRefresh: true,
      updateServiceWorker: mockUpdateServiceWorker,
      dismiss: mockDismiss,
    })

    render(<UpdateBanner />)

    const banner = screen.getByTestId('update-banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveAttribute('aria-live', 'polite')
  })
})
