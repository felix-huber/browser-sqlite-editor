import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PersistenceErrorModal } from '../PersistenceErrorModal';

// Mock store state
let mockActiveDbId: string | null = 'test-db';
let mockPersistenceError: string | null = 'IndexedDB write failed: QuotaExceededError';
let mockFailedAttempts = 3;
const mockSetPersistenceStatus = vi.fn();
const mockSetStorageStatus = vi.fn();
const mockClearFailedSaveAttempts = vi.fn();

vi.mock('../../../store', () => ({
  useDatabaseStore: vi.fn((selector) => {
    const state = {
      activeDbId: mockActiveDbId,
      setPersistenceStatus: mockSetPersistenceStatus,
      setStorageStatus: mockSetStorageStatus,
      clearFailedSaveAttempts: mockClearFailedSaveAttempts,
    };
    return selector(state);
  }),
  usePersistenceError: vi.fn(() => mockPersistenceError),
  useFailedSaveAttempts: vi.fn(() => mockFailedAttempts),
}));

// Mock worker client
const mockFlushSnapshot = vi.fn();
const mockExportDb = vi.fn();

vi.mock('../../../core/worker/client', () => ({
  getWorkerClient: vi.fn(() => ({
    flushSnapshot: mockFlushSnapshot,
    exportDb: mockExportDb,
  })),
}));

// Store original window.location
const originalLocation = window.location;

describe('PersistenceErrorModal', () => {
  const mockOnClose = vi.fn();
  const mockOnRetrySuccess = vi.fn();
  const mockOnDiscardChanges = vi.fn();
  const mockReload = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveDbId = 'test-db';
    mockPersistenceError = 'IndexedDB write failed: QuotaExceededError';
    mockFailedAttempts = 3;
    mockFlushSnapshot.mockResolvedValue(undefined);
    mockExportDb.mockResolvedValue(new Blob(['test']));

    // Mock window.location.reload
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: mockReload },
      writable: true,
    });
  });

  afterEach(() => {
    // Restore original window.location
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <PersistenceErrorModal isOpen={false} onClose={mockOnClose} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal when isOpen is true', () => {
    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByTestId('persistence-error-modal')).toBeInTheDocument();
    expect(screen.getByText('Persistence Error')).toBeInTheDocument();
  });

  it('displays failed attempts count', () => {
    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByText(/Failed to save changes to storage after 3 attempts/)).toBeInTheDocument();
  });

  it('displays warning about data loss', () => {
    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByText('Changes may be lost if you close this tab')).toBeInTheDocument();
  });

  it('toggles technical details when clicked', () => {
    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    // Details should be hidden initially
    expect(screen.queryByTestId('technical-details')).not.toBeInTheDocument();

    // Click to show details
    fireEvent.click(screen.getByTestId('toggle-details'));
    expect(screen.getByTestId('technical-details')).toBeInTheDocument();
    expect(screen.getByTestId('technical-details')).toHaveTextContent('IndexedDB write failed: QuotaExceededError');

    // Click to hide details
    fireEvent.click(screen.getByTestId('toggle-details'));
    expect(screen.queryByTestId('technical-details')).not.toBeInTheDocument();
  });

  it('calls onClose when Continue Without Saving button is clicked', () => {
    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('continue-button'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('persistence-error-modal-backdrop'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when modal content is clicked', () => {
    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('persistence-error-modal'));
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('exports database when Export button is clicked', async () => {
    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('export-button'));

    await waitFor(() => {
      expect(mockExportDb).toHaveBeenCalledWith('test-db');
    });
  });

  it('retries save and clears state on success', async () => {
    render(
      <PersistenceErrorModal
        isOpen={true}
        onClose={mockOnClose}
        onRetrySuccess={mockOnRetrySuccess}
      />
    );

    fireEvent.click(screen.getByTestId('retry-button'));

    await waitFor(() => {
      expect(mockFlushSnapshot).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockClearFailedSaveAttempts).toHaveBeenCalled();
      expect(mockSetStorageStatus).toHaveBeenCalledWith('ok');
      expect(mockSetPersistenceStatus).toHaveBeenCalledWith('saved');
      expect(mockOnRetrySuccess).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('shows error message when retry fails', async () => {
    mockFlushSnapshot.mockRejectedValue(new Error('IDB still unavailable'));

    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('retry-button'));

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('IDB still unavailable');
    });
  });

  it('discards changes and reloads page when Discard Changes is clicked', () => {
    render(
      <PersistenceErrorModal
        isOpen={true}
        onClose={mockOnClose}
        onDiscardChanges={mockOnDiscardChanges}
      />
    );

    fireEvent.click(screen.getByTestId('discard-button'));

    expect(mockClearFailedSaveAttempts).toHaveBeenCalled();
    expect(mockSetStorageStatus).toHaveBeenCalledWith('ok');
    expect(mockSetPersistenceStatus).toHaveBeenCalledWith('saved');
    expect(mockOnDiscardChanges).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
    expect(mockReload).toHaveBeenCalled();
  });

  it('disables export button when no database is active', () => {
    mockActiveDbId = null;
    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByTestId('export-button')).toBeDisabled();
  });

  it('disables retry button when no database is active', () => {
    mockActiveDbId = null;
    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByTestId('retry-button')).toBeDisabled();
  });

  it('has proper accessibility attributes', () => {
    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    const backdrop = screen.getByTestId('persistence-error-modal-backdrop');
    expect(backdrop).toHaveAttribute('role', 'dialog');
    expect(backdrop).toHaveAttribute('aria-modal', 'true');
  });

  it('shows default error when persistenceError is null', () => {
    mockPersistenceError = null;
    render(<PersistenceErrorModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('toggle-details'));
    expect(screen.getByTestId('technical-details')).toHaveTextContent('IndexedDB write failed');
  });
});
