import { render, screen, fireEvent } from '@testing-library/react';
import { PersistenceErrorBanner } from '../PersistenceErrorBanner';
import type { StorageStatus } from '../../../types';

// Mock store state
let mockStorageStatus: StorageStatus = 'ok';

vi.mock('../../../store', () => ({
  useIsDegradedPersistence: vi.fn(() => mockStorageStatus === 'degraded'),
}));

describe('PersistenceErrorBanner', () => {
  const mockOnDetailsClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageStatus = 'ok';
  });

  it('renders nothing when storage status is ok', () => {
    mockStorageStatus = 'ok';
    const { container } = render(
      <PersistenceErrorBanner onDetailsClick={mockOnDetailsClick} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when storage status is quota_exceeded (not degraded)', () => {
    mockStorageStatus = 'quota_exceeded';
    const { container } = render(
      <PersistenceErrorBanner onDetailsClick={mockOnDetailsClick} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders banner when storage status is degraded', () => {
    mockStorageStatus = 'degraded';
    render(<PersistenceErrorBanner onDetailsClick={mockOnDetailsClick} />);

    expect(screen.getByTestId('persistence-error-banner')).toBeInTheDocument();
    expect(screen.getByText('Warning: Changes may not be saved')).toBeInTheDocument();
  });

  it('calls onDetailsClick when Details link is clicked', () => {
    mockStorageStatus = 'degraded';
    render(<PersistenceErrorBanner onDetailsClick={mockOnDetailsClick} />);

    fireEvent.click(screen.getByTestId('details-link'));
    expect(mockOnDetailsClick).toHaveBeenCalledTimes(1);
  });

  it('has proper accessibility attributes', () => {
    mockStorageStatus = 'degraded';
    render(<PersistenceErrorBanner onDetailsClick={mockOnDetailsClick} />);

    const banner = screen.getByTestId('persistence-error-banner');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveAttribute('aria-live', 'assertive');
  });

  it('has red styling', () => {
    mockStorageStatus = 'degraded';
    render(<PersistenceErrorBanner onDetailsClick={mockOnDetailsClick} />);

    const banner = screen.getByTestId('persistence-error-banner');
    expect(banner).toHaveClass('bg-red-100');
    expect(banner).toHaveClass('border-red-300');
  });

  it('displays warning icon', () => {
    mockStorageStatus = 'degraded';
    render(<PersistenceErrorBanner onDetailsClick={mockOnDetailsClick} />);

    const icon = screen.getByTestId('persistence-error-banner').querySelector('svg');
    expect(icon).toBeInTheDocument();
  });
});
