import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TableDesigner, validateTableName, SQLITE_RESERVED_WORDS } from '../TableDesigner';
import type { TableInfo } from '../../../types';

// =============================================================================
// validateTableName Tests
// =============================================================================

describe('validateTableName', () => {
  describe('empty validation', () => {
    it('rejects empty name', () => {
      expect(validateTableName('')).toEqual({
        valid: false,
        error: 'Table name is required',
      });
    });

    it('rejects whitespace-only name', () => {
      expect(validateTableName('   ')).toEqual({
        valid: false,
        error: 'Table name is required',
      });
    });
  });

  describe('space validation', () => {
    it('rejects name with spaces', () => {
      const result = validateTableName('my table');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('spaces');
    });

    it('rejects name with tab', () => {
      const result = validateTableName('my\ttable');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('spaces');
    });
  });

  describe('reserved word validation', () => {
    it('rejects SQLite reserved words', () => {
      const result = validateTableName('SELECT');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reserved word');
    });

    it('rejects reserved words case-insensitively', () => {
      expect(validateTableName('select').valid).toBe(false);
      expect(validateTableName('Select').valid).toBe(false);
      expect(validateTableName('TABLE').valid).toBe(false);
    });

    it('has comprehensive reserved word list', () => {
      expect(SQLITE_RESERVED_WORDS.has('SELECT')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('FROM')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('WHERE')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('INSERT')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('UPDATE')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('DELETE')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('CREATE')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('DROP')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('TABLE')).toBe(true);
      expect(SQLITE_RESERVED_WORDS.has('INDEX')).toBe(true);
    });
  });

  describe('character validation', () => {
    it('rejects name starting with number', () => {
      const result = validateTableName('123table');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must start with');
    });

    it('rejects name with special characters', () => {
      expect(validateTableName('my-table').valid).toBe(false);
      expect(validateTableName('my.table').valid).toBe(false);
      expect(validateTableName('my@table').valid).toBe(false);
    });

    it('accepts underscore at start', () => {
      expect(validateTableName('_my_table')).toEqual({ valid: true });
    });
  });

  describe('uniqueness validation', () => {
    const existingNames = ['users', 'Products', 'ORDERS'];

    it('rejects duplicate name', () => {
      expect(validateTableName('users', existingNames)).toEqual({
        valid: false,
        error: 'A table with this name already exists',
      });
    });

    it('rejects duplicate name case-insensitively', () => {
      expect(validateTableName('USERS', existingNames).valid).toBe(false);
      expect(validateTableName('products', existingNames).valid).toBe(false);
      expect(validateTableName('Orders', existingNames).valid).toBe(false);
    });

    it('skips uniqueness check when editing with same name', () => {
      // When editing 'users' table, 'users' should be valid
      const result = validateTableName('users', existingNames, true, 'users');
      expect(result.valid).toBe(true);
    });

    it('checks uniqueness when editing with different name', () => {
      // When editing 'users' table, 'products' should be invalid
      const result = validateTableName('products', existingNames, true, 'users');
      expect(result.valid).toBe(false);
    });
  });

  describe('valid names', () => {
    it('accepts simple valid name', () => {
      expect(validateTableName('users')).toEqual({ valid: true });
    });

    it('accepts name with underscores', () => {
      expect(validateTableName('user_accounts')).toEqual({ valid: true });
    });

    it('accepts name with numbers (not at start)', () => {
      expect(validateTableName('users2')).toEqual({ valid: true });
    });

    it('accepts mixed case', () => {
      expect(validateTableName('UserAccounts')).toEqual({ valid: true });
    });
  });
});

// =============================================================================
// TableDesigner Component Tests
// =============================================================================

describe('TableDesigner', () => {
  const defaultProps = {
    isReadOnly: false,
    existingTable: null,
    existingTableNames: [],
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onDirtyChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Create Mode Rendering', () => {
    it('renders empty form in create mode', () => {
      render(<TableDesigner {...defaultProps} />);

      expect(screen.getByTestId('table-designer')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Create Table' })).toBeInTheDocument();
      expect(screen.getByTestId('table-name-input')).toHaveValue('');
      expect(screen.getByTestId('submit-button')).toHaveTextContent('Create Table');
    });

    it('starts with one empty column', () => {
      render(<TableDesigner {...defaultProps} />);

      const columnList = screen.getByTestId('column-list');
      expect(columnList.children).toHaveLength(1);
    });

    it('has add column button', () => {
      render(<TableDesigner {...defaultProps} />);

      expect(screen.getByTestId('add-column-button')).toBeInTheDocument();
    });
  });

  describe('Edit Mode Rendering', () => {
    const existingTable: TableInfo = {
      name: 'users',
      isView: false,
      isVirtual: false,
      withoutRowid: false,
      columns: [
        { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
        { cid: 1, name: 'name', type: 'TEXT', notnull: false, dfltValue: null, pk: 0, generated: null, hidden: false },
        { cid: 2, name: 'email', type: 'VARCHAR(255)', notnull: true, dfltValue: null, pk: 0, generated: null, hidden: false },
      ],
      indexes: [],
      createSql: 'CREATE TABLE users (...)',
    };

    it('renders populated form in edit mode', () => {
      render(<TableDesigner {...defaultProps} existingTable={existingTable} />);

      expect(screen.getByText('Edit Table')).toBeInTheDocument();
      expect(screen.getByTestId('table-name-input')).toHaveValue('users');
      expect(screen.getByTestId('submit-button')).toHaveTextContent('Save Changes');
    });

    it('loads existing columns', () => {
      render(<TableDesigner {...defaultProps} existingTable={existingTable} />);

      const columnList = screen.getByTestId('column-list');
      expect(columnList.children).toHaveLength(3);
    });

    it('populates column values correctly', () => {
      render(<TableDesigner {...defaultProps} existingTable={existingTable} />);

      // Find the name inputs by their displayed values
      const inputs = screen.getAllByRole('textbox');
      const columnNames = inputs
        .filter((input) => input.getAttribute('placeholder') === 'Column name')
        .map((input) => (input as HTMLInputElement).value);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('email');
    });
  });

  describe('Add Column', () => {
    it('new row appears when add column is clicked', () => {
      render(<TableDesigner {...defaultProps} />);

      const addButton = screen.getByTestId('add-column-button');
      const columnList = screen.getByTestId('column-list');

      expect(columnList.children).toHaveLength(1);

      fireEvent.click(addButton);

      expect(columnList.children).toHaveLength(2);
    });

    it('new column is added at end', () => {
      render(<TableDesigner {...defaultProps} />);

      // Set first column name
      const firstNameInput = screen.getByPlaceholderText('Column name');
      fireEvent.change(firstNameInput, { target: { value: 'first_col' } });

      // Add new column
      fireEvent.click(screen.getByTestId('add-column-button'));

      // Get all column name inputs
      const nameInputs = screen.getAllByPlaceholderText('Column name');
      expect(nameInputs).toHaveLength(2);
      expect((nameInputs[0] as HTMLInputElement).value).toBe('first_col');
      expect((nameInputs[1] as HTMLInputElement).value).toBe('');
    });
  });

  describe('Remove Column', () => {
    it('row removed when delete is clicked (new column)', () => {
      render(<TableDesigner {...defaultProps} />);

      // Add second column
      fireEvent.click(screen.getByTestId('add-column-button'));
      const columnList = screen.getByTestId('column-list');
      expect(columnList.children).toHaveLength(2);

      // Delete first column (new columns delete immediately)
      const deleteButtons = screen.getAllByTitle('Remove column');
      fireEvent.click(deleteButtons[0]);

      expect(columnList.children).toHaveLength(1);
    });

    it('shows confirmation for existing columns', () => {
      const existingTable: TableInfo = {
        name: 'users',
        isView: false,
        isVirtual: false,
        withoutRowid: false,
        columns: [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
        ],
        indexes: [],
        createSql: 'CREATE TABLE users (...)',
      };

      render(<TableDesigner {...defaultProps} existingTable={existingTable} />);

      const deleteButton = screen.getByTitle('Remove column');
      fireEvent.click(deleteButton);

      // Should show confirmation within the column row
      const columnRow = screen.getByTestId('column-list').children[0];
      expect(columnRow.querySelector('[data-testid^="column-delete-confirm-"]')).toBeInTheDocument();
    });

    it('row removed with confirmation when confirmed', () => {
      const existingTable: TableInfo = {
        name: 'users',
        isView: false,
        isVirtual: false,
        withoutRowid: false,
        columns: [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
          { cid: 1, name: 'name', type: 'TEXT', notnull: false, dfltValue: null, pk: 0, generated: null, hidden: false },
        ],
        indexes: [],
        createSql: 'CREATE TABLE users (...)',
      };

      render(<TableDesigner {...defaultProps} existingTable={existingTable} />);

      const columnList = screen.getByTestId('column-list');
      expect(columnList.children).toHaveLength(2);

      // Click delete on first column
      const deleteButtons = screen.getAllByTitle('Remove column');
      fireEvent.click(deleteButtons[0]);

      // Confirm deletion
      const confirmButton = screen.getByText('Delete');
      fireEvent.click(confirmButton);

      expect(columnList.children).toHaveLength(1);
    });

    it('cancelling confirmation keeps the column', () => {
      const existingTable: TableInfo = {
        name: 'users',
        isView: false,
        isVirtual: false,
        withoutRowid: false,
        columns: [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
        ],
        indexes: [],
        createSql: 'CREATE TABLE users (...)',
      };

      render(<TableDesigner {...defaultProps} existingTable={existingTable} />);

      const columnList = screen.getByTestId('column-list');

      // Click delete
      const deleteButton = screen.getByTitle('Remove column');
      fireEvent.click(deleteButton);

      // Cancel - use the specific button within the column row
      const columnRow = columnList.children[0];
      const cancelButton = columnRow.querySelector('[data-testid^="column-cancel-delete-"]');
      fireEvent.click(cancelButton!);

      expect(columnList.children).toHaveLength(1);
    });
  });

  describe('Invalid Table Name', () => {
    it('shows error for invalid table name', async () => {
      render(<TableDesigner {...defaultProps} />);

      const input = screen.getByTestId('table-name-input');
      fireEvent.change(input, { target: { value: 'my table' } });

      await waitFor(() => {
        expect(screen.getByTestId('table-name-error')).toBeInTheDocument();
        expect(screen.getByText(/cannot contain spaces/i)).toBeInTheDocument();
      });
    });

    it('shows error for reserved word', async () => {
      render(<TableDesigner {...defaultProps} />);

      const input = screen.getByTestId('table-name-input');
      fireEvent.change(input, { target: { value: 'SELECT' } });

      await waitFor(() => {
        expect(screen.getByTestId('table-name-error')).toBeInTheDocument();
        expect(screen.getByText(/reserved word/i)).toBeInTheDocument();
      });
    });

    it('submit button is disabled with invalid name', async () => {
      render(<TableDesigner {...defaultProps} />);

      const input = screen.getByTestId('table-name-input');
      fireEvent.change(input, { target: { value: 'SELECT' } });

      await waitFor(() => {
        expect(screen.getByTestId('submit-button')).toBeDisabled();
      });
    });
  });

  describe('Read-only Mode', () => {
    it('all inputs disabled in read-only mode', () => {
      render(<TableDesigner {...defaultProps} isReadOnly={true} />);

      expect(screen.getByTestId('table-name-input')).toBeDisabled();
      expect(screen.getByTestId('add-column-button')).toBeDisabled();
      expect(screen.getByTestId('submit-button')).toBeDisabled();
    });

    it('shows read-only notice', () => {
      render(<TableDesigner {...defaultProps} isReadOnly={true} />);

      expect(screen.getByTestId('readonly-notice')).toBeInTheDocument();
      expect(screen.getByText(/read-only mode/i)).toBeInTheDocument();
    });

    it('column inputs are disabled', () => {
      render(<TableDesigner {...defaultProps} isReadOnly={true} />);

      const columnNameInput = screen.getByPlaceholderText('Column name');
      expect(columnNameInput).toBeDisabled();
    });
  });

  describe('Dirty State', () => {
    it('tracks unsaved changes when table name changes', async () => {
      const onDirtyChange = vi.fn();
      render(<TableDesigner {...defaultProps} onDirtyChange={onDirtyChange} />);

      const input = screen.getByTestId('table-name-input');
      fireEvent.change(input, { target: { value: 'users' } });

      await waitFor(() => {
        expect(onDirtyChange).toHaveBeenCalledWith(true);
      });
    });

    it('tracks unsaved changes when column is modified', async () => {
      const onDirtyChange = vi.fn();
      render(<TableDesigner {...defaultProps} onDirtyChange={onDirtyChange} />);

      const columnNameInput = screen.getByPlaceholderText('Column name');
      fireEvent.change(columnNameInput, { target: { value: 'id' } });

      await waitFor(() => {
        expect(onDirtyChange).toHaveBeenCalledWith(true);
      });
    });

    it('shows dirty indicator when changes exist', async () => {
      render(<TableDesigner {...defaultProps} />);

      const input = screen.getByTestId('table-name-input');
      fireEvent.change(input, { target: { value: 'users' } });

      await waitFor(() => {
        expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
      });
    });

    it('tracks dirty when column is added', async () => {
      const onDirtyChange = vi.fn();
      render(<TableDesigner {...defaultProps} onDirtyChange={onDirtyChange} />);

      fireEvent.click(screen.getByTestId('add-column-button'));

      await waitFor(() => {
        expect(onDirtyChange).toHaveBeenCalledWith(true);
      });
    });
  });

  describe('Form Submission', () => {
    it('calls onSubmit with table name and columns', async () => {
      const onSubmit = vi.fn();
      render(<TableDesigner {...defaultProps} onSubmit={onSubmit} />);

      // Set table name
      const nameInput = screen.getByTestId('table-name-input');
      fireEvent.change(nameInput, { target: { value: 'users' } });

      // Set column name
      const columnNameInput = screen.getByPlaceholderText('Column name');
      fireEvent.change(columnNameInput, { target: { value: 'id' } });

      // Wait for validation
      await waitFor(() => {
        expect(screen.getByTestId('submit-button')).not.toBeDisabled();
      });

      // Submit
      fireEvent.click(screen.getByTestId('submit-button'));

      expect(onSubmit).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({ name: 'id' }),
        ])
      );
    });

    it('does not submit when form is invalid', async () => {
      const onSubmit = vi.fn();
      render(<TableDesigner {...defaultProps} onSubmit={onSubmit} />);

      // Don't fill anything, just try to submit
      fireEvent.click(screen.getByTestId('submit-button'));

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('calls onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn();
      render(<TableDesigner {...defaultProps} onCancel={onCancel} />);

      fireEvent.click(screen.getByTestId('cancel-button'));

      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe('Column Constraints', () => {
    it('can toggle primary key', () => {
      render(<TableDesigner {...defaultProps} />);

      const columnRow = screen.getByTestId('column-list').children[0];
      const pkButton = columnRow.querySelector('[data-testid^="column-pk-"]');

      expect(pkButton).toHaveClass('bg-gray-50');

      fireEvent.click(pkButton!);

      expect(pkButton).toHaveClass('bg-yellow-100');
    });

    it('can toggle not null', () => {
      render(<TableDesigner {...defaultProps} />);

      const columnRow = screen.getByTestId('column-list').children[0];
      const nnButton = columnRow.querySelector('[data-testid^="column-nn-"]');

      fireEvent.click(nnButton!);

      expect(nnButton).toHaveClass('bg-blue-100');
    });

    it('can toggle unique', () => {
      render(<TableDesigner {...defaultProps} />);

      const columnRow = screen.getByTestId('column-list').children[0];
      const uqButton = columnRow.querySelector('[data-testid^="column-uq-"]');

      fireEvent.click(uqButton!);

      expect(uqButton).toHaveClass('bg-purple-100');
    });
  });

  describe('No Columns State', () => {
    it('shows message when all columns are deleted', () => {
      render(<TableDesigner {...defaultProps} />);

      // Delete the only column
      const deleteButton = screen.getByTitle('Remove column');
      fireEvent.click(deleteButton);

      expect(screen.getByTestId('no-columns-message')).toBeInTheDocument();
    });

    it('shows columns error when trying to submit with no columns', async () => {
      render(<TableDesigner {...defaultProps} />);

      // Set table name
      const nameInput = screen.getByTestId('table-name-input');
      fireEvent.change(nameInput, { target: { value: 'users' } });

      // Delete the only column
      const deleteButton = screen.getByTitle('Remove column');
      fireEvent.click(deleteButton);

      // Try to submit - button should be disabled
      await waitFor(() => {
        expect(screen.getByTestId('submit-button')).toBeDisabled();
      });
    });
  });

  describe('Duplicate Column Names', () => {
    it('prevents submission with duplicate column names', async () => {
      render(<TableDesigner {...defaultProps} />);

      // Set table name
      fireEvent.change(screen.getByTestId('table-name-input'), {
        target: { value: 'users' },
      });

      // Set first column name
      const firstNameInput = screen.getByPlaceholderText('Column name');
      fireEvent.change(firstNameInput, { target: { value: 'id' } });

      // Add second column
      fireEvent.click(screen.getByTestId('add-column-button'));

      // Set second column with same name
      const nameInputs = screen.getAllByPlaceholderText('Column name');
      fireEvent.change(nameInputs[1], { target: { value: 'id' } });

      // Submit button should be disabled
      await waitFor(() => {
        expect(screen.getByTestId('submit-button')).toBeDisabled();
      });
    });
  });
});
