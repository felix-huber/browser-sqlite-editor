/**
 * Tests for CellContextMenu component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  CellContextMenu,
  copyCellValue,
  parsePastedValue,
  generateBlobFilename,
  downloadBlob,
  type CellContextMenuProps,
} from '../CellContextMenu';
import type { CellValue } from '../useDataGrid';
import type { ColumnInfo } from '../../../types';

// =============================================================================
// Test Helpers
// =============================================================================

const mockColumn = (
  name: string,
  type: string,
  generated: 'stored' | 'virtual' | null = null
): ColumnInfo => ({
  cid: 0,
  name,
  type,
  notnull: false,
  dfltValue: null,
  pk: 0,
  generated,
  hidden: false,
});

const defaultProps: CellContextMenuProps = {
  x: 100,
  y: 100,
  onClose: vi.fn(),
  cellValue: 'test value' as CellValue,
  columnInfo: mockColumn('name', 'TEXT'),
  rowIndex: 0,
  isReadOnly: false,
  onCopy: vi.fn(),
  onPaste: vi.fn(),
  onSetNull: vi.fn(),
  onSaveBlob: vi.fn(),
  onDeleteRow: vi.fn(),
};

// =============================================================================
// Tests
// =============================================================================

describe('CellContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Menu Rendering', () => {
    it('renders all standard menu items', () => {
      render(<CellContextMenu {...defaultProps} />);

      expect(screen.getByTestId('cell-context-menu-item-copy')).toBeInTheDocument();
      expect(screen.getByTestId('cell-context-menu-item-paste')).toBeInTheDocument();
      expect(screen.getByTestId('cell-context-menu-item-set-null')).toBeInTheDocument();
      expect(screen.getByTestId('cell-context-menu-item-delete-row')).toBeInTheDocument();
    });

    it('renders Save BLOB item for BLOB columns with data', () => {
      render(
        <CellContextMenu
          {...defaultProps}
          columnInfo={mockColumn('data', 'BLOB')}
          cellValue={new Uint8Array([1, 2, 3])}
        />
      );

      expect(screen.getByTestId('cell-context-menu-item-save-blob')).toBeInTheDocument();
    });

    it('does not render Save BLOB item for non-BLOB columns', () => {
      render(<CellContextMenu {...defaultProps} />);

      expect(screen.queryByTestId('cell-context-menu-item-save-blob')).not.toBeInTheDocument();
    });

    it('does not render Save BLOB item for BLOB column with NULL value', () => {
      render(
        <CellContextMenu
          {...defaultProps}
          columnInfo={mockColumn('data', 'BLOB')}
          cellValue={null}
        />
      );

      expect(screen.queryByTestId('cell-context-menu-item-save-blob')).not.toBeInTheDocument();
    });
  });

  describe('Copy Action', () => {
    it('calls onCopy when Copy is clicked', () => {
      const onCopy = vi.fn();
      render(<CellContextMenu {...defaultProps} onCopy={onCopy} />);

      fireEvent.click(screen.getByTestId('cell-context-menu-item-copy'));

      expect(onCopy).toHaveBeenCalled();
    });

    it('Copy is always enabled even in read-only mode', () => {
      render(<CellContextMenu {...defaultProps} isReadOnly={true} />);

      const copyItem = screen.getByTestId('cell-context-menu-item-copy');
      expect(copyItem).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('Copy is enabled for generated columns', () => {
      render(
        <CellContextMenu
          {...defaultProps}
          columnInfo={mockColumn('full_name', 'TEXT', 'stored')}
        />
      );

      const copyItem = screen.getByTestId('cell-context-menu-item-copy');
      expect(copyItem).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('Paste Action', () => {
    it('calls onPaste when Paste is clicked', () => {
      const onPaste = vi.fn();
      render(<CellContextMenu {...defaultProps} onPaste={onPaste} />);

      fireEvent.click(screen.getByTestId('cell-context-menu-item-paste'));

      expect(onPaste).toHaveBeenCalled();
    });

    it('disables Paste in read-only mode', () => {
      render(<CellContextMenu {...defaultProps} isReadOnly={true} />);

      const pasteItem = screen.getByTestId('cell-context-menu-item-paste');
      expect(pasteItem).toHaveAttribute('aria-disabled', 'true');
    });

    it('disables Paste for generated columns', () => {
      render(
        <CellContextMenu
          {...defaultProps}
          columnInfo={mockColumn('full_name', 'TEXT', 'stored')}
        />
      );

      const pasteItem = screen.getByTestId('cell-context-menu-item-paste');
      expect(pasteItem).toHaveAttribute('aria-disabled', 'true');
    });

    it('shows tooltip when Paste is disabled due to read-only', () => {
      render(<CellContextMenu {...defaultProps} isReadOnly={true} />);

      const pasteItem = screen.getByTestId('cell-context-menu-item-paste');
      fireEvent.mouseEnter(pasteItem);

      expect(screen.getByRole('tooltip')).toHaveTextContent('Database is read-only');
    });

    it('shows tooltip when Paste is disabled due to generated column', () => {
      render(
        <CellContextMenu
          {...defaultProps}
          columnInfo={mockColumn('full_name', 'TEXT', 'stored')}
        />
      );

      const pasteItem = screen.getByTestId('cell-context-menu-item-paste');
      fireEvent.mouseEnter(pasteItem);

      expect(screen.getByRole('tooltip')).toHaveTextContent('Generated columns cannot be edited');
    });
  });

  describe('Set NULL Action', () => {
    it('calls onSetNull when Set NULL is clicked', () => {
      const onSetNull = vi.fn();
      render(<CellContextMenu {...defaultProps} onSetNull={onSetNull} />);

      fireEvent.click(screen.getByTestId('cell-context-menu-item-set-null'));

      expect(onSetNull).toHaveBeenCalled();
    });

    it('disables Set NULL in read-only mode', () => {
      render(<CellContextMenu {...defaultProps} isReadOnly={true} />);

      const setNullItem = screen.getByTestId('cell-context-menu-item-set-null');
      expect(setNullItem).toHaveAttribute('aria-disabled', 'true');
    });

    it('disables Set NULL for generated columns', () => {
      render(
        <CellContextMenu
          {...defaultProps}
          columnInfo={mockColumn('full_name', 'TEXT', 'stored')}
        />
      );

      const setNullItem = screen.getByTestId('cell-context-menu-item-set-null');
      expect(setNullItem).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('Save BLOB Action', () => {
    it('calls onSaveBlob when Save BLOB is clicked', () => {
      const onSaveBlob = vi.fn();
      render(
        <CellContextMenu
          {...defaultProps}
          columnInfo={mockColumn('data', 'BLOB')}
          cellValue={new Uint8Array([1, 2, 3])}
          onSaveBlob={onSaveBlob}
        />
      );

      fireEvent.click(screen.getByTestId('cell-context-menu-item-save-blob'));

      expect(onSaveBlob).toHaveBeenCalled();
    });
  });

  describe('Delete Row Action', () => {
    it('calls onDeleteRow when Delete Row is clicked', () => {
      const onDeleteRow = vi.fn();
      render(<CellContextMenu {...defaultProps} onDeleteRow={onDeleteRow} />);

      fireEvent.click(screen.getByTestId('cell-context-menu-item-delete-row'));

      expect(onDeleteRow).toHaveBeenCalled();
    });

    it('disables Delete Row in read-only mode', () => {
      render(<CellContextMenu {...defaultProps} isReadOnly={true} />);

      const deleteRowItem = screen.getByTestId('cell-context-menu-item-delete-row');
      expect(deleteRowItem).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('Menu Close', () => {
    it('closes menu on Escape key', () => {
      const onClose = vi.fn();
      render(<CellContextMenu {...defaultProps} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalled();
    });

    it('closes menu on click outside', () => {
      const onClose = vi.fn();
      render(<CellContextMenu {...defaultProps} onClose={onClose} />);

      fireEvent.mouseDown(document.body);

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Keyboard Navigation', () => {
    it('supports arrow key navigation', () => {
      render(<CellContextMenu {...defaultProps} />);

      const menu = screen.getByTestId('cell-context-menu');
      fireEvent.keyDown(menu, { key: 'ArrowDown' });

      // First item should be focused after down arrow
      const copyItem = screen.getByTestId('cell-context-menu-item-copy');
      expect(copyItem.className).toContain('bg-navy-100');
    });
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('copyCellValue', () => {
  beforeEach(() => {
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue(''),
      },
    });
  });

  it('copies null value as empty string', async () => {
    await copyCellValue(null);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
  });

  it('copies string value directly', async () => {
    await copyCellValue('test value');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test value');
  });

  it('copies number value as string', async () => {
    await copyCellValue(42);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('42');
  });

  it('copies BLOB value as base64', async () => {
    const blob = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    await copyCellValue(blob);

    // "Hello" in base64 is "SGVsbG8="
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('SGVsbG8=');
  });
});

describe('parsePastedValue', () => {
  it('returns null for empty string', () => {
    expect(parsePastedValue('', 'TEXT')).toBeNull();
  });

  it('returns null for "null" string (case insensitive)', () => {
    expect(parsePastedValue('null', 'TEXT')).toBeNull();
    expect(parsePastedValue('NULL', 'TEXT')).toBeNull();
    expect(parsePastedValue('Null', 'TEXT')).toBeNull();
  });

  it('parses integer for INTEGER column', () => {
    expect(parsePastedValue('42', 'INTEGER')).toBe(42);
    expect(parsePastedValue('-10', 'INTEGER')).toBe(-10);
  });

  it('parses float for REAL column', () => {
    expect(parsePastedValue('3.14', 'REAL')).toBe(3.14);
    expect(parsePastedValue('-2.5', 'REAL')).toBe(-2.5);
  });

  it('returns string for TEXT column', () => {
    expect(parsePastedValue('hello', 'TEXT')).toBe('hello');
    expect(parsePastedValue('42', 'TEXT')).toBe('42'); // Numbers stay as strings
  });

  it('returns string for invalid numeric input', () => {
    expect(parsePastedValue('abc', 'INTEGER')).toBe('abc');
    expect(parsePastedValue('not a number', 'REAL')).toBe('not a number');
  });

  it('handles type with length specifier', () => {
    expect(parsePastedValue('42', 'INTEGER(8)')).toBe(42);
    expect(parsePastedValue('hello', 'VARCHAR(255)')).toBe('hello');
  });
});

describe('generateBlobFilename', () => {
  it('generates filename with column name and row index', () => {
    expect(generateBlobFilename('profile_image', 5)).toBe('profile_image_5.bin');
  });

  it('sanitizes special characters in column name', () => {
    // Space and special characters !@#$ are each replaced with _
    expect(generateBlobFilename('my column!@#$', 0)).toBe('my_column_____0.bin');
  });

  it('preserves underscores and hyphens', () => {
    expect(generateBlobFilename('my-column_name', 10)).toBe('my-column_name_10.bin');
  });
});

describe('downloadBlob', () => {
  beforeEach(() => {
    // Mock URL.createObjectURL and URL.revokeObjectURL
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-url');
    global.URL.revokeObjectURL = vi.fn();

    // Mock document.createElement to track link creation
    vi.spyOn(document, 'createElement');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates download link with correct attributes', () => {
    const data = new Uint8Array([1, 2, 3]);
    const linkMock = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(linkMock as unknown as HTMLAnchorElement);

    downloadBlob(data, 'test.bin');

    expect(linkMock.href).toBe('blob:test-url');
    expect(linkMock.download).toBe('test.bin');
    expect(linkMock.click).toHaveBeenCalled();
  });

  it('cleans up blob URL after download', () => {
    const data = new Uint8Array([1, 2, 3]);
    const linkMock = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(linkMock as unknown as HTMLAnchorElement);

    downloadBlob(data, 'test.bin');

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });
});
