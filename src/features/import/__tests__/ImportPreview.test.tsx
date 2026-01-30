import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPreview, type PreviewColumn } from '../ImportPreview';

const mockColumns: PreviewColumn[] = [
  { name: 'id', originalName: 'ID', type: 'INTEGER' },
  { name: 'user_name', originalName: 'User Name', type: 'TEXT' },
  { name: 'score', originalName: 'score', type: 'REAL' },
];

const mockRows: unknown[][] = [
  [1, 'Alice', 95.5],
  [2, 'Bob', 87.3],
  [3, 'Charlie', 92.1],
  [4, 'Diana', 88.9],
  [5, 'Eve', 91.0],
];

describe('ImportPreview', () => {
  describe('preview display', () => {
    it('shows first 10 rows by default', () => {
      const manyRows = Array.from({ length: 15 }, (_, i) => [i + 1, `User ${i}`, 50 + i]);
      render(<ImportPreview columns={mockColumns} rows={manyRows} />);

      // Should show rows 0-9 (10 rows)
      expect(screen.getByTestId('preview-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('preview-row-9')).toBeInTheDocument();
      expect(screen.queryByTestId('preview-row-10')).not.toBeInTheDocument();
    });

    it('shows all rows if less than 10', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} />);

      expect(screen.getByTestId('preview-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('preview-row-4')).toBeInTheDocument();
      expect(screen.queryByTestId('preview-row-5')).not.toBeInTheDocument();
    });

    it('respects maxPreviewRows prop', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} maxPreviewRows={3} />);

      expect(screen.getByTestId('preview-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('preview-row-2')).toBeInTheDocument();
      expect(screen.queryByTestId('preview-row-3')).not.toBeInTheDocument();
    });

    it('displays row count as "X of Y rows"', () => {
      const manyRows = Array.from({ length: 100 }, (_, i) => [i + 1, `User ${i}`, 50 + i]);
      render(<ImportPreview columns={mockColumns} rows={manyRows} />);

      expect(screen.getByText(/Previewing 10 of 100 rows/)).toBeInTheDocument();
    });

    it('displays correct count for small datasets', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} />);

      expect(screen.getByText(/Previewing 5 of 5 rows/)).toBeInTheDocument();
    });

    it('displays NULL values with italic styling', () => {
      const rowsWithNull: unknown[][] = [[1, null, 95.5]];
      render(<ImportPreview columns={mockColumns} rows={rowsWithNull} />);

      const cell = screen.getByTestId('cell-0-1');
      expect(cell).toHaveTextContent('NULL');
      expect(cell.querySelector('span')).toHaveClass('italic');
    });
  });

  describe('type dropdown', () => {
    it('renders type dropdown for each column', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} />);

      expect(screen.getByTestId('type-dropdown-0')).toBeInTheDocument();
      expect(screen.getByTestId('type-dropdown-1')).toBeInTheDocument();
      expect(screen.getByTestId('type-dropdown-2')).toBeInTheDocument();
    });

    it('shows inferred type as default selection', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} />);

      expect(screen.getByTestId('type-dropdown-0')).toHaveValue('INTEGER');
      expect(screen.getByTestId('type-dropdown-1')).toHaveValue('TEXT');
      expect(screen.getByTestId('type-dropdown-2')).toHaveValue('REAL');
    });

    it('calls onColumnsChange when type is changed', async () => {
      const user = userEvent.setup();
      const onColumnsChange = vi.fn();

      render(
        <ImportPreview
          columns={mockColumns}
          rows={mockRows}
          onColumnsChange={onColumnsChange}
        />
      );

      const dropdown = screen.getByTestId('type-dropdown-0');
      await user.selectOptions(dropdown, 'TEXT');

      expect(onColumnsChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'id', type: 'TEXT' }),
        ])
      );
    });

    it('provides all SQLite types as options', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} />);

      const dropdown = screen.getByTestId('type-dropdown-0');
      const options = within(dropdown).getAllByRole('option');

      expect(options).toHaveLength(4);
      expect(options.map((o) => o.textContent)).toEqual(['TEXT', 'INTEGER', 'REAL', 'BLOB']);
    });

    it('disables dropdowns when onColumnsChange is not provided', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} />);

      expect(screen.getByTestId('type-dropdown-0')).toBeDisabled();
      expect(screen.getByTestId('type-dropdown-1')).toBeDisabled();
    });
  });

  describe('header normalization display', () => {
    it('shows original and normalized names when they differ', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} />);

      // 'User Name' → 'user_name'
      expect(screen.getByTestId('header-normalization-1')).toHaveTextContent(
        'User Name → user_name'
      );
    });

    it('does not show normalization when names match', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} />);

      // 'score' should not show normalization
      expect(screen.queryByTestId('header-normalization-2')).not.toBeInTheDocument();
    });

    it('shows normalization for case differences', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} />);

      // 'ID' → 'id'
      expect(screen.getByTestId('header-normalization-0')).toHaveTextContent('ID → id');
    });
  });

  describe('mismatch cell highlighting', () => {
    it('highlights cells that do not match selected type', () => {
      const columnsWithMismatch: PreviewColumn[] = [
        { name: 'id', type: 'INTEGER' },
        { name: 'value', type: 'INTEGER' },
      ];
      const rowsWithMismatch: unknown[][] = [
        [1, 'not a number'],
        [2, 100],
      ];

      render(<ImportPreview columns={columnsWithMismatch} rows={rowsWithMismatch} />);

      // Row 0, column 1 should have mismatch attribute
      const mismatchCell = screen.getByTestId('cell-0-1');
      expect(mismatchCell).toHaveAttribute('data-mismatch', 'true');

      // Row 1, column 1 should NOT have mismatch
      const validCell = screen.getByTestId('cell-1-1');
      expect(validCell).not.toHaveAttribute('data-mismatch');
    });

    it('shows warning indicator on mismatch cells', () => {
      const columnsWithMismatch: PreviewColumn[] = [
        { name: 'value', type: 'INTEGER' },
      ];
      const rowsWithMismatch: unknown[][] = [['text']];

      render(<ImportPreview columns={columnsWithMismatch} rows={rowsWithMismatch} />);

      const cell = screen.getByTestId('cell-0-0');
      expect(cell).toHaveTextContent('⚠');
    });

    it('shows mismatch count in header', () => {
      const columnsWithMismatch: PreviewColumn[] = [
        { name: 'value', type: 'INTEGER' },
      ];
      const rowsWithMismatch: unknown[][] = [['a'], ['b'], ['c']];

      render(<ImportPreview columns={columnsWithMismatch} rows={rowsWithMismatch} />);

      expect(screen.getByTestId('mismatch-warning')).toHaveTextContent('3 type mismatches');
    });

    it('shows singular form for single mismatch', () => {
      const columnsWithMismatch: PreviewColumn[] = [
        { name: 'value', type: 'INTEGER' },
      ];
      const rowsWithMismatch: unknown[][] = [['text']];

      render(<ImportPreview columns={columnsWithMismatch} rows={rowsWithMismatch} />);

      expect(screen.getByTestId('mismatch-warning')).toHaveTextContent('1 type mismatch');
    });

    it('does not show warning when no mismatches', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} />);

      expect(screen.queryByTestId('mismatch-warning')).not.toBeInTheDocument();
    });

    it('treats NULL as matching any type', () => {
      const columns: PreviewColumn[] = [{ name: 'value', type: 'INTEGER' }];
      const rows: unknown[][] = [[null]];

      render(<ImportPreview columns={columns} rows={rows} />);

      const cell = screen.getByTestId('cell-0-0');
      expect(cell).not.toHaveAttribute('data-mismatch');
    });

    it('updates mismatches when type is changed', async () => {
      const user = userEvent.setup();
      const columns: PreviewColumn[] = [{ name: 'value', type: 'TEXT' }];
      const rows: unknown[][] = [['hello']];
      const onColumnsChange = vi.fn();

      const { rerender } = render(
        <ImportPreview columns={columns} rows={rows} onColumnsChange={onColumnsChange} />
      );

      // Initially no mismatch (TEXT accepts anything)
      expect(screen.queryByTestId('mismatch-warning')).not.toBeInTheDocument();

      // Simulate type change
      await user.selectOptions(screen.getByTestId('type-dropdown-0'), 'INTEGER');

      // Rerender with updated columns (simulating parent update)
      const updatedColumns: PreviewColumn[] = [{ name: 'value', type: 'INTEGER' }];
      rerender(
        <ImportPreview
          columns={updatedColumns}
          rows={rows}
          onColumnsChange={onColumnsChange}
        />
      );

      // Now should show mismatch
      expect(screen.getByTestId('mismatch-warning')).toBeInTheDocument();
    });
  });

  describe('column rename', () => {
    it('shows edit button when onColumnRename is provided', () => {
      render(
        <ImportPreview
          columns={mockColumns}
          rows={mockRows}
          onColumnRename={vi.fn()}
        />
      );

      expect(screen.getByTestId('edit-column-btn-0')).toBeInTheDocument();
    });

    it('does not show edit button when onColumnRename is not provided', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} />);

      expect(screen.queryByTestId('edit-column-btn-0')).not.toBeInTheDocument();
    });

    it('opens edit input when edit button clicked', async () => {
      const user = userEvent.setup();

      render(
        <ImportPreview
          columns={mockColumns}
          rows={mockRows}
          onColumnRename={vi.fn()}
        />
      );

      await user.click(screen.getByTestId('edit-column-btn-0'));

      expect(screen.getByTestId('column-name-input-0')).toBeInTheDocument();
    });

    it('calls onColumnRename when Enter pressed', async () => {
      const user = userEvent.setup();
      const onColumnRename = vi.fn();

      render(
        <ImportPreview
          columns={mockColumns}
          rows={mockRows}
          onColumnRename={onColumnRename}
        />
      );

      await user.click(screen.getByTestId('edit-column-btn-0'));
      const input = screen.getByTestId('column-name-input-0');

      await user.clear(input);
      await user.type(input, 'new_id');
      await user.keyboard('{Enter}');

      expect(onColumnRename).toHaveBeenCalledWith(0, 'new_id');
    });

    it('cancels edit on Escape', async () => {
      const user = userEvent.setup();
      const onColumnRename = vi.fn();

      render(
        <ImportPreview
          columns={mockColumns}
          rows={mockRows}
          onColumnRename={onColumnRename}
        />
      );

      await user.click(screen.getByTestId('edit-column-btn-0'));
      await user.keyboard('{Escape}');

      expect(onColumnRename).not.toHaveBeenCalled();
      expect(screen.queryByTestId('column-name-input-0')).not.toBeInTheDocument();
    });
  });

  describe('REAL type validation', () => {
    it('treats integer values as valid for REAL type', () => {
      const columns: PreviewColumn[] = [{ name: 'value', type: 'REAL' }];
      const rows: unknown[][] = [[42]];

      render(<ImportPreview columns={columns} rows={rows} />);

      expect(screen.queryByTestId('mismatch-warning')).not.toBeInTheDocument();
    });

    it('treats decimal values as valid for REAL type', () => {
      const columns: PreviewColumn[] = [{ name: 'value', type: 'REAL' }];
      const rows: unknown[][] = [[3.14]];

      render(<ImportPreview columns={columns} rows={rows} />);

      expect(screen.queryByTestId('mismatch-warning')).not.toBeInTheDocument();
    });
  });

  describe('BLOB type', () => {
    it('accepts any value for BLOB type', () => {
      const columns: PreviewColumn[] = [{ name: 'data', type: 'BLOB' }];
      const rows: unknown[][] = [['any string'], [123], [45.6]];

      render(<ImportPreview columns={columns} rows={rows} />);

      expect(screen.queryByTestId('mismatch-warning')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has aria-label on type dropdowns', () => {
      render(<ImportPreview columns={mockColumns} rows={mockRows} />);

      expect(screen.getByTestId('type-dropdown-0')).toHaveAttribute(
        'aria-label',
        'Type for column id'
      );
    });

    it('has aria-label on edit buttons', () => {
      render(
        <ImportPreview
          columns={mockColumns}
          rows={mockRows}
          onColumnRename={vi.fn()}
        />
      );

      expect(screen.getByTestId('edit-column-btn-0')).toHaveAttribute(
        'aria-label',
        'Edit column id'
      );
    });
  });
});
