import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressBar, type ProgressBarProps } from '../ProgressBar';

describe('ProgressBar', () => {
  const defaultProps: ProgressBarProps = {
    percent: 50,
  };

  describe('Rendering', () => {
    it('renders progress bar with percentage', () => {
      render(<ProgressBar {...defaultProps} />);

      const progressBar = screen.getByTestId('progress-bar');
      expect(progressBar).toBeInTheDocument();
      expect(screen.getByTestId('progress-percent')).toHaveTextContent('50%');
    });

    it('renders with label', () => {
      render(<ProgressBar {...defaultProps} label="Importing database..." />);

      expect(screen.getByTestId('progress-label')).toHaveTextContent('Importing database...');
    });

    it('has proper accessibility attributes', () => {
      render(<ProgressBar {...defaultProps} label="Upload progress" />);

      const progressElement = screen.getByRole('progressbar');
      expect(progressElement).toHaveAttribute('aria-valuenow', '50');
      expect(progressElement).toHaveAttribute('aria-valuemin', '0');
      expect(progressElement).toHaveAttribute('aria-valuemax', '100');
      expect(progressElement).toHaveAttribute('aria-label', 'Upload progress');
    });

    it('applies custom className', () => {
      render(<ProgressBar {...defaultProps} className="custom-class" />);

      const progressBar = screen.getByTestId('progress-bar');
      expect(progressBar).toHaveClass('custom-class');
    });
  });

  describe('Progress Display', () => {
    it('shows 0% progress', () => {
      render(<ProgressBar percent={0} />);

      expect(screen.getByTestId('progress-percent')).toHaveTextContent('0%');
      const fill = screen.getByTestId('progress-fill');
      expect(fill).toHaveStyle({ width: '0%' });
    });

    it('shows 100% progress', () => {
      render(<ProgressBar percent={100} />);

      expect(screen.getByTestId('progress-percent')).toHaveTextContent('100%');
      const fill = screen.getByTestId('progress-fill');
      expect(fill).toHaveStyle({ width: '100%' });
    });

    it('clamps percent above 100', () => {
      render(<ProgressBar percent={150} />);

      expect(screen.getByTestId('progress-percent')).toHaveTextContent('100%');
      const fill = screen.getByTestId('progress-fill');
      expect(fill).toHaveStyle({ width: '100%' });
    });

    it('clamps percent below 0', () => {
      render(<ProgressBar percent={-10} />);

      expect(screen.getByTestId('progress-percent')).toHaveTextContent('0%');
      const fill = screen.getByTestId('progress-fill');
      expect(fill).toHaveStyle({ width: '0%' });
    });

    it('rounds percentage to nearest integer', () => {
      render(<ProgressBar percent={33.7} />);

      expect(screen.getByTestId('progress-percent')).toHaveTextContent('34%');
    });
  });

  describe('Bytes Display', () => {
    it('shows bytes processed and total bytes', () => {
      render(
        <ProgressBar
          percent={50}
          bytesProcessed={512}
          totalBytes={1024}
        />
      );

      expect(screen.getByTestId('progress-bytes')).toHaveTextContent('512 B / 1.0 KB');
    });

    it('formats KB correctly', () => {
      render(
        <ProgressBar
          percent={50}
          bytesProcessed={1536}
          totalBytes={3072}
        />
      );

      expect(screen.getByTestId('progress-bytes')).toHaveTextContent('1.5 KB / 3.0 KB');
    });

    it('formats MB correctly', () => {
      render(
        <ProgressBar
          percent={50}
          bytesProcessed={5 * 1024 * 1024}
          totalBytes={10 * 1024 * 1024}
        />
      );

      expect(screen.getByTestId('progress-bytes')).toHaveTextContent('5.0 MB / 10.0 MB');
    });

    it('does not show bytes when not provided', () => {
      render(<ProgressBar percent={50} />);

      expect(screen.queryByTestId('progress-bytes')).not.toBeInTheDocument();
    });

    it('does not show bytes when totalBytes is 0', () => {
      render(
        <ProgressBar
          percent={50}
          bytesProcessed={0}
          totalBytes={0}
        />
      );

      expect(screen.queryByTestId('progress-bytes')).not.toBeInTheDocument();
    });
  });

  describe('Cancel Button', () => {
    it('shows cancel button when showCancel is true', () => {
      const onCancel = vi.fn();
      render(
        <ProgressBar
          percent={50}
          showCancel
          onCancel={onCancel}
        />
      );

      expect(screen.getByTestId('progress-cancel-button')).toBeInTheDocument();
    });

    it('does not show cancel button when showCancel is false', () => {
      render(<ProgressBar percent={50} />);

      expect(screen.queryByTestId('progress-cancel-button')).not.toBeInTheDocument();
    });

    it('does not show cancel button when onCancel is not provided', () => {
      render(<ProgressBar percent={50} showCancel />);

      expect(screen.queryByTestId('progress-cancel-button')).not.toBeInTheDocument();
    });

    it('triggers cancel handler on click', () => {
      const onCancel = vi.fn();
      render(
        <ProgressBar
          percent={50}
          showCancel
          onCancel={onCancel}
        />
      );

      fireEvent.click(screen.getByTestId('progress-cancel-button'));

      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('Visual States', () => {
    it('shows progress fill at correct width', () => {
      render(<ProgressBar percent={75} />);

      const fill = screen.getByTestId('progress-fill');
      expect(fill).toHaveStyle({ width: '75%' });
    });

    it('has transition classes for smooth animation', () => {
      render(<ProgressBar percent={50} />);

      const fill = screen.getByTestId('progress-fill');
      expect(fill).toHaveClass('transition-all');
    });
  });
});
