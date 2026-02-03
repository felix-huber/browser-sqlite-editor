import { describe, it, expect, beforeEach } from 'vitest';
import {
  importData,
  createTableAndImport,
  generateCreateTable,
  generateInsertStatement,
  escapeIdentifier,
  decodeBase64,
  type DatabaseExecutor,
  type ImportProgress,
  type ColumnDef,
} from '../io/import';

/**
 * Mock database executor that tracks all SQL operations
 */
function createMockDb() {
  const executedSql: { sql: string; params?: unknown[] }[] = [];
  let shouldFailOnInsert = false;
  let failAtRow = -1;
  let failError = 'UNIQUE constraint failed';
  let insertCount = 0;

  const db: DatabaseExecutor = {
    async exec(sql: string) {
      executedSql.push({ sql });
    },
    async run(sql: string, params?: unknown[]) {
      executedSql.push({ sql, params });
      // Track insert count for failure simulation
      if (sql.startsWith('INSERT')) {
        insertCount += 1;
      }
      if (shouldFailOnInsert && (failAtRow === -1 || insertCount === failAtRow)) {
        throw new Error(failError);
      }
      return { changes: 1 };
    },
  };

  return {
    db,
    executedSql,
    setFailOnInsert: (atRow = -1, error = 'UNIQUE constraint failed') => {
      shouldFailOnInsert = true;
      failAtRow = atRow;
      failError = error;
    },
    reset: () => {
      executedSql.length = 0;
      shouldFailOnInsert = false;
      failAtRow = -1;
      insertCount = 0;
    },
  };
}

describe('escapeIdentifier', () => {
  it('wraps name in double quotes', () => {
    expect(escapeIdentifier('column')).toBe('"column"');
  });

  it('doubles existing double quotes', () => {
    expect(escapeIdentifier('col"name')).toBe('"col""name"');
  });

  it('escapeIdentifier handles empty string', () => {
    expect(escapeIdentifier('')).toBe('""');
  });

  it('handles names with spaces', () => {
    expect(escapeIdentifier('my column')).toBe('"my column"');
  });

  it('handles reserved words', () => {
    expect(escapeIdentifier('SELECT')).toBe('"SELECT"');
  });
});

describe('generateCreateTable', () => {
  it('generates correct CREATE TABLE statement', () => {
    const columns: ColumnDef[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
    ];

    const sql = generateCreateTable('users', columns);

    expect(sql).toBe('CREATE TABLE "users" ("id" INTEGER, "name" TEXT)');
  });

  it('applies type overrides', () => {
    const columns: ColumnDef[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'data', type: 'TEXT' },
    ];

    const sql = generateCreateTable('files', columns, { data: 'BLOB' });

    expect(sql).toBe('CREATE TABLE "files" ("id" INTEGER, "data" BLOB)');
  });

  it('handles column names with special characters', () => {
    const columns: ColumnDef[] = [
      { name: 'user"name', type: 'TEXT' },
    ];

    const sql = generateCreateTable('test', columns);

    expect(sql).toBe('CREATE TABLE "test" ("user""name" TEXT)');
  });

  it('converts NULL type to TEXT', () => {
    const columns: ColumnDef[] = [
      { name: 'maybe', type: 'NULL' as ColumnDef['type'] },
    ];

    const sql = generateCreateTable('test', columns);

    expect(sql).toBe('CREATE TABLE "test" ("maybe" TEXT)');
  });
});

describe('generateInsertStatement', () => {
  it('generates parameterized INSERT statement', () => {
    const columns: ColumnDef[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
    ];

    const sql = generateInsertStatement('users', columns);

    expect(sql).toBe('INSERT INTO "users" ("id", "name") VALUES (?, ?)');
  });

  it('handles single column', () => {
    const columns: ColumnDef[] = [{ name: 'value', type: 'TEXT' }];

    const sql = generateInsertStatement('single', columns);

    expect(sql).toBe('INSERT INTO "single" ("value") VALUES (?)');
  });
});

describe('decodeBase64', () => {
  it('decodes base64 to Uint8Array', () => {
    // "Hello" in base64 is "SGVsbG8="
    const result = decodeBase64('SGVsbG8=');

    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([72, 101, 108, 108, 111]); // "Hello"
  });

  it('decodeBase64 handles empty string', () => {
    const result = decodeBase64('');

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it('handles binary data', () => {
    // Binary data: [0x00, 0xFF, 0x7F]
    const result = decodeBase64('AP9/');

    expect(Array.from(result)).toEqual([0x00, 0xff, 0x7f]);
  });
});

describe('importData', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('imports 1000 rows: all rows inserted', async () => {
    const columns: ColumnDef[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'value', type: 'TEXT' },
    ];
    const rows = Array.from({ length: 1000 }, (_, i) => [i, `value_${i}`]);

    const result = await importData(mockDb.db, {
      tableName: 'test',
      columns,
      rows,
    });

    expect(result.success).toBe(true);
    expect(result.rowsImported).toBe(1000);

    // Check that BEGIN and COMMIT were called
    const beginCount = mockDb.executedSql.filter((s) => s.sql === 'BEGIN TRANSACTION').length;
    const commitCount = mockDb.executedSql.filter((s) => s.sql === 'COMMIT').length;
    expect(beginCount).toBe(1);
    expect(commitCount).toBe(1);

    // Check that 1000 inserts were made
    const insertCount = mockDb.executedSql.filter((s) => s.sql.startsWith('INSERT')).length;
    expect(insertCount).toBe(1000);
  });

  it('constraint violation: 0 rows committed (full rollback)', async () => {
    const columns: ColumnDef[] = [{ name: 'id', type: 'INTEGER' }];
    const rows = Array.from({ length: 100 }, (_, i) => [i]);

    // Fail at row 50
    mockDb.setFailOnInsert(50, 'UNIQUE constraint failed: test.id');

    const result = await importData(mockDb.db, {
      tableName: 'test',
      columns,
      rows,
    });

    expect(result.success).toBe(false);
    expect(result.rowsImported).toBe(0); // Full rollback
    expect(result.error?.type).toBe('CONSTRAINT_VIOLATION');
    expect(result.error?.rowNumber).toBe(50);

    // Check that ROLLBACK was called
    const rollbackCount = mockDb.executedSql.filter((s) => s.sql === 'ROLLBACK').length;
    expect(rollbackCount).toBe(1);
  });

  it('progress events: fire at intervals during import', async () => {
    const columns: ColumnDef[] = [{ name: 'id', type: 'INTEGER' }];
    const rows = Array.from({ length: 250 }, (_, i) => [i]);
    const progressUpdates: ImportProgress[] = [];

    await importData(mockDb.db, {
      tableName: 'test',
      columns,
      rows,
      batchSize: 100,
      onProgress: (progress) => progressUpdates.push({ ...progress }),
    });

    // Should fire 3 times: after 100, 200, 250 rows
    expect(progressUpdates.length).toBe(3);
    expect(progressUpdates[0]).toEqual({ imported: 100, total: 250, percent: 40 });
    expect(progressUpdates[1]).toEqual({ imported: 200, total: 250, percent: 80 });
    expect(progressUpdates[2]).toEqual({ imported: 250, total: 250, percent: 100 });
  });

  it('type mismatch: error with helpful message', async () => {
    const columns: ColumnDef[] = [{ name: 'id', type: 'INTEGER' }];
    const rows = [[1], ['not a number']];

    mockDb.setFailOnInsert(2, 'datatype mismatch');

    const result = await importData(mockDb.db, {
      tableName: 'test',
      columns,
      rows,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('UNKNOWN'); // Not a constraint violation
    expect(result.error?.rowNumber).toBe(2);
  });

  it('handles null values correctly', async () => {
    const columns: ColumnDef[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
    ];
    const rows = [[1, null], [2, 'Alice']];

    const result = await importData(mockDb.db, {
      tableName: 'test',
      columns,
      rows,
    });

    expect(result.success).toBe(true);

    // Check that null was passed correctly
    const insertCalls = mockDb.executedSql.filter((s) => s.sql.startsWith('INSERT'));
    expect(insertCalls[0].params).toEqual([1, null]);
    expect(insertCalls[1].params).toEqual([2, 'Alice']);
  });

  it('handles empty rows array', async () => {
    const columns: ColumnDef[] = [{ name: 'id', type: 'INTEGER' }];
    const rows: unknown[][] = [];

    const result = await importData(mockDb.db, {
      tableName: 'test',
      columns,
      rows,
    });

    expect(result.success).toBe(true);
    expect(result.rowsImported).toBe(0);

    // Transaction should still be started and committed
    const beginCount = mockDb.executedSql.filter((s) => s.sql === 'BEGIN TRANSACTION').length;
    const commitCount = mockDb.executedSql.filter((s) => s.sql === 'COMMIT').length;
    expect(beginCount).toBe(1);
    expect(commitCount).toBe(1);
  });

  it('large import (10k rows): completes successfully, progress updates throughout', async () => {
    // Note: We test with 10k rows instead of 100k because the async mock overhead
    // makes 100k too slow. Real SQLite performance would be much better.
    const columns: ColumnDef[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
      { name: 'value', type: 'REAL' },
    ];
    const rows = Array.from({ length: 10000 }, (_, i) => [i, `name_${i}`, i * 0.5]);
    const progressUpdates: ImportProgress[] = [];

    const start = performance.now();
    const result = await importData(mockDb.db, {
      tableName: 'large_test',
      columns,
      rows,
      batchSize: 1000, // Larger batch for performance test
      onProgress: (progress) => progressUpdates.push({ ...progress }),
    });
    const duration = performance.now() - start;

    expect(result.success).toBe(true);
    expect(result.rowsImported).toBe(10000);
    expect(duration).toBeLessThan(30000); // Should complete in under 30 seconds

    // Should have 10 progress updates (10k / 1000 batch size)
    expect(progressUpdates.length).toBe(10);
    expect(progressUpdates[progressUpdates.length - 1].percent).toBe(100);
  });

  it('NOT NULL constraint violation: full rollback', async () => {
    const columns: ColumnDef[] = [{ name: 'id', type: 'INTEGER' }];
    const rows = [[1], [null], [3]];

    mockDb.setFailOnInsert(2, 'NOT NULL constraint failed: test.id');

    const result = await importData(mockDb.db, {
      tableName: 'test',
      columns,
      rows,
    });

    expect(result.success).toBe(false);
    expect(result.rowsImported).toBe(0);
    expect(result.error?.type).toBe('CONSTRAINT_VIOLATION');
    expect(result.error?.message).toContain('NOT NULL');
  });

  it('FOREIGN KEY constraint violation: full rollback', async () => {
    const columns: ColumnDef[] = [{ name: 'parent_id', type: 'INTEGER' }];
    const rows = [[999]]; // Non-existent parent

    mockDb.setFailOnInsert(1, 'FOREIGN KEY constraint failed');

    const result = await importData(mockDb.db, {
      tableName: 'child',
      columns,
      rows,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('CONSTRAINT_VIOLATION');
    expect(result.error?.message).toContain('FOREIGN KEY');
  });

  it('quota exceeded: full rollback with QUOTA_EXCEEDED error', async () => {
    const columns: ColumnDef[] = [{ name: 'data', type: 'TEXT' }];
    const rows = [['large data']];

    mockDb.setFailOnInsert(1, 'disk full or quota exceeded');

    const result = await importData(mockDb.db, {
      tableName: 'test',
      columns,
      rows,
    });

    expect(result.success).toBe(false);
    expect(result.rowsImported).toBe(0);
    expect(result.error?.type).toBe('QUOTA_EXCEEDED');
  });
});

describe('createTableAndImport', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('creates table and imports data in single transaction', async () => {
    const columns: ColumnDef[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
    ];
    const rows = [[1, 'Alice'], [2, 'Bob']];

    const result = await createTableAndImport(mockDb.db, {
      tableName: 'users',
      columns,
      rows,
    });

    expect(result.success).toBe(true);
    expect(result.rowsImported).toBe(2);

    // Check execution order
    expect(mockDb.executedSql[0].sql).toBe('BEGIN TRANSACTION');
    expect(mockDb.executedSql[1].sql).toBe('CREATE TABLE "users" ("id" INTEGER, "name" TEXT)');
    expect(mockDb.executedSql[2].sql).toContain('INSERT INTO "users"');
    expect(mockDb.executedSql[mockDb.executedSql.length - 1].sql).toBe('COMMIT');
  });

  it('rolls back table creation on insert failure', async () => {
    const columns: ColumnDef[] = [{ name: 'id', type: 'INTEGER' }];
    const rows = [[1], [2]];

    mockDb.setFailOnInsert(2, 'UNIQUE constraint failed');

    const result = await createTableAndImport(mockDb.db, {
      tableName: 'test',
      columns,
      rows,
    });

    expect(result.success).toBe(false);
    expect(result.rowsImported).toBe(0);

    // Table should be rolled back too
    const rollbackCount = mockDb.executedSql.filter((s) => s.sql === 'ROLLBACK').length;
    expect(rollbackCount).toBe(1);
  });

  it('JSON with base64 BLOB: decoded and inserted as BLOB', async () => {
    const columns: ColumnDef[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'data', type: 'TEXT' },
    ];
    // "Hello" in base64
    const rows = [[1, 'SGVsbG8=']];

    const result = await createTableAndImport(mockDb.db, {
      tableName: 'files',
      columns,
      rows,
      typeOverrides: { data: 'BLOB' },
    });

    expect(result.success).toBe(true);

    // Check CREATE TABLE uses BLOB
    const createSql = mockDb.executedSql.find((s) => s.sql.startsWith('CREATE'));
    expect(createSql?.sql).toContain('BLOB');

    // Check INSERT used decoded bytes
    const insertSql = mockDb.executedSql.find((s) => s.sql.startsWith('INSERT'));
    const blobValue = insertSql?.params?.[1] as Uint8Array;
    expect(blobValue).toBeInstanceOf(Uint8Array);
    expect(Array.from(blobValue)).toEqual([72, 101, 108, 108, 111]); // "Hello"
  });

  it('fires progress during createTableAndImport', async () => {
    const columns: ColumnDef[] = [{ name: 'id', type: 'INTEGER' }];
    const rows = Array.from({ length: 300 }, (_, i) => [i]);
    const progressUpdates: ImportProgress[] = [];

    await createTableAndImport(mockDb.db, {
      tableName: 'test',
      columns,
      rows,
      batchSize: 100,
      onProgress: (progress) => progressUpdates.push({ ...progress }),
    });

    expect(progressUpdates.length).toBe(3);
    expect(progressUpdates[2].percent).toBe(100);
  });

  it('handles invalid base64 in BLOB column', async () => {
    const columns: ColumnDef[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'data', type: 'TEXT' },
    ];
    const rows = [[1, 'not-valid-base64!!!']];

    const result = await createTableAndImport(mockDb.db, {
      tableName: 'files',
      columns,
      rows,
      typeOverrides: { data: 'BLOB' },
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid base64');
  });
});
