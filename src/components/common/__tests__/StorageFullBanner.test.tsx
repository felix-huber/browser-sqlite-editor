import { render, screen, fireEvent } from '@testing-library/react';
import { StorageFullBanner } from '../StorageFullBanner';
import { useStorageStatus } from '../../../store';

// Mock the store
vi.mock('../../../store', async () => {
  const actual = await vi.importActual('../../../store');
  return {
    ...actual,
    useStorageStatus: vi.fn(),
  };
});

const mockUseStorageStatus = vi.mocked(useStorageStatus);

describe('StorageFullBanner', () => {
  const mockOnFreeSpaceClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseStorageStatus.mockReturnValue('ok');
  });

  it('renders nothing when storageStatus is "ok"', () => {
    mockUseStorageStatus.mockReturnValue('ok');

    const { container } = render(
      <StorageFullBanner onFreeSpaceClick={mockOnFreeSpaceClick} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when storageStatus is "degraded"', () => {
    mockUseStorageStatus.mockReturnValue('degraded');

    const { container } = render(
      <StorageFullBanner onFreeSpaceClick={mockOnFreeSpaceClick} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders banner when storageStatus is "quota_exceeded"', () => {
    mockUseStorageStatus.mockReturnValue('quota_exceeded');

    render(<StorageFullBanner onFreeSpaceClick={mockOnFreeSpaceClick} />);

    expect(screen.getByTestId('storage-full-banner')).toBeInTheDocument();
    expect(screen.getByText(/Storage full — writes disabled/)).toBeInTheDocument();
  });

  it('displays "Free space" link', () => {
    mockUseStorageStatus.mockReturnValue('quota_exceeded');

    render(<StorageFullBanner onFreeSpaceClick={mockOnFreeSpaceClick} />);

    expect(screen.getByTestId('free-space-link')).toBeInTheDocument();
    expect(screen.getByText('Free space')).toBeInTheDocument();
  });

  it('calls onFreeSpaceClick when "Free space" link is clicked', () => {
    mockUseStorageStatus.mockReturnValue('quota_exceeded');

    render(<StorageFullBanner onFreeSpaceClick={mockOnFreeSpaceClick} />);

    fireEvent.click(screen.getByTestId('free-space-link'));
    expect(mockOnFreeSpaceClick).toHaveBeenCalled();
  });

  it('has proper accessibility attributes', () => {
    mockUseStorageStatus.mockReturnValue('quota_exceeded');

    render(<StorageFullBanner onFreeSpaceClick={mockOnFreeSpaceClick} />);

    const banner = screen.getByTestId('storage-full-banner');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('has error styling (red background)', () => {
    mockUseStorageStatus.mockReturnValue('quota_exceeded');

    render(<StorageFullBanner onFreeSpaceClick={mockOnFreeSpaceClick} />);

    const banner = screen.getByTestId('storage-full-banner');
    expect(banner).toHaveClass('bg-red-50');
  });

  it('shows warning icon', () => {
    mockUseStorageStatus.mockReturnValue('quota_exceeded');

    render(<StorageFullBanner onFreeSpaceClick={mockOnFreeSpaceClick} />);

    const banner = screen.getByTestId('storage-full-banner');
    const svg = banner.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
