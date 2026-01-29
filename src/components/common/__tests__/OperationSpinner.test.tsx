import { render, screen, fireEvent } from '@testing-library/react';
import { OperationSpinner, type OperationSpinnerProps } from '../OperationSpinner';

describe('OperationSpinner', () => {
  const defaultProps: OperationSpinnerProps = {
    isVisible: true,
  };

  describe('Visibility', () => {
    it('renders when isVisible is true', () => {
      render(<OperationSpinner {...defaultProps} />);

      expect(screen.getByTestId('operation-spinner-overlay')).toBeInTheDocument();
    });

    it('does not render when isVisible is false', () => {
      render(<OperationSpinner isVisible={false} />);

      expect(screen.queryByTestId('operation-spinner-overlay')).not.toBeInTheDocument();
    });
  });

  describe('Label', () => {
    it('renders with label', () => {
      render(<OperationSpinner {...defaultProps} label="Importing data..." />);

      expect(screen.getByTestId('operation-spinner-label')).toHaveTextContent('Importing data...');
    });

    it('does not render label when not provided', () => {
      render(<OperationSpinner {...defaultProps} />);

      expect(screen.queryByTestId('operation-spinner-label')).not.toBeInTheDocument();
    });
  });

  describe('Progress', () => {
    it('shows progress when provided', () => {
      render(<OperationSpinner {...defaultProps} progress={50} />);

      expect(screen.getByTestId('operation-spinner-progress')).toHaveTextContent('50%');
    });

    it('shows progress bar with correct width', () => {
      render(<OperationSpinner {...defaultProps} progress={75} />);

      const fill = screen.getByTestId('operation-spinner-progress-fill');
      expect(fill).toHaveStyle({ width: '75%' });
    });

    it('rounds progress percentage', () => {
      render(<OperationSpinner {...defaultProps} progress={33.7} />);

      expect(screen.getByTestId('operation-spinner-progress')).toHaveTextContent('34%');
    });

    it('does not show progress when not provided', () => {
      render(<OperationSpinner {...defaultProps} />);

      expect(screen.queryByTestId('operation-spinner-progress')).not.toBeInTheDocument();
    });

    it('has proper ARIA attributes for progress bar', () => {
      render(<OperationSpinner {...defaultProps} progress={50} label="Uploading" />);

      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toHaveAttribute('aria-valuenow', '50');
      expect(progressBar).toHaveAttribute('aria-valuemin', '0');
      expect(progressBar).toHaveAttribute('aria-valuemax', '100');
      expect(progressBar).toHaveAttribute('aria-label', 'Uploading');
    });
  });

  describe('Cancel Button', () => {
    it('shows cancel button when cancellable is true and onCancel provided', () => {
      const onCancel = vi.fn();
      render(<OperationSpinner {...defaultProps} cancellable onCancel={onCancel} />);

      expect(screen.getByTestId('operation-spinner-cancel')).toBeInTheDocument();
    });

    it('does not show cancel button when cancellable is false', () => {
      render(<OperationSpinner {...defaultProps} cancellable={false} />);

      expect(screen.queryByTestId('operation-spinner-cancel')).not.toBeInTheDocument();
    });

    it('does not show cancel button when onCancel not provided', () => {
      render(<OperationSpinner {...defaultProps} cancellable />);

      expect(screen.queryByTestId('operation-spinner-cancel')).not.toBeInTheDocument();
    });

    it('calls onCancel when clicked', () => {
      const onCancel = vi.fn();
      render(<OperationSpinner {...defaultProps} cancellable onCancel={onCancel} />);

      fireEvent.click(screen.getByTestId('operation-spinner-cancel'));

      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility', () => {
    it('has proper dialog ARIA attributes', () => {
      render(<OperationSpinner {...defaultProps} label="Loading" />);

      const overlay = screen.getByTestId('operation-spinner-overlay');
      expect(overlay).toHaveAttribute('role', 'dialog');
      expect(overlay).toHaveAttribute('aria-modal', 'true');
      expect(overlay).toHaveAttribute('aria-labelledby', 'operation-spinner-label');
    });

    it('has aria-describedby when progress is shown', () => {
      render(<OperationSpinner {...defaultProps} progress={50} />);

      const overlay = screen.getByTestId('operation-spinner-overlay');
      expect(overlay).toHaveAttribute('aria-describedby', 'operation-spinner-progress');
    });

    it('has screen reader live region for progress updates', () => {
      render(<OperationSpinner {...defaultProps} label="Importing" progress={50} />);

      const liveRegion = screen.getByText('Importing: 50% complete');
      expect(liveRegion).toHaveClass('sr-only');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
      expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    });
  });

  describe('Custom Styling', () => {
    it('applies custom className to overlay', () => {
      render(<OperationSpinner {...defaultProps} className="custom-class" />);

      const overlay = screen.getByTestId('operation-spinner-overlay');
      expect(overlay).toHaveClass('custom-class');
    });

    it('has semi-transparent backdrop', () => {
      render(<OperationSpinner {...defaultProps} />);

      const overlay = screen.getByTestId('operation-spinner-overlay');
      expect(overlay).toHaveClass('bg-black/50');
    });
  });
});
