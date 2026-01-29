import { render, screen } from '@testing-library/react';
import { GridSkeleton, type GridSkeletonProps } from '../GridSkeleton';

describe('GridSkeleton', () => {
  const defaultProps: GridSkeletonProps = {};

  describe('Rendering', () => {
    it('renders skeleton container', () => {
      render(<GridSkeleton {...defaultProps} />);

      const skeleton = screen.getByTestId('grid-skeleton');
      expect(skeleton).toBeInTheDocument();
    });

    it('renders header when showHeader is true (default)', () => {
      render(<GridSkeleton {...defaultProps} />);

      expect(screen.getByTestId('skeleton-header')).toBeInTheDocument();
    });

    it('does not render header when showHeader is false', () => {
      render(<GridSkeleton showHeader={false} />);

      expect(screen.queryByTestId('skeleton-header')).not.toBeInTheDocument();
    });

    it('renders correct number of rows', () => {
      render(<GridSkeleton rowCount={5} />);

      for (let i = 0; i < 5; i++) {
        expect(screen.getByTestId(`skeleton-row-${i}`)).toBeInTheDocument();
      }
      expect(screen.queryByTestId('skeleton-row-5')).not.toBeInTheDocument();
    });

    it('renders default 10 rows when rowCount not specified', () => {
      render(<GridSkeleton />);

      for (let i = 0; i < 10; i++) {
        expect(screen.getByTestId(`skeleton-row-${i}`)).toBeInTheDocument();
      }
      expect(screen.queryByTestId('skeleton-row-10')).not.toBeInTheDocument();
    });

    it('applies custom className', () => {
      render(<GridSkeleton className="custom-class" />);

      const skeleton = screen.getByTestId('grid-skeleton');
      expect(skeleton).toHaveClass('custom-class');
    });

    it('applies custom height', () => {
      render(<GridSkeleton height={300} />);

      const skeleton = screen.getByTestId('grid-skeleton');
      expect(skeleton).toHaveStyle({ height: '300px' });
    });
  });

  describe('Columns', () => {
    it('renders correct number of columns based on columnWidths', () => {
      const columnWidths = [100, 150, 200];
      render(<GridSkeleton columnWidths={columnWidths} rowCount={1} />);

      // Each row should have 3 data cells + 1 checkbox cell
      const row = screen.getByTestId('skeleton-row-0');
      const cells = row.querySelectorAll('& > div');
      // 1 checkbox + 3 data columns = 4
      expect(cells.length).toBe(4);
    });

    it('renders default 5 columns when columnWidths not specified', () => {
      render(<GridSkeleton columnCount={5} rowCount={1} />);

      const row = screen.getByTestId('skeleton-row-0');
      const cells = row.querySelectorAll('& > div');
      // 1 checkbox + 5 data columns = 6
      expect(cells.length).toBe(6);
    });

    it('uses columnCount when columnWidths not provided', () => {
      render(<GridSkeleton columnCount={3} rowCount={1} />);

      const row = screen.getByTestId('skeleton-row-0');
      const cells = row.querySelectorAll('& > div');
      // 1 checkbox + 3 data columns = 4
      expect(cells.length).toBe(4);
    });
  });

  describe('Accessibility', () => {
    it('has correct ARIA attributes', () => {
      render(<GridSkeleton />);

      const skeleton = screen.getByTestId('grid-skeleton');
      expect(skeleton).toHaveAttribute('role', 'status');
      expect(skeleton).toHaveAttribute('aria-label', 'Loading table data');
      expect(skeleton).toHaveAttribute('aria-busy', 'true');
    });

    it('has screen reader text', () => {
      render(<GridSkeleton />);

      expect(screen.getByText('Loading table data, please wait...')).toBeInTheDocument();
    });
  });

  describe('Visual States', () => {
    it('alternates row background colors', () => {
      render(<GridSkeleton rowCount={2} />);

      const row0 = screen.getByTestId('skeleton-row-0');
      const row1 = screen.getByTestId('skeleton-row-1');

      expect(row0).toHaveClass('bg-white');
      expect(row1).toHaveClass('bg-gray-50');
    });

    it('has shimmer animation on cells', () => {
      const { container } = render(<GridSkeleton rowCount={1} />);

      const shimmerElements = container.querySelectorAll('.animate-shimmer');
      expect(shimmerElements.length).toBeGreaterThan(0);
    });
  });
});
