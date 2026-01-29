import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportDialog, type ImportDialogProps } from '../ImportDialog';

// Mock the CSV and JSON parsers
vi.mock('../../../lib/csv', () => ({
  parseCSVFile: vi.fn(),
}));

vi.mock('../../../lib/json', () => ({
  parseJSONFile: vi.fn(),
}));

import { parseCSVFile } from '../../../lib/csv';
import { parseJSONFile } from '../../../lib/json';

const mockParseCSVFile = parseCSVFile as ReturnType<typeof vi.fn>;
const mockParseJSONFile = parseJSONFile as ReturnType<typeof vi.fn>;

// Create mock File
function createMockFile(name: string, content: string, type = 'text/plain'): File {
  const blob = new Blob([content], { type });
  return new File([blob], name, { type });
}

const defaultProps: ImportDialogProps = {
  isOpen: true,
  onClose: vi.fn(),
  onImport: vi.fn(),
  existingTables: ['users', 'products', 'orders'],
  isReadOnly: false,
};

function renderDialog(props: Partial<ImportDialogProps> = {}) {
  return render(<ImportDialog {...defaultProps} {...props} />);
}

describe('ImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    mockParseCSVFile.mockResolvedValue({
      columns: [
        { name: 'id', type: 'INTEGER', originalName: 'id' },
        { name: 'name', type: 'TEXT', originalName: 'name' },
      ],
      rows: [
        [1, 'Alice'],
        [2, 'Bob'],
      ],
      hasHeader: true,
    });
    mockParseJSONFile.mockResolvedValue({
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
      ],
      rows: [
        [1, 'Alice'],
        [2, 'Bob'],
      ],
      isValid: true,
    });
  });

  describe('rendering', () => {
    it('renders when isOpen is true', () => {
      renderDialog();
      expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
      renderDialog({ isOpen: false });
      expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument();
    });

    it('does not render when isReadOnly is true', () => {
      renderDialog({ isReadOnly: true });
      expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument();
    });

    it('renders file drop zone in initial state', () => {
      renderDialog();
      expect(screen.getByTestId('file-drop-zone')).toBeInTheDocument();
      expect(screen.getByText(/Click to browse or drag and drop/)).toBeInTheDocument();
    });

    it('has correct dialog title', () => {
      renderDialog();
      expect(screen.getByText('Import Data')).toBeInTheDocument();
    });
  });

  describe('file picker', () => {
    it('triggers file selection on drop zone click', async () => {
      const user = userEvent.setup();
      renderDialog();

      const dropZone = screen.getByTestId('file-drop-zone');
      const fileInput = screen.getByTestId('file-input') as HTMLInputElement;

      // Mock the click method
      const clickSpy = vi.spyOn(fileInput, 'click');

      await user.click(dropZone);

      expect(clickSpy).toHaveBeenCalled();
    });

    it('accepts .csv, .tsv, and .json files', () => {
      renderDialog();

      const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
      expect(fileInput.accept).toBe('.csv,.tsv,.json');
    });
  });

  describe('format detection', () => {
    it('detects CSV format from .csv extension', async () => {
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      await waitFor(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(mockParseCSVFile).toHaveBeenCalledWith(file);
      });
    });

    it('detects JSON format from .json extension', async () => {
      renderDialog();

      const file = createMockFile('data.json', '[{"id": 1, "name": "Alice"}]');
      const fileInput = screen.getByTestId('file-input');

      await waitFor(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(mockParseJSONFile).toHaveBeenCalledWith(file);
      });
    });

    it('shows format selector after file is parsed', async () => {
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('format-csv')).toBeInTheDocument();
        expect(screen.getByTestId('format-json')).toBeInTheDocument();
      });
    });
  });

  describe('format override', () => {
    it('allows changing format from CSV to JSON', async () => {
      const user = userEvent.setup();
      renderDialog();

      const file = createMockFile('data.csv', '[{"id": 1}]');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('format-json')).toBeInTheDocument();
      });

      mockParseCSVFile.mockClear();

      await user.click(screen.getByTestId('format-json'));

      await waitFor(() => {
        expect(mockParseJSONFile).toHaveBeenCalledWith(file);
      });
    });
  });

  describe('target selector', () => {
    it('shows target selector with New Table and Append options', async () => {
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('target-new')).toBeInTheDocument();
        expect(screen.getByTestId('target-append')).toBeInTheDocument();
      });
    });

    it('defaults to New Table option', async () => {
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('target-new')).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('shows existing tables when Append is selected', async () => {
      const user = userEvent.setup();
      renderDialog({ existingTables: ['users', 'products'] });

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('target-append')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('target-append'));

      await waitFor(() => {
        expect(screen.getByTestId('table-name-select')).toBeInTheDocument();
      });

      const select = screen.getByTestId('table-name-select') as HTMLSelectElement;
      expect(select.options.length).toBe(2);
    });

    it('disables Append option when no existing tables', async () => {
      renderDialog({ existingTables: [] });

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        const appendButton = screen.getByTestId('target-append');
        expect(appendButton).toBeDisabled();
      });
    });
  });

  describe('table name input', () => {
    it('shows table name input in New Table mode', async () => {
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('table-name-input')).toBeInTheDocument();
      });
    });

    it('generates default table name from filename', async () => {
      renderDialog();

      const file = createMockFile('my_data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        const input = screen.getByTestId('table-name-input') as HTMLInputElement;
        expect(input.value).toBe('my_data');
      });
    });

    it('shows error for invalid table name', async () => {
      const user = userEvent.setup();
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('table-name-input')).toBeInTheDocument();
      });

      const input = screen.getByTestId('table-name-input');
      await user.clear(input);
      await user.type(input, '123invalid');

      await waitFor(() => {
        expect(screen.getByTestId('table-name-error')).toBeInTheDocument();
      });
    });

    it('shows error for duplicate table name in New Table mode', async () => {
      const user = userEvent.setup();
      renderDialog({ existingTables: ['users'] });

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('table-name-input')).toBeInTheDocument();
      });

      const input = screen.getByTestId('table-name-input');
      await user.clear(input);
      await user.type(input, 'users');

      await waitFor(() => {
        expect(screen.getByTestId('table-name-error')).toHaveTextContent(/already exists/);
      });
    });
  });

  describe('read-only mode', () => {
    it('dialog cannot be opened when isReadOnly is true', () => {
      renderDialog({ isReadOnly: true, isOpen: true });
      expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument();
    });

    it('dialog is disabled in read-only mode', () => {
      renderDialog({ isReadOnly: true });
      expect(screen.queryByTestId('import-dialog-backdrop')).not.toBeInTheDocument();
    });
  });

  describe('data preview', () => {
    it('shows preview table after parsing', async () => {
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice\n2,Bob');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('preview-table')).toBeInTheDocument();
      });
    });

    it('shows column headers with types', async () => {
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        // Column names shown
        expect(screen.getByTestId('column-name-0')).toHaveTextContent('id');
        expect(screen.getByTestId('column-name-1')).toHaveTextContent('name');
        // Types shown in dropdowns
        expect(screen.getByTestId('type-dropdown-0')).toHaveValue('INTEGER');
        expect(screen.getByTestId('type-dropdown-1')).toHaveValue('TEXT');
      });
    });

    it('shows row count in preview header', async () => {
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice\n2,Bob');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/Previewing 2 of 2 rows/)).toBeInTheDocument();
      });
    });

    it('displays NULL values with special styling', async () => {
      mockParseCSVFile.mockResolvedValue({
        columns: [{ name: 'id', type: 'INTEGER', originalName: 'id' }],
        rows: [[null]],
        hasHeader: true,
      });

      renderDialog();

      const file = createMockFile('data.csv', 'id\n');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('NULL')).toBeInTheDocument();
      });
    });
  });

  describe('dialog controls', () => {
    it('calls onClose when Cancel button clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderDialog({ onClose });

      await user.click(screen.getByTestId('cancel-button'));

      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when close button (X) clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderDialog({ onClose });

      await user.click(screen.getByTestId('close-button'));

      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when backdrop clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderDialog({ onClose });

      await user.click(screen.getByTestId('import-dialog-backdrop'));

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('import action', () => {
    it('shows import button with row count in preview state', async () => {
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice\n2,Bob');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('import-button')).toBeInTheDocument();
        expect(screen.getByTestId('import-button')).toHaveTextContent(/Import 2 Rows/);
      });
    });

    it('disables import button when table name is empty', async () => {
      const user = userEvent.setup();
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('table-name-input')).toBeInTheDocument();
      });

      const input = screen.getByTestId('table-name-input');
      await user.clear(input);

      await waitFor(() => {
        expect(screen.getByTestId('import-button')).toBeDisabled();
      });
    });

    it('calls onImport with correct options when import clicked', async () => {
      const user = userEvent.setup();
      const onImport = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();
      renderDialog({ onImport, onClose });

      const file = createMockFile('data.csv', 'id,name\n1,Alice\n2,Bob');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('import-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('import-button'));

      await waitFor(() => {
        expect(onImport).toHaveBeenCalledWith(
          expect.objectContaining({
            tableName: 'data',
            appendToExisting: false,
            columns: expect.arrayContaining([
              expect.objectContaining({ name: 'id' }),
              expect.objectContaining({ name: 'name' }),
            ]),
            rows: expect.arrayContaining([
              [1, 'Alice'],
              [2, 'Bob'],
            ]),
          })
        );
      });

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe('error handling', () => {
    it('shows error state when parsing fails', async () => {
      mockParseCSVFile.mockRejectedValue(new Error('Invalid CSV format'));
      renderDialog();

      const file = createMockFile('data.csv', 'invalid');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument();
        expect(screen.getByText(/Invalid CSV format/)).toBeInTheDocument();
      });
    });

    it('shows try again button in error state', async () => {
      mockParseCSVFile.mockRejectedValue(new Error('Parse error'));
      renderDialog();

      const file = createMockFile('data.csv', 'invalid');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('try-again-button')).toBeInTheDocument();
      });
    });

    it('returns to initial state when try again clicked', async () => {
      const user = userEvent.setup();
      mockParseCSVFile.mockRejectedValue(new Error('Parse error'));
      renderDialog();

      const file = createMockFile('data.csv', 'invalid');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('try-again-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('try-again-button'));

      await waitFor(() => {
        expect(screen.getByTestId('file-drop-zone')).toBeInTheDocument();
      });
    });

    it('shows error for invalid JSON', async () => {
      mockParseJSONFile.mockResolvedValue({
        columns: [],
        rows: [],
        isValid: false,
        error: 'JSON root must be an array',
      });

      renderDialog();

      const file = createMockFile('data.json', '{"not": "an array"}');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument();
        expect(screen.getByText(/JSON root must be an array/)).toBeInTheDocument();
      });
    });
  });

  describe('accessibility', () => {
    it('has proper dialog role and aria attributes', () => {
      renderDialog();

      const backdrop = screen.getByTestId('import-dialog-backdrop');
      expect(backdrop).toHaveAttribute('role', 'dialog');
      expect(backdrop).toHaveAttribute('aria-modal', 'true');
      expect(backdrop).toHaveAttribute('aria-labelledby', 'import-dialog-title');
    });

    it('close button has aria-label', () => {
      renderDialog();
      expect(screen.getByTestId('close-button')).toHaveAttribute('aria-label', 'Close dialog');
    });

    it('table name input has aria-invalid when error', async () => {
      const user = userEvent.setup();
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('table-name-input')).toBeInTheDocument();
      });

      const input = screen.getByTestId('table-name-input');
      await user.clear(input);
      await user.type(input, '123invalid');

      await waitFor(() => {
        expect(input).toHaveAttribute('aria-invalid', 'true');
      });
    });

    it('error message has alert role', async () => {
      mockParseCSVFile.mockRejectedValue(new Error('Parse error'));
      renderDialog();

      const file = createMockFile('data.csv', 'invalid');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toHaveAttribute('role', 'alert');
      });
    });
  });

  describe('drag and drop', () => {
    it('handles file drop', async () => {
      renderDialog();

      const dropZone = screen.getByTestId('file-drop-zone');
      const file = createMockFile('data.csv', 'id,name\n1,Alice');

      const dataTransfer = {
        files: [file],
      };

      fireEvent.drop(dropZone, { dataTransfer });

      await waitFor(() => {
        expect(mockParseCSVFile).toHaveBeenCalledWith(file);
      });
    });
  });

  describe('change file', () => {
    it('shows change file button in preview state', async () => {
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('change-file-button')).toBeInTheDocument();
      });
    });

    it('returns to initial state when change file clicked', async () => {
      const user = userEvent.setup();
      renderDialog();

      const file = createMockFile('data.csv', 'id,name\n1,Alice');
      const fileInput = screen.getByTestId('file-input');

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('change-file-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('change-file-button'));

      await waitFor(() => {
        expect(screen.getByTestId('file-drop-zone')).toBeInTheDocument();
      });
    });
  });
});
