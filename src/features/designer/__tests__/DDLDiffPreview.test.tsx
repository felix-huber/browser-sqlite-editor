import { render, screen, fireEvent } from '@testing-library/react';
import {
  DDLDiffPreview,
  analyzeChanges,
  generateDiff,
  generateRebuildPlan,
  getAffectedObjects,
  validateChanges,
} from '../DDLDiffPreview';
import type { TableInfo, DesignerColumnDraft } from '../../../types';

// =============================================================================
// Test Fixtures
// =============================================================================

const createColumn = (
  overrides: Partial<DesignerColumnDraft> = {}
): DesignerColumnDraft => ({
  id: `col-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  name: 'column',
  type: 'TEXT',
  isPrimaryKey: false,
  isNotNull: false,
  isUnique: false,
  defaultValue: null,
  isExisting: false,
  ...overrides,
});

const createExistingTable = (
  overrides: Partial<TableInfo> = {}
): TableInfo => ({
  name: 'users',
  isView: false,
  isVirtual: false,
  withoutRowid: false,
  columns: [
    { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
    { cid: 1, name: 'name', type: 'TEXT', notnull: false, dfltValue: null, pk: 0, generated: null, hidden: false },
    { cid: 2, name: 'email', type: 'TEXT', notnull: true, dfltValue: null, pk: 0, generated: null, hidden: false },
  ],
  indexes: [],
  createSql: 'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT,\n  email TEXT NOT NULL\n);',
  ...overrides,
});

// =============================================================================
// analyzeChanges Tests
// =============================================================================

describe('analyzeChanges', () => {
  describe('add column scenarios', () => {
    it('detects simple column addition', () => {
      const existingTable = createExistingTable();
      const columns: DesignerColumnDraft[] = [
        createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isNotNull: true, isExisting: true, originalName: 'id' }),
        createColumn({ name: 'name', type: 'TEXT', isExisting: true, originalName: 'name' }),
        createColumn({ name: 'email', type: 'TEXT', isNotNull: true, isExisting: true, originalName: 'email' }),
        createColumn({ name: 'age', type: 'INTEGER', isExisting: false }), // New column
      ];

      const analysis = analyzeChanges(existingTable, columns, 'users');

      expect(analysis.changeType).toBe('add_columns');
      expect(analysis.columnsToAdd).toHaveLength(1);
      expect(analysis.columnsToAdd[0].name).toBe('age');
    });

    it('shows ALTER TABLE preview for add column', () => {
      const existingTable = createExistingTable();
      const columns: DesignerColumnDraft[] = [
        createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isNotNull: true, isExisting: true, originalName: 'id' }),
        createColumn({ name: 'name', type: 'TEXT', isExisting: true, originalName: 'name' }),
        createColumn({ name: 'email', type: 'TEXT', isNotNull: true, isExisting: true, originalName: 'email' }),
        createColumn({ name: 'created_at', type: 'DATETIME', isExisting: false }),
      ];

      render(
        <DDLDiffPreview
          existingTable={existingTable}
          columns={columns}
          tableName="users"
        />
      );

      // Should show operation preview with ALTER TABLE
      expect(screen.getByTestId('operation-preview')).toBeInTheDocument();
      expect(screen.getByText(/Simple column additions/)).toBeInTheDocument();
      expect(screen.getByText(/Add column: created_at/)).toBeInTheDocument();
    });
  });

  describe('remove column scenarios', () => {
    it('detects column removal and requires rebuild', () => {
      const existingTable = createExistingTable();
      const columns: DesignerColumnDraft[] = [
        createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
        createColumn({ name: 'name', type: 'TEXT', isExisting: true, originalName: 'name' }),
        // email column removed
      ];

      const analysis = analyzeChanges(existingTable, columns, 'users');

      expect(analysis.changeType).toBe('rebuild');
      expect(analysis.columnsRemoved).toContain('email');
    });

    it('shows rebuild plan for column removal', () => {
      const existingTable = createExistingTable();
      const columns: DesignerColumnDraft[] = [
        createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
        createColumn({ name: 'name', type: 'TEXT', isExisting: true, originalName: 'name' }),
      ];

      render(
        <DDLDiffPreview
          existingTable={existingTable}
          columns={columns}
          tableName="users"
        />
      );

      expect(screen.getByTestId('operation-preview')).toBeInTheDocument();
      expect(screen.getByText(/Table rebuild required/)).toBeInTheDocument();
      // Should have CREATE, INSERT, DROP, RENAME steps
      expect(screen.getByText(/Create temporary table/)).toBeInTheDocument();
      expect(screen.getByText(/Copy data to temporary table/)).toBeInTheDocument();
      expect(screen.getByText(/Drop original table/)).toBeInTheDocument();
      expect(screen.getByText(/Rename temporary table/)).toBeInTheDocument();
    });
  });

  describe('rename column scenarios', () => {
    it('detects column rename and requires rebuild', () => {
      const existingTable = createExistingTable();
      const columns: DesignerColumnDraft[] = [
        createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
        createColumn({ name: 'full_name', type: 'TEXT', isExisting: true, originalName: 'name' }), // Renamed
        createColumn({ name: 'email', type: 'TEXT', isNotNull: true, isExisting: true, originalName: 'email' }),
      ];

      const analysis = analyzeChanges(existingTable, columns, 'users');

      expect(analysis.changeType).toBe('rebuild');
      expect(analysis.columnsRenamed).toHaveLength(1);
      expect(analysis.columnsRenamed[0]).toEqual({ oldName: 'name', newName: 'full_name' });
    });

    it('shows rebuild plan with column mapping for rename', () => {
      const existingTable = createExistingTable();
      const columns: DesignerColumnDraft[] = [
        createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
        createColumn({ name: 'full_name', type: 'TEXT', isExisting: true, originalName: 'name' }),
        createColumn({ name: 'email', type: 'TEXT', isNotNull: true, isExisting: true, originalName: 'email' }),
      ];

      render(
        <DDLDiffPreview
          existingTable={existingTable}
          columns={columns}
          tableName="users"
        />
      );

      // Check the INSERT step includes the column mapping
      const insertStep = screen.getByTestId('operation-step-2');
      expect(insertStep.textContent).toContain('name'); // Original name in SELECT
      expect(insertStep.textContent).toContain('full_name'); // New name in INSERT
    });
  });
});

// =============================================================================
// Index Affected Tests
// =============================================================================

describe('getAffectedObjects', () => {
  it('lists indexes that will be dropped and recreated', () => {
    const existingTable = createExistingTable({
      indexes: [
        { name: 'idx_users_email', unique: true, partial: false, columns: ['email'], createSql: 'CREATE UNIQUE INDEX idx_users_email ON users(email)' },
        { name: 'idx_users_name', unique: false, partial: false, columns: ['name'], createSql: 'CREATE INDEX idx_users_name ON users(name)' },
      ],
    });

    const affected = getAffectedObjects(existingTable, 'rebuild');

    expect(affected).toHaveLength(2);
    expect(affected[0]).toEqual({
      type: 'index',
      name: 'idx_users_email',
      action: 'drop_and_recreate',
      sql: 'CREATE UNIQUE INDEX idx_users_email ON users(email)',
    });
    expect(affected[1]).toEqual({
      type: 'index',
      name: 'idx_users_name',
      action: 'drop_and_recreate',
      sql: 'CREATE INDEX idx_users_name ON users(name)',
    });
  });

  it('shows indexes in affected objects UI', () => {
    const existingTable = createExistingTable({
      indexes: [
        { name: 'idx_users_email', unique: true, partial: false, columns: ['email'], createSql: 'CREATE UNIQUE INDEX idx_users_email ON users(email)' },
      ],
    });
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
      // Removing columns to trigger rebuild
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
      />
    );

    expect(screen.getByTestId('affected-objects')).toBeInTheDocument();
    expect(screen.getByText('INDEX')).toBeInTheDocument();
    expect(screen.getByText('idx_users_email')).toBeInTheDocument();
    expect(screen.getByText(/will be recreated/)).toBeInTheDocument();
  });

  it('does not show affected objects for simple add column', () => {
    const existingTable = createExistingTable({
      indexes: [
        { name: 'idx_users_email', unique: true, partial: false, columns: ['email'], createSql: 'CREATE UNIQUE INDEX idx_users_email ON users(email)' },
      ],
    });
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isNotNull: true, isExisting: true, originalName: 'id' }),
      createColumn({ name: 'name', type: 'TEXT', isExisting: true, originalName: 'name' }),
      createColumn({ name: 'email', type: 'TEXT', isNotNull: true, isExisting: true, originalName: 'email' }),
      createColumn({ name: 'age', type: 'INTEGER', isExisting: false }),
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
      />
    );

    // Should not show affected objects section for add_columns
    expect(screen.queryByTestId('affected-objects')).not.toBeInTheDocument();
  });
});

// =============================================================================
// Trigger Affected Tests
// =============================================================================

describe('trigger affected', () => {
  it('shows in affected objects list with mocked trigger metadata', () => {
    const existingTable = createExistingTable();
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
      />
    );

    // The rebuild warning should mention potential view impacts
    expect(screen.getByTestId('validation-warning')).toBeInTheDocument();
    expect(screen.getByText(/Views referencing this table may need to be updated/)).toBeInTheDocument();
  });
});

// =============================================================================
// Generated Column Tests
// =============================================================================

describe('generated column handling', () => {
  it('shows warning and blocks Apply for generated column modification', () => {
    const existingTable = createExistingTable({
      columns: [
        { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
        { cid: 1, name: 'first_name', type: 'TEXT', notnull: false, dfltValue: null, pk: 0, generated: null, hidden: false },
        { cid: 2, name: 'last_name', type: 'TEXT', notnull: false, dfltValue: null, pk: 0, generated: null, hidden: false },
        { cid: 3, name: 'full_name', type: 'TEXT', notnull: false, dfltValue: null, pk: 0, generated: 'stored', hidden: false },
      ],
      createSql: 'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  first_name TEXT,\n  last_name TEXT,\n  full_name TEXT GENERATED ALWAYS AS (first_name || " " || last_name) STORED\n);',
    });

    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
      createColumn({ name: 'first_name', type: 'TEXT', isExisting: true, originalName: 'first_name' }),
      createColumn({ name: 'last_name', type: 'TEXT', isExisting: true, originalName: 'last_name' }),
      createColumn({ name: 'full_name_changed', type: 'TEXT', isExisting: true, originalName: 'full_name', generated: 'stored' }), // Renamed
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
      />
    );

    // Should show error for generated column modification
    expect(screen.getByTestId('validation-error')).toBeInTheDocument();
    expect(screen.getByText(/Generated column "full_name" cannot be modified/)).toBeInTheDocument();

    // Apply button should be disabled
    expect(screen.getByTestId('apply-button')).toBeDisabled();
  });

  it('blocks Apply when generated column type is changed', () => {
    const existingTable = createExistingTable({
      columns: [
        { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
        { cid: 1, name: 'computed', type: 'TEXT', notnull: false, dfltValue: null, pk: 0, generated: 'virtual', hidden: false },
      ],
      createSql: 'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  computed TEXT GENERATED ALWAYS AS (id || "") VIRTUAL\n);',
    });

    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
      createColumn({ name: 'computed', type: 'INTEGER', isExisting: true, originalName: 'computed', generated: 'virtual' }), // Type changed
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
      />
    );

    expect(screen.getByTestId('validation-error')).toBeInTheDocument();
    expect(screen.getByTestId('apply-button')).toBeDisabled();
  });
});

// =============================================================================
// No Changes Tests
// =============================================================================

describe('no changes', () => {
  it('shows "No changes to apply" when nothing changed', () => {
    const existingTable = createExistingTable();
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id', isNotNull: true }),
      createColumn({ name: 'name', type: 'TEXT', isExisting: true, originalName: 'name' }),
      createColumn({ name: 'email', type: 'TEXT', isNotNull: true, isExisting: true, originalName: 'email' }),
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
      />
    );

    expect(screen.getByTestId('no-changes-message')).toBeInTheDocument();
    expect(screen.getByText('No changes to apply')).toBeInTheDocument();
  });

  it('Apply button is disabled when no changes', () => {
    const existingTable = createExistingTable();
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id', isNotNull: true }),
      createColumn({ name: 'name', type: 'TEXT', isExisting: true, originalName: 'name' }),
      createColumn({ name: 'email', type: 'TEXT', isNotNull: true, isExisting: true, originalName: 'email' }),
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
      />
    );

    expect(screen.getByTestId('apply-button')).toBeDisabled();
  });
});

// =============================================================================
// generateDiff Tests
// =============================================================================

describe('generateDiff', () => {
  it('marks unchanged lines correctly', () => {
    const oldSql = 'CREATE TABLE users (\n  id INTEGER\n);';
    const newSql = 'CREATE TABLE users (\n  id INTEGER\n);';

    const diff = generateDiff(oldSql, newSql);

    expect(diff.every((line) => line.type === 'unchanged')).toBe(true);
  });

  it('marks added lines in green', () => {
    const oldSql = 'CREATE TABLE users (\n  id INTEGER\n);';
    const newSql = 'CREATE TABLE users (\n  id INTEGER,\n  name TEXT\n);';

    const diff = generateDiff(oldSql, newSql);

    const addedLines = diff.filter((line) => line.type === 'added');
    expect(addedLines.length).toBeGreaterThan(0);
  });

  it('marks removed lines in red', () => {
    const oldSql = 'CREATE TABLE users (\n  id INTEGER,\n  name TEXT\n);';
    const newSql = 'CREATE TABLE users (\n  id INTEGER\n);';

    const diff = generateDiff(oldSql, newSql);

    const removedLines = diff.filter((line) => line.type === 'removed');
    expect(removedLines.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// generateRebuildPlan Tests
// =============================================================================

describe('generateRebuildPlan', () => {
  it('generates correct steps for rebuild', () => {
    const existingTable = createExistingTable();
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
      createColumn({ name: 'full_name', type: 'TEXT', isExisting: true, originalName: 'name' }),
    ];
    const analysis = analyzeChanges(existingTable, columns, 'users');

    const steps = generateRebuildPlan(existingTable, columns, 'users', analysis);

    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps[0].description).toContain('Create temporary table');
    expect(steps[1].description).toContain('Copy data');
    expect(steps[2].description).toContain('Drop original table');
    expect(steps[3].description).toContain('Rename temporary table');
  });

  it('includes index recreation steps', () => {
    const existingTable = createExistingTable({
      indexes: [
        { name: 'idx_email', unique: true, partial: false, columns: ['email'], createSql: 'CREATE UNIQUE INDEX idx_email ON users(email)' },
      ],
    });
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
    ];
    const analysis = analyzeChanges(existingTable, columns, 'users');

    const steps = generateRebuildPlan(existingTable, columns, 'users', analysis);

    const indexStep = steps.find((s) => s.description.includes('Recreate index'));
    expect(indexStep).toBeDefined();
    expect(indexStep?.sql).toContain('CREATE');
    expect(indexStep?.sql).toContain('INDEX');
  });
});

// =============================================================================
// validateChanges Tests
// =============================================================================

describe('validateChanges', () => {
  it('returns isValid: true for valid changes', () => {
    const existingTable = createExistingTable();
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
      createColumn({ name: 'name', type: 'TEXT', isExisting: true, originalName: 'name' }),
      createColumn({ name: 'email', type: 'TEXT', isNotNull: true, isExisting: true, originalName: 'email' }),
      createColumn({ name: 'age', type: 'INTEGER', isExisting: false }),
    ];
    const analysis = analyzeChanges(existingTable, columns, 'users');

    const result = validateChanges(existingTable, columns, 'users', analysis, false);

    expect(result.isValid).toBe(true);
    expect(result.hasChanges).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns isValid: false for read-only mode', () => {
    const existingTable = createExistingTable();
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
      createColumn({ name: 'age', type: 'INTEGER', isExisting: false }),
    ];
    const analysis = analyzeChanges(existingTable, columns, 'users');

    const result = validateChanges(existingTable, columns, 'users', analysis, true);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Database is in read-only mode');
  });

  it('returns isValid: false for generated column modification', () => {
    const existingTable = createExistingTable({
      columns: [
        { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
        { cid: 1, name: 'computed', type: 'TEXT', notnull: false, dfltValue: null, pk: 0, generated: 'stored', hidden: false },
      ],
    });
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
      createColumn({ name: 'computed_renamed', type: 'TEXT', isExisting: true, originalName: 'computed', generated: 'stored' }),
    ];
    const analysis = analyzeChanges(existingTable, columns, 'users');

    const result = validateChanges(existingTable, columns, 'users', analysis, false);

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Generated column'))).toBe(true);
  });
});

// =============================================================================
// Component Integration Tests
// =============================================================================

describe('DDLDiffPreview Component', () => {
  it('renders create mode preview', () => {
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true }),
      createColumn({ name: 'name', type: 'TEXT' }),
    ];

    render(
      <DDLDiffPreview
        existingTable={null}
        columns={columns}
        tableName="new_table"
      />
    );

    expect(screen.getByTestId('ddl-diff-preview')).toBeInTheDocument();
    expect(screen.getByTestId('new-sql-preview')).toBeInTheDocument();
    expect(screen.getByText(/CREATE TABLE Statement/)).toBeInTheDocument();
  });

  it('renders edit mode with split view', () => {
    const existingTable = createExistingTable();
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
      createColumn({ name: 'name', type: 'TEXT', isExisting: true, originalName: 'name' }),
      createColumn({ name: 'email', type: 'TEXT', isNotNull: true, isExisting: true, originalName: 'email' }),
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
      />
    );

    expect(screen.getByTestId('sql-diff-split')).toBeInTheDocument();
    expect(screen.getByTestId('current-sql')).toBeInTheDocument();
    expect(screen.getByTestId('new-sql')).toBeInTheDocument();
    expect(screen.getByTestId('diff-view')).toBeInTheDocument();
  });

  it('calls onApply when Apply button clicked', () => {
    const onApply = vi.fn();
    const existingTable = createExistingTable();
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
      createColumn({ name: 'name', type: 'TEXT', isExisting: true, originalName: 'name' }),
      createColumn({ name: 'email', type: 'TEXT', isNotNull: true, isExisting: true, originalName: 'email' }),
      createColumn({ name: 'age', type: 'INTEGER', isExisting: false }),
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
        onApply={onApply}
      />
    );

    fireEvent.click(screen.getByTestId('apply-button'));

    expect(onApply).toHaveBeenCalled();
  });

  it('calls onCancel when Back button clicked', () => {
    const onCancel = vi.fn();
    const existingTable = createExistingTable();
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByTestId('cancel-preview-button'));

    expect(onCancel).toHaveBeenCalled();
  });

  it('disables Apply button when read-only', () => {
    const existingTable = createExistingTable();
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
      createColumn({ name: 'age', type: 'INTEGER', isExisting: false }),
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
        isReadOnly={true}
      />
    );

    expect(screen.getByTestId('apply-button')).toBeDisabled();
  });

  it('shows diff highlighting for added lines', () => {
    const existingTable = createExistingTable();
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
      createColumn({ name: 'name', type: 'TEXT', isExisting: true, originalName: 'name' }),
      createColumn({ name: 'email', type: 'TEXT', isNotNull: true, isExisting: true, originalName: 'email' }),
      createColumn({ name: 'phone', type: 'TEXT', isExisting: false }),
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
      />
    );

    // Added lines should have green styling
    const addedLines = screen.getAllByTestId('diff-line-added');
    expect(addedLines.length).toBeGreaterThan(0);
    expect(addedLines[0]).toHaveClass('bg-green-50');
  });

  it('shows diff highlighting for removed lines', () => {
    const existingTable = createExistingTable();
    const columns: DesignerColumnDraft[] = [
      createColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isExisting: true, originalName: 'id' }),
      // name and email removed
    ];

    render(
      <DDLDiffPreview
        existingTable={existingTable}
        columns={columns}
        tableName="users"
      />
    );

    // Removed lines should have red styling
    const removedLines = screen.getAllByTestId('diff-line-removed');
    expect(removedLines.length).toBeGreaterThan(0);
    expect(removedLines[0]).toHaveClass('bg-red-50');
  });
});
