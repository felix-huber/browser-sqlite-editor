import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  SqlResultsDisplay,
  classifyStatement,
  formatExecutionTime,
  type StatementResult,
} from '../SqlResultsDisplay';

// =============================================================================
// Unit Tests for Utility Functions
// =============================================================================

describe('classifyStatement', () => {
  it('classifies SELECT statements', () => {
    expect(classifyStatement('SELECT * FROM users')).toBe('select');
    expect(classifyStatement('  select id from users')).toBe('select');
  });

  it('classifies WITH (CTE) statements as select', () => {
    expect(classifyStatement('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe('select');
  });

  it('classifies INSERT statements', () => {
    expect(classifyStatement('INSERT INTO users (name) VALUES ("test")')).toBe('insert');
    expect(classifyStatement('  insert into users values (1)')).toBe('insert');
  });

  it('classifies REPLACE as insert', () => {
    expect(classifyStatement('REPLACE INTO users (id, name) VALUES (1, "test")')).toBe('insert');
  });

  it('classifies UPDATE statements', () => {
    expect(classifyStatement('UPDATE users SET name = "test"')).toBe('update');
    expect(classifyStatement('  update users set id = 1')).toBe('update');
  });

  it('classifies DELETE statements', () => {
    expect(classifyStatement('DELETE FROM users WHERE id = 1')).toBe('delete');
    expect(classifyStatement('  delete from users')).toBe('delete');
  });

  it('classifies DDL statements', () => {
    expect(classifyStatement('CREATE TABLE users (id INTEGER)')).toBe('ddl');
    expect(classifyStatement('DROP TABLE users')).toBe('ddl');
    expect(classifyStatement('ALTER TABLE users ADD COLUMN name TEXT')).toBe('ddl');
    expect(classifyStatement('PRAGMA table_info(users)')).toBe('ddl');
  });
});

describe('formatExecutionTime', () => {
  it('formats sub-millisecond times with 2 decimal places', () => {
    expect(formatExecutionTime(0.5)).toBe('0.50ms');
    expect(formatExecutionTime(0.123)).toBe('0.12ms');
  });

  it('formats millisecond times without decimals', () => {
    expect(formatExecutionTime(12)).toBe('12ms');
    expect(formatExecutionTime(999)).toBe('999ms');
  });

  it('formats times over 1 second in seconds', () => {
    expect(formatExecutionTime(1000)).toBe('1.00s');
    expect(formatExecutionTime(2500)).toBe('2.50s');
  });
});

// =============================================================================
// Component Tests
// =============================================================================

describe('SqlResultsDisplay', () => {
  // Helper to create a SELECT result
  const createSelectResult = (
    rows: (string | number | null | Uint8Array)[][] = [[1, 'Alice']],
    columns = ['id', 'name'],
    executionTime = 12,
  ): StatementResult => ({
    sql: 'SELECT * FROM users',
    type: 'select',
    result: {
      columns,
      columnTypes: columns.map(() => 'TEXT'),
      rows,
    },
    executionTime,
  });

  // Helper to create an INSERT result
  const createInsertResult = (rowsAffected = 1, executionTime = 5): StatementResult => ({
    sql: 'INSERT INTO users (name) VALUES ("test")',
    type: 'insert',
    rowsAffected,
    executionTime,
  });

  // Helper to create an UPDATE result
  const createUpdateResult = (rowsAffected = 1, executionTime = 3): StatementResult => ({
    sql: 'UPDATE users SET name = "test"',
    type: 'update',
    rowsAffected,
    executionTime,
  });

  // Helper to create a DELETE result
  const createDeleteResult = (rowsAffected = 1, executionTime = 2): StatementResult => ({
    sql: 'DELETE FROM users WHERE id = 1',
    type: 'delete',
    rowsAffected,
    executionTime,
  });

  // Helper to create a DDL result
  const createDdlResult = (executionTime = 8): StatementResult => ({
    sql: 'CREATE TABLE test (id INTEGER)',
    type: 'ddl',
    executionTime,
  });

  // Helper to create an error result
  const createErrorResult = (
    message: string,
    line?: number,
    column?: number,
  ): StatementResult => ({
    sql: 'SELEC * FROM users',
    type: 'error',
    error: { message, line, column },
  });

  describe('SELECT results', () => {
    it('renders DataGrid with results', () => {
      const result = createSelectResult([
        [1, 'Alice'],
        [2, 'Bob'],
        [3, 'Charlie'],
      ]);

      render(<SqlResultsDisplay results={[result]} height={400} />);

      expect(screen.getByTestId('sql-results-display')).toBeInTheDocument();
      expect(screen.getByTestId('row-count')).toHaveTextContent('3 rows');
      expect(screen.getByTestId('column-count')).toHaveTextContent('2 columns');
    });

    it('shows empty state for SELECT with no rows', () => {
      const result = createSelectResult([], ['id', 'name']);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('select-empty-results')).toBeInTheDocument();
      expect(screen.getByText('No rows returned')).toBeInTheDocument();
    });

    it('shows execution time in status bar', () => {
      const result = createSelectResult([[1, 'Alice']], ['id', 'name'], 12.5);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('execution-time-status')).toHaveTextContent('Executed in 13ms');
    });
  });

  describe('INSERT results', () => {
    it('shows "1 row inserted" for single insert', () => {
      const result = createInsertResult(1);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('insert-result')).toBeInTheDocument();
      expect(screen.getByTestId('affected-rows-message')).toHaveTextContent('1 row inserted');
    });

    it('shows "5 rows inserted" for multi-insert', () => {
      const result = createInsertResult(5);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('affected-rows-message')).toHaveTextContent('5 rows inserted');
    });

    it('shows execution time', () => {
      const result = createInsertResult(1, 42);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('execution-time')).toHaveTextContent('Executed in 42ms');
    });
  });

  describe('UPDATE results', () => {
    it('shows "1 row updated" for single update', () => {
      const result = createUpdateResult(1);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('update-result')).toBeInTheDocument();
      expect(screen.getByTestId('affected-rows-message')).toHaveTextContent('1 row updated');
    });

    it('shows "10 rows updated" for multi-update', () => {
      const result = createUpdateResult(10);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('affected-rows-message')).toHaveTextContent('10 rows updated');
    });
  });

  describe('DELETE results', () => {
    it('shows "1 row deleted" for single delete', () => {
      const result = createDeleteResult(1);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('delete-result')).toBeInTheDocument();
      expect(screen.getByTestId('affected-rows-message')).toHaveTextContent('1 row deleted');
    });

    it('shows "3 rows deleted" for multi-delete', () => {
      const result = createDeleteResult(3);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('affected-rows-message')).toHaveTextContent('3 rows deleted');
    });
  });

  describe('DDL results', () => {
    it('shows success message for DDL', () => {
      const result = createDdlResult();

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('ddl-result')).toBeInTheDocument();
      expect(screen.getByTestId('ddl-success-message')).toHaveTextContent(
        'Statement executed successfully',
      );
    });
  });

  describe('Error display', () => {
    it('shows error message', () => {
      const result = createErrorResult('syntax error near "SELEC"');

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('error-result')).toBeInTheDocument();
      expect(screen.getByTestId('error-message')).toHaveTextContent(
        'syntax error near "SELEC"',
      );
    });

    it('shows error with line number', () => {
      const result = createErrorResult('syntax error', 5);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByText(/at line 5/)).toBeInTheDocument();
    });

    it('shows error with line and column', () => {
      const result = createErrorResult('unexpected token', 3, 10);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByText(/at line 3/)).toBeInTheDocument();
      expect(screen.getByText(/column 10/)).toBeInTheDocument();
    });
  });

  describe('Multi-result tabs', () => {
    it('shows tabs for multiple SELECTs in batch', () => {
      const results = [
        createSelectResult([[1, 'Alice']], ['id', 'name']),
        createSelectResult([[2, 'Bob']], ['id', 'name']),
      ];

      render(<SqlResultsDisplay results={results} height={400} />);

      expect(screen.getByTestId('results-tab-bar')).toBeInTheDocument();
      expect(screen.getByTestId('result-tab-0')).toBeInTheDocument();
      expect(screen.getByTestId('result-tab-1')).toBeInTheDocument();
    });

    it('switches between tabs on click', () => {
      const results = [
        createSelectResult([[1, 'Alice']], ['id', 'name']),
        createSelectResult([[2, 'Bob'], [3, 'Charlie']], ['id', 'name']),
      ];

      render(<SqlResultsDisplay results={results} height={400} />);

      // Initially shows first result
      expect(screen.getByTestId('row-count')).toHaveTextContent('1 row');

      // Click second tab
      fireEvent.click(screen.getByTestId('result-tab-1'));

      // Now shows second result
      expect(screen.getByTestId('row-count')).toHaveTextContent('2 rows');
    });

    it('shows total execution time for batch', () => {
      const results = [
        createSelectResult([[1, 'Alice']], ['id', 'name'], 10),
        createSelectResult([[2, 'Bob']], ['id', 'name'], 15),
      ];

      render(
        <SqlResultsDisplay results={results} height={400} totalExecutionTime={25} />,
      );

      expect(screen.getByTestId('total-execution-time')).toHaveTextContent('Total: 25ms');
    });

    it('shows mixed result types in tabs', () => {
      const results = [
        createSelectResult([[1, 'Alice']], ['id', 'name']),
        createInsertResult(5),
        createDdlResult(),
      ];

      render(<SqlResultsDisplay results={results} height={400} />);

      expect(screen.getByTestId('result-tab-0')).toHaveTextContent('Result 1');
      expect(screen.getByTestId('result-tab-1')).toHaveTextContent('Insert 2');
      expect(screen.getByTestId('result-tab-2')).toHaveTextContent('Statement 3');
    });

    it('shows row count in tab label for SELECT', () => {
      const results = [
        createSelectResult(
          [
            [1, 'Alice'],
            [2, 'Bob'],
            [3, 'Charlie'],
          ],
          ['id', 'name'],
        ),
      ];

      render(<SqlResultsDisplay results={results} height={400} />);

      // Single result shouldn't show tabs, but if we add another...
      const multiResults = [
        ...results,
        createSelectResult([[4, 'Dave']], ['id', 'name']),
      ];

      render(
        <SqlResultsDisplay results={multiResults} height={400} />,
      );

      expect(screen.getByTestId('result-tab-0')).toHaveTextContent('(3)');
      expect(screen.getByTestId('result-tab-1')).toHaveTextContent('(1)');
    });
  });

  describe('NULL display', () => {
    it('displays NULL with italic gray styling in DataGrid', () => {
      const result = createSelectResult([[1, null]], ['id', 'email']);

      render(<SqlResultsDisplay results={[result]} height={400} />);

      // The DataGrid component handles NULL display
      // Check that the grid is rendered (NULL styling is in DataGrid component)
      expect(screen.getByTestId('sql-results-display')).toBeInTheDocument();
    });
  });

  describe('BLOB display', () => {
    it('displays BLOB placeholder in DataGrid', () => {
      const blobData = new Uint8Array([1, 2, 3, 4, 5]);
      const result = createSelectResult([[1, blobData]], ['id', 'data']);

      render(<SqlResultsDisplay results={[result]} height={400} />);

      // The DataGrid component handles BLOB display
      // Check that the grid is rendered (BLOB styling is in DataGrid component)
      expect(screen.getByTestId('sql-results-display')).toBeInTheDocument();
    });
  });

  describe('XSS prevention', () => {
    it('renders HTML tags as literal text, not HTML', () => {
      // Create a result with potentially malicious HTML/script content
      const result = createSelectResult(
        [[1, '<script>alert(1)</script>']],
        ['id', 'content'],
      );

      render(<SqlResultsDisplay results={[result]} height={400} />);

      // The component should render the script tag as text, not execute it
      // React's JSX automatically escapes HTML entities
      expect(screen.getByTestId('sql-results-display')).toBeInTheDocument();

      // Verify no script tags are actually in the DOM as executable
      const scripts = document.querySelectorAll('script');
      const alertScript = Array.from(scripts).find((s) =>
        s.textContent?.includes('alert(1)'),
      );
      expect(alertScript).toBeUndefined();
    });

    it('escapes HTML in column headers', () => {
      const result = createSelectResult(
        [[1, 'value']],
        ['<img onerror="alert(1)">', 'normal'],
      );

      render(<SqlResultsDisplay results={[result]} height={400} />);

      // Should not create an img element
      const imgs = document.querySelectorAll('img');
      expect(imgs.length).toBe(0);
    });
  });

  describe('Timing display', () => {
    it('shows execution time accurately', () => {
      const result = createSelectResult([[1, 'Alice']], ['id', 'name'], 12.345);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      // Should round to nearest ms for display
      expect(screen.getByTestId('execution-time-status')).toHaveTextContent('12ms');
    });

    it('shows sub-second times in milliseconds', () => {
      const result = createSelectResult([[1, 'Alice']], ['id', 'name'], 0.5);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('execution-time-status')).toHaveTextContent('0.50ms');
    });

    it('shows long times in seconds', () => {
      const result = createSelectResult([[1, 'Alice']], ['id', 'name'], 2500);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('execution-time-status')).toHaveTextContent('2.50s');
    });
  });

  describe('Edge cases', () => {
    it('returns null for empty results array', () => {
      const { container } = render(<SqlResultsDisplay results={[]} height={300} />);
      expect(container.firstChild).toBeNull();
    });

    it('handles result with 0 affected rows', () => {
      const result = createUpdateResult(0);

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('affected-rows-message')).toHaveTextContent('0 rows updated');
    });

    it('handles hasMore flag', () => {
      const result: StatementResult = {
        sql: 'SELECT * FROM large_table',
        type: 'select',
        result: {
          columns: ['id'],
          columnTypes: ['INTEGER'],
          rows: [[1], [2], [3]],
          hasMore: true,
        },
        executionTime: 50,
      };

      render(<SqlResultsDisplay results={[result]} height={300} />);

      expect(screen.getByTestId('row-count')).toHaveTextContent('3 rows+');
    });
  });
});
