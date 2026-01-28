import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  NewDatabaseDialog,
  validateDatabaseName,
  type NewDatabaseDialogProps,
} from '../NewDatabaseDialog';

describe('validateDatabaseName', () => {
  describe('empty/whitespace validation', () => {
    it('rejects empty name', () => {
      expect(validateDatabaseName('')).toEqual({
        valid: false,
        error: 'Name cannot be empty',
      });
    });

    it('rejects whitespace-only name', () => {
      expect(validateDatabaseName('   ')).toEqual({
        valid: false,
        error: 'Name cannot be empty',
      });
    });
  });

  describe('path separator validation', () => {
    it('rejects name with forward slash', () => {
      expect(validateDatabaseName('my/db')).toEqual({
        valid: false,
        error: 'Name cannot contain path separators (/ or \\)',
      });
    });

    it('rejects name with backslash', () => {
      expect(validateDatabaseName('my\\db')).toEqual({
        valid: false,
        error: 'Name cannot contain path separators (/ or \\)',
      });
    });
  });

  describe('hidden file validation', () => {
    it('rejects name starting with dot', () => {
      expect(validateDatabaseName('.hidden')).toEqual({
        valid: false,
        error: 'Name cannot start with a dot (hidden files)',
      });
    });

    it('allows dot in middle of name', () => {
      expect(validateDatabaseName('my.db')).toEqual({ valid: true });
    });
  });

  describe('Windows reserved name validation', () => {
    it.each(['CON', 'PRN', 'NUL', 'AUX'])('rejects reserved name: %s', (name) => {
      const result = validateDatabaseName(name);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reserved name');
    });

    it.each(['COM1', 'COM2', 'COM9'])('rejects reserved name: %s', (name) => {
      const result = validateDatabaseName(name);
      expect(result.valid).toBe(false);
    });

    it.each(['LPT1', 'LPT2', 'LPT9'])('rejects reserved name: %s', (name) => {
      const result = validateDatabaseName(name);
      expect(result.valid).toBe(false);
    });

    it('rejects reserved names case-insensitively', () => {
      expect(validateDatabaseName('con').valid).toBe(false);
      expect(validateDatabaseName('Con').valid).toBe(false);
      expect(validateDatabaseName('CON').valid).toBe(false);
    });

    it('rejects reserved names with extensions', () => {
      expect(validateDatabaseName('CON.txt').valid).toBe(false);
      expect(validateDatabaseName('prn.sqlite').valid).toBe(false);
    });
  });

  describe('length validation', () => {
    it('rejects name exceeding 255 characters', () => {
      const longName = 'a'.repeat(256);
      const result = validateDatabaseName(longName);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('255 characters');
    });

    it('accepts name at exactly 255 characters', () => {
      const maxName = 'a'.repeat(255);
      expect(validateDatabaseName(maxName)).toEqual({ valid: true });
    });
  });

  describe('uniqueness validation', () => {
    const existingNames = ['mydb', 'TestDB', 'ALLCAPS'];

    it('rejects duplicate name', () => {
      expect(validateDatabaseName('mydb', existingNames)).toEqual({
        valid: false,
        error: 'A database with this name already exists',
      });
    });

    it('rejects duplicate name case-insensitively', () => {
      expect(validateDatabaseName('MYDB', existingNames)).toEqual({
        valid: false,
        error: 'A database with this name already exists',
      });
      expect(validateDatabaseName('testdb', existingNames)).toEqual({
        valid: false,
        error: 'A database with this name already exists',
      });
    });

    it('accepts unique name', () => {
      expect(validateDatabaseName('newdb', existingNames)).toEqual({
        valid: true,
      });
    });
  });

  describe('valid names', () => {
    it('accepts simple valid name', () => {
      expect(validateDatabaseName('mydb')).toEqual({ valid: true });
    });

    it('accepts name with spaces', () => {
      expect(validateDatabaseName('my database')).toEqual({ valid: true });
    });

    it('accepts name with numbers', () => {
      expect(validateDatabaseName('db123')).toEqual({ valid: true });
    });

    it('accepts name with hyphens and underscores', () => {
      expect(validateDatabaseName('my-db_test')).toEqual({ valid: true });
    });

    it('trims whitespace', () => {
      expect(validateDatabaseName('  mydb  ')).toEqual({ valid: true });
    });
  });
});

describe('NewDatabaseDialog', () => {
  const defaultProps: NewDatabaseDialogProps = {
    isOpen: true,
    onClose: vi.fn(),
    onCreate: vi.fn(),
    existingNames: [],
    isReadOnly: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders dialog when open', () => {
      render(<NewDatabaseDialog {...defaultProps} />);

      expect(screen.getByTestId('new-database-dialog')).toBeInTheDocument();
      expect(screen.getByText('Create New Database')).toBeInTheDocument();
      expect(screen.getByTestId('database-name-input')).toBeInTheDocument();
      expect(screen.getByTestId('create-button')).toBeInTheDocument();
      expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      render(<NewDatabaseDialog {...defaultProps} isOpen={false} />);

      expect(screen.queryByTestId('new-database-dialog')).not.toBeInTheDocument();
    });

    it('does not render when read-only', () => {
      render(<NewDatabaseDialog {...defaultProps} isReadOnly={true} />);

      expect(screen.queryByTestId('new-database-dialog')).not.toBeInTheDocument();
    });

    it('has proper accessibility attributes', () => {
      render(<NewDatabaseDialog {...defaultProps} />);

      const backdrop = screen.getByTestId('new-database-dialog-backdrop');
      expect(backdrop).toHaveAttribute('role', 'dialog');
      expect(backdrop).toHaveAttribute('aria-modal', 'true');
      expect(backdrop).toHaveAttribute('aria-labelledby', 'new-database-dialog-title');
    });
  });

  describe('Input validation', () => {
    it('shows create button disabled initially', () => {
      render(<NewDatabaseDialog {...defaultProps} />);

      const createButton = screen.getByTestId('create-button');
      expect(createButton).toBeDisabled();
    });

    it('enables create button with valid name after debounce', async () => {
      render(<NewDatabaseDialog {...defaultProps} />);

      const input = screen.getByTestId('database-name-input');
      fireEvent.change(input, { target: { value: 'mydb' } });

      // Wait for debounced validation
      await waitFor(() => {
        expect(screen.getByTestId('create-button')).not.toBeDisabled();
      });
    });

    it('shows error for name containing path separator', async () => {
      render(<NewDatabaseDialog {...defaultProps} />);

      const input = screen.getByTestId('database-name-input');
      fireEvent.change(input, { target: { value: 'my/db' } });

      // Wait for debounced validation
      await waitFor(() => {
        expect(screen.getByTestId('name-validation-error')).toBeInTheDocument();
        expect(screen.getByText(/path separators/i)).toBeInTheDocument();
      });
      expect(screen.getByTestId('create-button')).toBeDisabled();
    });

    it('shows error for existing name', async () => {
      render(<NewDatabaseDialog {...defaultProps} existingNames={['existing']} />);

      const input = screen.getByTestId('database-name-input');
      fireEvent.change(input, { target: { value: 'existing' } });

      // Wait for debounced validation
      await waitFor(() => {
        expect(screen.getByTestId('name-validation-error')).toBeInTheDocument();
        expect(screen.getByText(/already exists/i)).toBeInTheDocument();
      });
      expect(screen.getByTestId('create-button')).toBeDisabled();
    });

    it('does not show error before typing', () => {
      render(<NewDatabaseDialog {...defaultProps} />);

      expect(screen.queryByTestId('name-validation-error')).not.toBeInTheDocument();
    });
  });

  describe('Create action', () => {
    it('calls onCreate with trimmed name when Create is clicked', async () => {
      const onCreate = vi.fn();
      render(<NewDatabaseDialog {...defaultProps} onCreate={onCreate} />);

      const input = screen.getByTestId('database-name-input');
      fireEvent.change(input, { target: { value: '  mydb  ' } });

      await waitFor(() => {
        expect(screen.getByTestId('create-button')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByTestId('create-button'));

      expect(onCreate).toHaveBeenCalledWith('mydb');
    });

    it('calls onClose after create', async () => {
      const onClose = vi.fn();
      render(<NewDatabaseDialog {...defaultProps} onClose={onClose} />);

      const input = screen.getByTestId('database-name-input');
      fireEvent.change(input, { target: { value: 'mydb' } });

      await waitFor(() => {
        expect(screen.getByTestId('create-button')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByTestId('create-button'));

      expect(onClose).toHaveBeenCalled();
    });

    it('does not call onCreate when button is disabled', () => {
      const onCreate = vi.fn();
      render(<NewDatabaseDialog {...defaultProps} onCreate={onCreate} />);

      // Try to click disabled button
      fireEvent.click(screen.getByTestId('create-button'));

      expect(onCreate).not.toHaveBeenCalled();
    });
  });

  describe('Cancel action', () => {
    it('calls onClose when Cancel is clicked', () => {
      const onClose = vi.fn();
      render(<NewDatabaseDialog {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByTestId('cancel-button'));

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Keyboard navigation', () => {
    it('submits on Enter when valid', async () => {
      const onCreate = vi.fn();
      render(<NewDatabaseDialog {...defaultProps} onCreate={onCreate} />);

      const input = screen.getByTestId('database-name-input');
      fireEvent.change(input, { target: { value: 'mydb' } });

      await waitFor(() => {
        expect(screen.getByTestId('create-button')).not.toBeDisabled();
      });

      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onCreate).toHaveBeenCalledWith('mydb');
    });

    it('does not submit on Enter when invalid', async () => {
      const onCreate = vi.fn();
      render(<NewDatabaseDialog {...defaultProps} onCreate={onCreate} />);

      const input = screen.getByTestId('database-name-input');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onCreate).not.toHaveBeenCalled();
    });

    it('closes on Escape', () => {
      const onClose = vi.fn();
      render(<NewDatabaseDialog {...defaultProps} onClose={onClose} />);

      const input = screen.getByTestId('database-name-input');
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Backdrop interaction', () => {
    it('closes when clicking backdrop', () => {
      const onClose = vi.fn();
      render(<NewDatabaseDialog {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByTestId('new-database-dialog-backdrop'));

      expect(onClose).toHaveBeenCalled();
    });

    it('does not close when clicking dialog content', () => {
      const onClose = vi.fn();
      render(<NewDatabaseDialog {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByTestId('new-database-dialog'));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('State reset', () => {
    it('resets input when reopened', async () => {
      const { rerender } = render(
        <NewDatabaseDialog {...defaultProps} isOpen={true} />
      );

      const input = screen.getByTestId('database-name-input');
      fireEvent.change(input, { target: { value: 'mydb' } });

      // Close dialog
      rerender(<NewDatabaseDialog {...defaultProps} isOpen={false} />);

      // Reopen dialog
      rerender(<NewDatabaseDialog {...defaultProps} isOpen={true} />);

      expect(screen.getByTestId('database-name-input')).toHaveValue('');
    });

    it('resets validation state when reopened', async () => {
      const { rerender } = render(
        <NewDatabaseDialog {...defaultProps} isOpen={true} />
      );

      const input = screen.getByTestId('database-name-input');
      fireEvent.change(input, { target: { value: 'my/db' } });

      await waitFor(() => {
        expect(screen.getByTestId('name-validation-error')).toBeInTheDocument();
      });

      // Close and reopen
      rerender(<NewDatabaseDialog {...defaultProps} isOpen={false} />);
      rerender(<NewDatabaseDialog {...defaultProps} isOpen={true} />);

      // Error should be gone
      expect(screen.queryByTestId('name-validation-error')).not.toBeInTheDocument();
    });
  });

  describe('Read-only mode', () => {
    it('dialog is not rendered in read-only mode', () => {
      render(<NewDatabaseDialog {...defaultProps} isReadOnly={true} />);

      expect(screen.queryByTestId('new-database-dialog')).not.toBeInTheDocument();
    });
  });
});
