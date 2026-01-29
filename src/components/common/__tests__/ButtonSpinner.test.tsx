import { render, screen, fireEvent } from '@testing-library/react';
import { ButtonSpinner, type ButtonSpinnerProps } from '../ButtonSpinner';

describe('ButtonSpinner', () => {
  const defaultProps: ButtonSpinnerProps = {
    isLoading: false,
    children: 'Submit',
  };

  describe('Normal State', () => {
    it('renders button with children when not loading', () => {
      render(<ButtonSpinner {...defaultProps} />);

      const button = screen.getByTestId('button-spinner');
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent('Submit');
    });

    it('is not disabled when not loading', () => {
      render(<ButtonSpinner {...defaultProps} />);

      const button = screen.getByTestId('button-spinner');
      expect(button).not.toBeDisabled();
    });

    it('does not show spinner when not loading', () => {
      render(<ButtonSpinner {...defaultProps} />);

      expect(screen.queryByTestId('button-spinner-loading')).not.toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('shows spinner when loading', () => {
      render(<ButtonSpinner {...defaultProps} isLoading />);

      expect(screen.getByTestId('button-spinner-loading')).toBeInTheDocument();
      expect(screen.getByTestId('button-spinner-icon')).toBeInTheDocument();
    });

    it('hides children when loading', () => {
      render(<ButtonSpinner {...defaultProps} isLoading />);

      expect(screen.queryByText('Submit')).not.toBeInTheDocument();
    });

    it('shows loading text when provided', () => {
      render(<ButtonSpinner {...defaultProps} isLoading loadingText="Saving..." />);

      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    it('disables button when loading', () => {
      render(<ButtonSpinner {...defaultProps} isLoading />);

      const button = screen.getByTestId('button-spinner');
      expect(button).toBeDisabled();
    });

    it('has aria-busy when loading', () => {
      render(<ButtonSpinner {...defaultProps} isLoading />);

      const button = screen.getByTestId('button-spinner');
      expect(button).toHaveAttribute('aria-busy', 'true');
    });
  });

  describe('Disabled State', () => {
    it('respects explicit disabled prop', () => {
      render(<ButtonSpinner {...defaultProps} disabled />);

      const button = screen.getByTestId('button-spinner');
      expect(button).toBeDisabled();
    });

    it('is disabled when loading even without disabled prop', () => {
      render(<ButtonSpinner {...defaultProps} isLoading />);

      const button = screen.getByTestId('button-spinner');
      expect(button).toBeDisabled();
    });

    it('is disabled when both loading and disabled', () => {
      render(<ButtonSpinner {...defaultProps} isLoading disabled />);

      const button = screen.getByTestId('button-spinner');
      expect(button).toBeDisabled();
    });
  });

  describe('Spinner Sizes', () => {
    it('renders small spinner', () => {
      render(<ButtonSpinner {...defaultProps} isLoading size="sm" />);

      const icon = screen.getByTestId('button-spinner-icon');
      expect(icon).toHaveClass('w-3', 'h-3');
    });

    it('renders medium spinner (default)', () => {
      render(<ButtonSpinner {...defaultProps} isLoading />);

      const icon = screen.getByTestId('button-spinner-icon');
      expect(icon).toHaveClass('w-4', 'h-4');
    });

    it('renders large spinner', () => {
      render(<ButtonSpinner {...defaultProps} isLoading size="lg" />);

      const icon = screen.getByTestId('button-spinner-icon');
      expect(icon).toHaveClass('w-5', 'h-5');
    });
  });

  describe('Click Handler', () => {
    it('fires onClick when clicked and not loading', () => {
      const onClick = vi.fn();
      render(<ButtonSpinner {...defaultProps} onClick={onClick} />);

      fireEvent.click(screen.getByTestId('button-spinner'));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not fire onClick when loading', () => {
      const onClick = vi.fn();
      render(<ButtonSpinner {...defaultProps} isLoading onClick={onClick} />);

      fireEvent.click(screen.getByTestId('button-spinner'));

      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('Styling', () => {
    it('applies custom className', () => {
      render(<ButtonSpinner {...defaultProps} className="custom-btn-class" />);

      const button = screen.getByTestId('button-spinner');
      expect(button).toHaveClass('custom-btn-class');
    });

    it('passes through other button props', () => {
      render(<ButtonSpinner {...defaultProps} type="submit" name="submit-btn" />);

      const button = screen.getByTestId('button-spinner');
      expect(button).toHaveAttribute('type', 'submit');
      expect(button).toHaveAttribute('name', 'submit-btn');
    });
  });

  describe('Complex Children', () => {
    it('renders icon + text children', () => {
      render(
        <ButtonSpinner {...defaultProps}>
          <span data-testid="icon">🔍</span>
          <span>Search</span>
        </ButtonSpinner>
      );

      expect(screen.getByTestId('icon')).toBeInTheDocument();
      expect(screen.getByText('Search')).toBeInTheDocument();
    });

    it('hides complex children when loading', () => {
      render(
        <ButtonSpinner {...defaultProps} isLoading>
          <span data-testid="icon">🔍</span>
          <span>Search</span>
        </ButtonSpinner>
      );

      expect(screen.queryByTestId('icon')).not.toBeInTheDocument();
      expect(screen.queryByText('Search')).not.toBeInTheDocument();
    });
  });
});
