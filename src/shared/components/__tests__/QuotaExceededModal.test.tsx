import { render, screen, fireEvent } from '@testing-library/react';
import { QuotaExceededModal } from '../QuotaExceededModal';

// Mock the store
const mockDatabases = [
  { name: 'db1', file: 'db1.sqlite', createdAt: '2024-01-01', lastOpenedAt: '2024-01-15', fkEnforced: true },
  { name: 'db2', file: 'db2.sqlite', createdAt: '2024-01-02', lastOpenedAt: '2024-01-10', fkEnforced: false },
];
let mockActiveDbId: string | null = 'db1';

vi.mock('../../../store', () => ({
  useDatabaseStore: vi.fn((selector) => {
    const state = {
      databases: mockDatabases,
      activeDbId: mockActiveDbId,
    };
    return selector(state);
  }),
  deleteDb: vi.fn(() => Promise.resolve()),
}));

// Mock the worker client
vi.mock('../../../core/worker/client', () => ({
  getWorkerClient: vi.fn(() => ({
    exportDb: vi.fn(() => Promise.resolve(new Blob(['test']))),
  })),
}));

describe('QuotaExceededModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveDbId = 'db1';
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <QuotaExceededModal isOpen={false} onClose={mockOnClose} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal when isOpen is true', () => {
    render(<QuotaExceededModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByTestId('quota-exceeded-modal')).toBeInTheDocument();
    expect(screen.getByText('Storage Full')).toBeInTheDocument();
  });

  it('displays database entries', () => {
    render(<QuotaExceededModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByTestId('db-entry-db1')).toBeInTheDocument();
    expect(screen.getByTestId('db-entry-db2')).toBeInTheDocument();
  });

  it('marks active database with badge', () => {
    render(<QuotaExceededModal isOpen={true} onClose={mockOnClose} />);

    const db1Entry = screen.getByTestId('db-entry-db1');
    expect(db1Entry).toHaveTextContent('Active');
  });

  it('calls onClose when Dismiss button is clicked', () => {
    render(<QuotaExceededModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('dismiss-button'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    render(<QuotaExceededModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('quota-exceeded-modal-backdrop'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('does not close when modal content is clicked', () => {
    render(<QuotaExceededModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('quota-exceeded-modal'));
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('enables export button when a database is active', () => {
    render(<QuotaExceededModal isOpen={true} onClose={mockOnClose} />);

    const exportButton = screen.getByTestId('export-button');
    expect(exportButton).not.toBeDisabled();
  });

  it('shows delete confirmation when delete icon is clicked', () => {
    render(<QuotaExceededModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('select-delete-db1'));

    expect(screen.getByTestId('delete-confirmation')).toBeInTheDocument();
    expect(screen.getByText('Delete "db1"?')).toBeInTheDocument();
  });

  it('hides delete confirmation when cancel is clicked', () => {
    render(<QuotaExceededModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('select-delete-db1'));
    expect(screen.getByTestId('delete-confirmation')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cancel-delete'));
    expect(screen.queryByTestId('delete-confirmation')).not.toBeInTheDocument();
  });

  it('shows clear storage confirmation when button is clicked', () => {
    render(<QuotaExceededModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('clear-storage-button'));

    expect(screen.getByTestId('clear-storage-confirmation')).toBeInTheDocument();
  });

  it('hides clear storage confirmation when cancel is clicked', () => {
    render(<QuotaExceededModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('clear-storage-button'));
    expect(screen.getByTestId('clear-storage-confirmation')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cancel-clear-storage'));
    expect(screen.queryByTestId('clear-storage-confirmation')).not.toBeInTheDocument();
  });

  it('has proper accessibility attributes', () => {
    render(<QuotaExceededModal isOpen={true} onClose={mockOnClose} />);

    const backdrop = screen.getByTestId('quota-exceeded-modal-backdrop');
    expect(backdrop).toHaveAttribute('role', 'dialog');
    expect(backdrop).toHaveAttribute('aria-modal', 'true');
  });
});
