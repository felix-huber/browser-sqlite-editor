import { render, screen, fireEvent, act } from '@testing-library/react';
import { ReadOnlyBanner } from '../ReadOnlyBanner';
import { useDatabaseStore } from '../../../store';
import { getLockManager, type WebLockManager } from '../../../worker/web-locks';
import type { LockStatus } from '../../../worker/web-locks';

// Mock the store
vi.mock('../../../store', async () => {
  const actual = await vi.importActual('../../../store');
  return {
    ...actual,
    useDatabaseStore: vi.fn(),
    useIsReadOnly: vi.fn(),
    useLockHolder: vi.fn(),
    openDb: vi.fn(),
  };
});

// Mock the lock manager
vi.mock('../../../worker/web-locks', () => ({
  getLockManager: vi.fn(),
}));

const mockUseDatabaseStore = vi.mocked(useDatabaseStore);
const mockGetLockManager = vi.mocked(getLockManager);

// Import the mocked functions for direct access
import { useIsReadOnly, useLockHolder, openDb } from '../../../store';
const mockUseIsReadOnly = vi.mocked(useIsReadOnly);
const mockUseLockHolder = vi.mocked(useLockHolder);
const mockOpenDb = vi.mocked(openDb);

describe('ReadOnlyBanner', () => {
  const mockQueryLockStatus = vi.fn<(dbId: string) => Promise<LockStatus>>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default mocks
    mockUseIsReadOnly.mockReturnValue(false);
    mockUseLockHolder.mockReturnValue(null);
    mockUseDatabaseStore.mockImplementation((selector) => {
      const state = {
        activeDbId: 'test-db',
        isReadOnly: false,
        lockHolder: null,
      };
      return selector(state as ReturnType<typeof useDatabaseStore.getState>);
    });

    mockQueryLockStatus.mockResolvedValue({
      dbId: 'test-db',
      isLocked: true,
      holderId: 'tab-abc123',
      acquiredAt: Date.now(),
      isStale: false,
    });

    mockGetLockManager.mockReturnValue({
      queryLockStatus: mockQueryLockStatus,
    } as unknown as WebLockManager);

    mockOpenDb.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when isReadOnly is false', () => {
    mockUseIsReadOnly.mockReturnValue(false);

    const { container } = render(<ReadOnlyBanner />);

    expect(container.firstChild).toBeNull();
  });

  it('renders banner when isReadOnly is true', async () => {
    mockUseIsReadOnly.mockReturnValue(true);
    mockUseLockHolder.mockReturnValue('other');

    render(<ReadOnlyBanner />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
    expect(
      screen.getByText('Database is read-only: another tab has the write lock')
    ).toBeInTheDocument();
  });

  it('shows lock holder info when available', async () => {
    mockUseIsReadOnly.mockReturnValue(true);
    mockUseLockHolder.mockReturnValue('other');
    mockQueryLockStatus.mockResolvedValue({
      dbId: 'test-db',
      isLocked: true,
      holderId: 'tab-abc123xyz',
      acquiredAt: Date.now(),
      isStale: false,
    });

    render(<ReadOnlyBanner />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('lock-holder-info')).toHaveTextContent(
      'Locked by Tab tab-abc1...'
    );
  });

  it('calls openDb when Retry button is clicked', async () => {
    mockUseIsReadOnly.mockReturnValue(true);
    mockUseLockHolder.mockReturnValue('other');

    render(<ReadOnlyBanner />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const retryButton = screen.getByTestId('retry-button');
    await act(async () => {
      fireEvent.click(retryButton);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockOpenDb).toHaveBeenCalledWith('test-db');
  });

  it('hides Take Over button when lock is fresh', async () => {
    mockUseIsReadOnly.mockReturnValue(true);
    mockUseLockHolder.mockReturnValue('other');
    mockQueryLockStatus.mockResolvedValue({
      dbId: 'test-db',
      isLocked: true,
      holderId: 'tab-abc123',
      acquiredAt: Date.now(), // Fresh lock
      isStale: false,
    });

    render(<ReadOnlyBanner />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByTestId('take-over-button')).not.toBeInTheDocument();
  });

  it('shows Take Over button when lock is stale', async () => {
    mockUseIsReadOnly.mockReturnValue(true);
    mockUseLockHolder.mockReturnValue('other');
    mockQueryLockStatus.mockResolvedValue({
      dbId: 'test-db',
      isLocked: true,
      holderId: 'tab-abc123',
      acquiredAt: Date.now() - 15000, // 15s ago, past the 10s threshold
      isStale: false,
    });

    render(<ReadOnlyBanner staleThresholdMs={10000} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('take-over-button')).toBeInTheDocument();
    expect(screen.getByTestId('stale-warning')).toHaveTextContent(
      'Lock appears stale (no heartbeat)'
    );
  });

  it('calls openDb when Take Over button is clicked', async () => {
    mockUseIsReadOnly.mockReturnValue(true);
    mockUseLockHolder.mockReturnValue('other');
    mockQueryLockStatus.mockResolvedValue({
      dbId: 'test-db',
      isLocked: true,
      holderId: 'tab-abc123',
      acquiredAt: Date.now() - 15000,
      isStale: false,
    });

    render(<ReadOnlyBanner staleThresholdMs={10000} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const takeOverButton = screen.getByTestId('take-over-button');
    await act(async () => {
      fireEvent.click(takeOverButton);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockOpenDb).toHaveBeenCalledWith('test-db');
  });

  it('has proper accessibility attributes', async () => {
    mockUseIsReadOnly.mockReturnValue(true);
    mockUseLockHolder.mockReturnValue('other');

    render(<ReadOnlyBanner />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const banner = screen.getByTestId('read-only-banner');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('shows stale warning when isStale flag is true from status', async () => {
    mockUseIsReadOnly.mockReturnValue(true);
    mockUseLockHolder.mockReturnValue('other');
    mockQueryLockStatus.mockResolvedValue({
      dbId: 'test-db',
      isLocked: true,
      holderId: 'tab-abc123',
      acquiredAt: null, // Web Locks mode
      isStale: true,
    });

    render(<ReadOnlyBanner />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('stale-warning')).toBeInTheDocument();
    expect(screen.getByTestId('take-over-button')).toBeInTheDocument();
  });

  it('periodically checks for stale locks', async () => {
    mockUseIsReadOnly.mockReturnValue(true);
    mockUseLockHolder.mockReturnValue('other');

    // Initially fresh
    mockQueryLockStatus.mockResolvedValue({
      dbId: 'test-db',
      isLocked: true,
      holderId: 'tab-abc123',
      acquiredAt: Date.now(),
      isStale: false,
    });

    render(<ReadOnlyBanner staleThresholdMs={5000} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByTestId('take-over-button')).not.toBeInTheDocument();

    // Now make it stale
    mockQueryLockStatus.mockResolvedValue({
      dbId: 'test-db',
      isLocked: true,
      holderId: 'tab-abc123',
      acquiredAt: Date.now() - 10000, // 10s ago
      isStale: false,
    });

    // Advance timer to trigger periodic check
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByTestId('take-over-button')).toBeInTheDocument();
  });

  it('disables Retry button while retrying', async () => {
    mockUseIsReadOnly.mockReturnValue(true);
    mockUseLockHolder.mockReturnValue('other');

    // Make openDb return a promise that doesn't resolve immediately
    let resolveOpenDb: () => void;
    mockOpenDb.mockImplementation(
      () => new Promise<void>((resolve) => (resolveOpenDb = resolve))
    );

    render(<ReadOnlyBanner />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const retryButton = screen.getByTestId('retry-button');
    fireEvent.click(retryButton);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(retryButton).toBeDisabled();
    expect(retryButton).toHaveTextContent('Retrying...');

    // Resolve the openDb call
    await act(async () => {
      resolveOpenDb!();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(retryButton).not.toBeDisabled();
    expect(retryButton).toHaveTextContent('Retry');
  });
});
