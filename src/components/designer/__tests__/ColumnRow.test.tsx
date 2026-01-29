import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ColumnRow, validateColumnName, SQLITE_RESERVED_WORDS } from '../ColumnRow';
import type { DesignerColumnDraft } from '../../../types';

// =============================================================================
// validateColumnName Tests
// =============================================================================

describe('validateColumnName', () => {
  describe('empty validation', () => {
    it('rejects empty name', () => {
      expect(validateColumnName('')).toEqual({
        valid: false,
        error: 'Column name is required',
      });
    });

    it('rejects whitespace-only name', () => {
      expect(validateColumnName('   ')).toEqual({
        valid: false,
        error: 'Column name is required',
      });
    });
  });

  describe('space validation', () => {
    it('rejects name with spaces', () => {
      const result = validateColumnName('my column');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('spaces');
    });

    it('rejects name with tab', () => {
      const result = validateColumnName('my\tcolumn');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('spaces');
    });
  });

  describe('reserved word validation', () => {
    it('rejects SQLite reserved words', () => {
      const result = validateColumnName('SELECT');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reserved word');
    });

    it('rejects reserved words case-insensitively', () => {
      expect(validateColumnName('select').valid).toBe(false);
      expect(validateColumnName('Select').valid).toBe(false);
      expect(validateColumnName('TABLE').valid).toBe(false);
    });

    it('has comprehensive reserved word list', () => {
      expect(SQLITE_RESERVED_WORDS.has('SELECT')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('FROM')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('WHERE')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('PRIMARY')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('NULL')).toBe(true);
    });
  });

  describe('character validation', () => {
    it('rejects name starting with number', () => {
      const result = validateColumnName('123col');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must start with');
    });

    it('rejects name with special characters', () => {
      expect(validateColumnName('my-column').valid).toBe(false);
      expect(validateColumnName('my.column').valid).toBe(false);
      expect(validateColumnName('my@column').valid).toBe(false);
    });

    it('accepts underscore at start', () => {
      expect(validateColumnName('_my_column')).toEqual({ valid: true });
    });
  });

  describe('uniqueness validation', () => {
    const existingNames = ['id', 'Name', 'EMAIL'];

    it('rejects duplicate name', () => {
      expect(validateColumnName('id', existingNames)).toEqual({
        valid: false,
        error: 'A column with this name already exists',
      });
    });

    it('rejects duplicate name case-insensitively', () => {
      expect(validateColumnName('ID', existingNames).valid).toBe(false);
      expect(validateColumnName('name', existingNames).valid).toBe(false);
      expect(validateColumnName('email', existingNames).valid).toBe(false);
    });

    it('skips uniqueness check when name is unchanged (originalName matches)', () => {
      const result = validateColumnName('id', existingNames, 'id');
      expect(result.valid).toBe(true);
    });

    it('checks uniqueness when name changes from original', () => {
      const result = validateColumnName('Name', existingNames, 'id');
      expect(result.valid).toBe(false);
    });
  });

  describe('valid names', () => {
    it('accepts simple valid name', () => {
      expect(validateColumnName('name')).toEqual({ valid: true });
    });

    it('accepts name with underscores', () => {
      expect(validateColumnName('first_name')).toEqual({ valid: true });
    });

    it('accepts name with numbers (not at start)', () => {
      expect(validateColumnName('column2')).toEqual({ valid: true });
    });

    it('accepts mixed case', () => {
      expect(validateColumnName('FirstName')).toEqual({ valid: true });
    });
  });
});

// =============================================================================
// ColumnRow Component Tests
// =============================================================================

describe('ColumnRow', () => {
  const createColumn = (overrides: Partial<DesignerColumnDraft> = {}): DesignerColumnDraft => ({
    id: 'col-1',
    name: 'test_column',
    type: 'TEXT',
    isPrimaryKey: false,
    isNotNull: false,
    isUnique: false,
    defaultValue: null,
    isExisting: false,
    ...overrides,
  });

  const defaultProps = {
    column: createColumn(),
    disabled: false,
    showDeleteConfirm: false,
    onChange: vi.fn(),
    onDelete: vi.fn(),
    onToggleDeleteConfirm: vi.fn(),
    isNew: false,
    index: 1,
    existingColumnNames: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Name Input', () => {
    it('renders column name input with value', () => {
      render(<ColumnRow {...defaultProps} />);
      const input = screen.getByTestId('column-name-col-1');
      expect(input).toHaveValue('test_column');
    });

    it('updates state on name change', () => {
      const onChange = vi.fn();
      render(<ColumnRow {...defaultProps} onChange={onChange} />);

      const input = screen.getByTestId('column-name-col-1');
      fireEvent.change(input, { target: { value: 'new_name' } });

      expect(onChange).toHaveBeenCalledWith('col-1', { name: 'new_name' });
    });

    it('validates name on blur and shows error for empty name', async () => {
      render(<ColumnRow {...defaultProps} column={createColumn({ name: '' })} />);

      const input = screen.getByTestId('column-name-col-1');
      fireEvent.blur(input);

      await waitFor(() => {
        expect(screen.getByTestId('column-name-error-col-1')).toBeInTheDocument();
        expect(screen.getByText(/Column name is required/i)).toBeInTheDocument();
      });
    });

    it('validates name on blur and shows error for reserved word', async () => {
      render(<ColumnRow {...defaultProps} column={createColumn({ name: 'SELECT' })} />);

      const input = screen.getByTestId('column-name-col-1');
      fireEvent.blur(input);

      await waitFor(() => {
        expect(screen.getByTestId('column-name-error-col-1')).toBeInTheDocument();
        expect(screen.getByText(/reserved word/i)).toBeInTheDocument();
      });
    });

    it('clears error when typing after error shown', async () => {
      const onChange = vi.fn();
      render(<ColumnRow {...defaultProps} onChange={onChange} column={createColumn({ name: '' })} />);

      const input = screen.getByTestId('column-name-col-1');
      fireEvent.blur(input);

      await waitFor(() => {
        expect(screen.getByTestId('column-name-error-col-1')).toBeInTheDocument();
      });

      fireEvent.change(input, { target: { value: 'valid_name' } });

      await waitFor(() => {
        expect(screen.queryByTestId('column-name-error-col-1')).not.toBeInTheDocument();
      });
    });

    it('shows error for duplicate column name', async () => {
      render(
        <ColumnRow
          {...defaultProps}
          column={createColumn({ name: 'duplicate' })}
          existingColumnNames={['duplicate', 'other']}
        />
      );

      const input = screen.getByTestId('column-name-col-1');
      fireEvent.blur(input);

      await waitFor(() => {
        expect(screen.getByTestId('column-name-error-col-1')).toBeInTheDocument();
        expect(screen.getByText(/already exists/i)).toBeInTheDocument();
      });
    });
  });

  describe('Type Dropdown', () => {
    it('renders type input with value', () => {
      render(<ColumnRow {...defaultProps} column={createColumn({ type: 'INTEGER' })} />);
      const input = screen.getByTestId('column-type-col-1');
      expect(input).toHaveValue('INTEGER');
    });

    it('updates state on type change', () => {
      const onChange = vi.fn();
      render(<ColumnRow {...defaultProps} onChange={onChange} />);

      const input = screen.getByTestId('column-type-col-1');
      fireEvent.change(input, { target: { value: 'REAL' } });

      expect(onChange).toHaveBeenCalledWith('col-1', { type: 'REAL' });
    });
  });

  describe('Constraint Toggles', () => {
    it('toggles primary key', () => {
      const onChange = vi.fn();
      render(<ColumnRow {...defaultProps} onChange={onChange} />);

      const pkButton = screen.getByTestId('column-pk-col-1');
      fireEvent.click(pkButton);

      expect(onChange).toHaveBeenCalledWith('col-1', { isPrimaryKey: true, isNotNull: true });
    });

    it('auto-sets NOT NULL when PK is enabled', () => {
      const onChange = vi.fn();
      render(<ColumnRow {...defaultProps} onChange={onChange} column={createColumn({ isNotNull: false })} />);

      const pkButton = screen.getByTestId('column-pk-col-1');
      fireEvent.click(pkButton);

      expect(onChange).toHaveBeenCalledWith('col-1', { isPrimaryKey: true, isNotNull: true });
    });

    it('does not disable NOT NULL if PK is enabled and NOT NULL already set', () => {
      const onChange = vi.fn();
      render(<ColumnRow {...defaultProps} onChange={onChange} column={createColumn({ isPrimaryKey: true, isNotNull: true })} />);

      const nnButton = screen.getByTestId('column-nn-col-1');
      fireEvent.click(nnButton);

      // Should not call onChange because PK requires NOT NULL
      expect(onChange).not.toHaveBeenCalled();
    });

    it('toggles NOT NULL when PK is not set', () => {
      const onChange = vi.fn();
      render(<ColumnRow {...defaultProps} onChange={onChange} />);

      const nnButton = screen.getByTestId('column-nn-col-1');
      fireEvent.click(nnButton);

      expect(onChange).toHaveBeenCalledWith('col-1', { isNotNull: true });
    });

    it('toggles unique', () => {
      const onChange = vi.fn();
      render(<ColumnRow {...defaultProps} onChange={onChange} />);

      const uqButton = screen.getByTestId('column-uq-col-1');
      fireEvent.click(uqButton);

      expect(onChange).toHaveBeenCalledWith('col-1', { isUnique: true });
    });

    it('shows active state for enabled constraints', () => {
      render(
        <ColumnRow
          {...defaultProps}
          column={createColumn({ isPrimaryKey: true, isNotNull: true, isUnique: true })}
        />
      );

      expect(screen.getByTestId('column-pk-col-1')).toHaveClass('bg-yellow-100');
      expect(screen.getByTestId('column-nn-col-1')).toHaveClass('bg-blue-100');
      expect(screen.getByTestId('column-uq-col-1')).toHaveClass('bg-purple-100');
    });
  });

  describe('Generated Column', () => {
    it('shows STORED badge for stored generated column', () => {
      render(<ColumnRow {...defaultProps} column={createColumn({ generated: 'stored' })} />);

      const badge = screen.getByTestId('column-generated-col-1');
      expect(badge).toHaveTextContent('STORED');
      expect(badge).toHaveClass('bg-green-100');
    });

    it('shows VIRTUAL badge for virtual generated column', () => {
      render(<ColumnRow {...defaultProps} column={createColumn({ generated: 'virtual' })} />);

      const badge = screen.getByTestId('column-generated-col-1');
      expect(badge).toHaveTextContent('VIRTUAL');
      expect(badge).toHaveClass('bg-cyan-100');
    });

    it('disables all inputs for generated columns', () => {
      render(<ColumnRow {...defaultProps} column={createColumn({ generated: 'stored' })} />);

      expect(screen.getByTestId('column-name-col-1')).toBeDisabled();
      expect(screen.getByTestId('column-type-col-1')).toBeDisabled();
      expect(screen.getByTestId('column-pk-col-1')).toBeDisabled();
      expect(screen.getByTestId('column-nn-col-1')).toBeDisabled();
      expect(screen.getByTestId('column-uq-col-1')).toBeDisabled();
    });

    it('does not show default input for generated columns', () => {
      render(<ColumnRow {...defaultProps} column={createColumn({ generated: 'stored' })} />);

      expect(screen.queryByTestId('column-default-col-1')).not.toBeInTheDocument();
    });

    it('shows expression in tooltip when provided', () => {
      render(
        <ColumnRow
          {...defaultProps}
          column={createColumn({ generated: 'stored', generatedExpression: 'first_name || last_name' })}
        />
      );

      const badge = screen.getByTestId('column-generated-col-1');
      expect(badge).toHaveAttribute('title', 'AS (first_name || last_name)');
    });

    it('allows delete for generated columns', () => {
      const onDelete = vi.fn();
      render(
        <ColumnRow
          {...defaultProps}
          onDelete={onDelete}
          column={createColumn({ generated: 'stored', isExisting: false })}
        />
      );

      const deleteButton = screen.getByTestId('column-delete-col-1');
      expect(deleteButton).not.toBeDisabled();
      fireEvent.click(deleteButton);

      expect(onDelete).toHaveBeenCalledWith('col-1');
    });
  });

  describe('Delete Column', () => {
    it('calls onDelete directly for new columns', () => {
      const onDelete = vi.fn();
      render(<ColumnRow {...defaultProps} onDelete={onDelete} />);

      const deleteButton = screen.getByTestId('column-delete-col-1');
      fireEvent.click(deleteButton);

      expect(onDelete).toHaveBeenCalledWith('col-1');
    });

    it('shows confirmation for existing columns', () => {
      const onToggleDeleteConfirm = vi.fn();
      render(
        <ColumnRow
          {...defaultProps}
          onToggleDeleteConfirm={onToggleDeleteConfirm}
          column={createColumn({ isExisting: true })}
        />
      );

      const deleteButton = screen.getByTestId('column-delete-col-1');
      fireEvent.click(deleteButton);

      expect(onToggleDeleteConfirm).toHaveBeenCalledWith('col-1', true);
    });

    it('renders confirmation UI when showDeleteConfirm is true', () => {
      render(<ColumnRow {...defaultProps} showDeleteConfirm={true} column={createColumn({ isExisting: true })} />);

      expect(screen.getByTestId('column-delete-confirm-col-1')).toBeInTheDocument();
      expect(screen.getByTestId('column-confirm-delete-col-1')).toBeInTheDocument();
      expect(screen.getByTestId('column-cancel-delete-col-1')).toBeInTheDocument();
    });

    it('calls onDelete on confirm', () => {
      const onDelete = vi.fn();
      render(
        <ColumnRow
          {...defaultProps}
          onDelete={onDelete}
          showDeleteConfirm={true}
          column={createColumn({ isExisting: true })}
        />
      );

      fireEvent.click(screen.getByTestId('column-confirm-delete-col-1'));
      expect(onDelete).toHaveBeenCalledWith('col-1');
    });

    it('calls onToggleDeleteConfirm on cancel', () => {
      const onToggleDeleteConfirm = vi.fn();
      render(
        <ColumnRow
          {...defaultProps}
          onToggleDeleteConfirm={onToggleDeleteConfirm}
          showDeleteConfirm={true}
          column={createColumn({ isExisting: true })}
        />
      );

      fireEvent.click(screen.getByTestId('column-cancel-delete-col-1'));
      expect(onToggleDeleteConfirm).toHaveBeenCalledWith('col-1', false);
    });
  });

  describe('Drag Handle', () => {
    it('renders drag handle', () => {
      render(<ColumnRow {...defaultProps} />);
      expect(screen.getByTestId('column-drag-col-1')).toBeInTheDocument();
    });

    it('disables drag handle for generated columns', () => {
      render(<ColumnRow {...defaultProps} column={createColumn({ generated: 'stored' })} />);
      expect(screen.getByTestId('column-drag-col-1')).toBeDisabled();
    });

    it('disables drag handle in disabled mode', () => {
      render(<ColumnRow {...defaultProps} disabled={true} />);
      expect(screen.getByTestId('column-drag-col-1')).toBeDisabled();
    });

    it('shows dragging state', () => {
      render(<ColumnRow {...defaultProps} isDragging={true} />);
      const row = screen.getByTestId('column-row-col-1');
      expect(row).toHaveClass('opacity-50');
    });

    it('shows drop target state', () => {
      render(<ColumnRow {...defaultProps} isDropTarget={true} />);
      const row = screen.getByTestId('column-row-col-1');
      expect(row).toHaveClass('ring-2');
      expect(row).toHaveClass('ring-blue-400');
    });
  });

  describe('Disabled State', () => {
    it('disables all inputs when disabled', () => {
      render(<ColumnRow {...defaultProps} disabled={true} />);

      expect(screen.getByTestId('column-name-col-1')).toBeDisabled();
      expect(screen.getByTestId('column-type-col-1')).toBeDisabled();
      expect(screen.getByTestId('column-default-col-1')).toBeDisabled();
      expect(screen.getByTestId('column-pk-col-1')).toBeDisabled();
      expect(screen.getByTestId('column-nn-col-1')).toBeDisabled();
      expect(screen.getByTestId('column-uq-col-1')).toBeDisabled();
      expect(screen.getByTestId('column-delete-col-1')).toBeDisabled();
    });

    it('applies disabled styling', () => {
      render(<ColumnRow {...defaultProps} disabled={true} />);

      const row = screen.getByTestId('column-row-col-1');
      expect(row).toHaveClass('opacity-60');
    });
  });

  describe('Default Value', () => {
    it('renders default input with value', () => {
      render(<ColumnRow {...defaultProps} column={createColumn({ defaultValue: '42' })} />);
      const input = screen.getByTestId('column-default-col-1');
      expect(input).toHaveValue('42');
    });

    it('updates state on default value change', () => {
      const onChange = vi.fn();
      render(<ColumnRow {...defaultProps} onChange={onChange} />);

      const input = screen.getByTestId('column-default-col-1');
      fireEvent.change(input, { target: { value: 'default_val' } });

      expect(onChange).toHaveBeenCalledWith('col-1', { defaultValue: 'default_val' });
    });

    it('sets defaultValue to null when cleared', () => {
      const onChange = vi.fn();
      render(<ColumnRow {...defaultProps} onChange={onChange} column={createColumn({ defaultValue: '42' })} />);

      const input = screen.getByTestId('column-default-col-1');
      fireEvent.change(input, { target: { value: '' } });

      expect(onChange).toHaveBeenCalledWith('col-1', { defaultValue: null });
    });
  });

  describe('Index Display', () => {
    it('displays column index', () => {
      render(<ColumnRow {...defaultProps} index={5} />);
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  describe('Auto-focus on new', () => {
    it('focuses name input when isNew is true', () => {
      render(<ColumnRow {...defaultProps} isNew={true} />);

      const input = screen.getByTestId('column-name-col-1');
      expect(document.activeElement).toBe(input);
    });
  });
});
