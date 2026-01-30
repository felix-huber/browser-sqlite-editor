import { describe, it, expect } from 'vitest';
import {
  exportToCSV,
  exportToJSON,
  exportSchemaToDDL,
  exportMultipleSchemaToDDL,
  type DDLTableInfo,
} from '../io/export';

describe('exportToCSV', () => {
  describe('basic functionality', () => {
    it('exports simple data with header', () => {
      const columns = ['name', 'age'];
      const rows = [
        ['Alice', 30],
        ['Bob', 25],
      ];

      const csv = exportToCSV(columns, rows);

      // Check BOM is present
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      // Check content (after BOM)
      const content = csv.slice(1);
      expect(content).toContain('name,age');
      expect(content).toContain('Alice,30');
      expect(content).toContain('Bob,25');
    });

    it('exports without header when includeHeader is false', () => {
      const columns = ['name', 'age'];
      const rows = [['Alice', 30]];

      const csv = exportToCSV(columns, rows, { includeHeader: false });

      const content = csv.slice(1); // Skip BOM
      expect(content).not.toContain('name,age');
      expect(content).toContain('Alice,30');
    });

    it('exports without BOM when includeBOM is false', () => {
      const columns = ['name'];
      const rows = [['Alice']];

      const csv = exportToCSV(columns, rows, { includeBOM: false });

      expect(csv.charCodeAt(0)).not.toBe(0xfeff);
      expect(csv).toBe('name\r\nAlice');
    });

    it('handles null values', () => {
      const columns = ['name', 'age'];
      const rows = [[null, 30], ['Bob', null]];

      const csv = exportToCSV(columns, rows, { includeBOM: false });

      expect(csv).toContain(',30');
      expect(csv).toContain('Bob,');
    });

    it('handles empty rows', () => {
      const columns = ['name', 'age'];
      const rows: unknown[][] = [];

      const csv = exportToCSV(columns, rows, { includeBOM: false });

      expect(csv).toBe('name,age');
    });
  });

  describe('BLOB handling', () => {
    it('converts BLOB to hex string by default', () => {
      const columns = ['id', 'data'];
      const rows = [[1, new Uint8Array([0xde, 0xad, 0xbe, 0xef])]];

      const csv = exportToCSV(columns, rows, { includeBOM: false });

      expect(csv).toContain('deadbeef');
    });

    it('replaces BLOB with placeholder when blobHandling is omit', () => {
      const columns = ['id', 'data'];
      const rows = [[1, new Uint8Array([0xde, 0xad])]];

      const csv = exportToCSV(columns, rows, {
        includeBOM: false,
        blobHandling: 'omit',
      });

      expect(csv).toContain('[BLOB]');
      expect(csv).not.toContain('dead');
    });

    it('uses custom placeholder for omitted BLOBs', () => {
      const columns = ['id', 'data'];
      const rows = [[1, new Uint8Array([0x01])]];

      const csv = exportToCSV(columns, rows, {
        includeBOM: false,
        blobHandling: 'omit',
        blobPlaceholder: '<binary>',
      });

      expect(csv).toContain('<binary>');
    });

    it('handles empty BLOB', () => {
      const columns = ['data'];
      const rows = [[new Uint8Array([])]];

      const csv = exportToCSV(columns, rows, { includeBOM: false });

      // Empty hex string
      expect(csv).toBe('data\r\n');
    });
  });

  describe('CSV with BOM for Excel compatibility', () => {
    it('file starts with UTF-8 BOM', () => {
      const columns = ['test'];
      const rows = [['value']];

      const csv = exportToCSV(columns, rows);

      // UTF-8 BOM is U+FEFF
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv.startsWith('\uFEFF')).toBe(true);
    });
  });

  describe('special characters', () => {
    it('properly quotes values with commas', () => {
      const columns = ['text'];
      const rows = [['hello, world']];

      const csv = exportToCSV(columns, rows, { includeBOM: false });

      expect(csv).toContain('"hello, world"');
    });

    it('properly escapes quotes in values', () => {
      const columns = ['quote'];
      const rows = [['She said "hello"']];

      const csv = exportToCSV(columns, rows, { includeBOM: false });

      expect(csv).toContain('"She said ""hello"""');
    });

    it('handles newlines in values', () => {
      const columns = ['text'];
      const rows = [['line1\nline2']];

      const csv = exportToCSV(columns, rows, { includeBOM: false });

      expect(csv).toContain('"line1\nline2"');
    });
  });
});

describe('exportToJSON', () => {
  describe('basic functionality', () => {
    it('exports data as array of objects', () => {
      const columns = ['name', 'age'];
      const rows = [
        ['Alice', 30],
        ['Bob', 25],
      ];

      const json = exportToJSON(columns, rows);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);
    });

    it('exports without pretty printing when pretty is false', () => {
      const columns = ['name'];
      const rows = [['Alice']];

      const json = exportToJSON(columns, rows, { pretty: false });

      expect(json).toBe('[{"name":"Alice"}]');
      expect(json).not.toContain('\n');
    });

    it('uses custom indentation', () => {
      const columns = ['name'];
      const rows = [['Alice']];

      const json = exportToJSON(columns, rows, { indent: 4 });

      expect(json).toContain('    "name"');
    });

    it('handles null values', () => {
      const columns = ['name', 'age'];
      const rows = [[null, 30]];

      const json = exportToJSON(columns, rows);
      const parsed = JSON.parse(json);

      expect(parsed[0]).toEqual({ name: null, age: 30 });
    });

    it('handles empty rows', () => {
      const columns = ['name'];
      const rows: unknown[][] = [];

      const json = exportToJSON(columns, rows);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual([]);
    });
  });

  describe('BLOB handling', () => {
    it('encodes BLOB as base64 with prefix', () => {
      const columns = ['id', 'data'];
      const rows = [[1, new Uint8Array([72, 101, 108, 108, 111])]]; // "Hello"

      const json = exportToJSON(columns, rows);
      const parsed = JSON.parse(json);

      expect(parsed[0].data).toBe('base64:SGVsbG8=');
    });

    it('handles empty BLOB', () => {
      const columns = ['data'];
      const rows = [[new Uint8Array([])]];

      const json = exportToJSON(columns, rows);
      const parsed = JSON.parse(json);

      expect(parsed[0].data).toBe('base64:');
    });

    it('handles BLOB with binary data', () => {
      const columns = ['data'];
      const rows = [[new Uint8Array([0x00, 0xff, 0x80, 0x7f])]];

      const json = exportToJSON(columns, rows);
      const parsed = JSON.parse(json);

      // Verify it's a valid base64 string
      expect(parsed[0].data).toMatch(/^base64:[A-Za-z0-9+/]*=*$/);
    });
  });

  describe('special values', () => {
    it('handles boolean values', () => {
      const columns = ['active'];
      const rows = [[true], [false]];

      const json = exportToJSON(columns, rows);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual([{ active: true }, { active: false }]);
    });

    it('handles numeric values', () => {
      const columns = ['int', 'float'];
      const rows = [[42, 3.14]];

      const json = exportToJSON(columns, rows);
      const parsed = JSON.parse(json);

      expect(parsed[0]).toEqual({ int: 42, float: 3.14 });
    });

    it('handles special characters in strings', () => {
      const columns = ['text'];
      const rows = [['line1\nline2\ttab"quote']];

      const json = exportToJSON(columns, rows);
      const parsed = JSON.parse(json);

      expect(parsed[0].text).toBe('line1\nline2\ttab"quote');
    });

    it('handles unicode characters', () => {
      const columns = ['text'];
      const rows = [['Hello World']];

      const json = exportToJSON(columns, rows);
      const parsed = JSON.parse(json);

      expect(parsed[0].text).toBe('Hello World');
    });
  });
});

describe('exportSchemaToDDL', () => {
  describe('basic table creation', () => {
    it('creates simple table with columns', () => {
      const tableInfo: DDLTableInfo = {
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', notNull: false, defaultValue: null, primaryKey: 0 },
          { name: 'name', type: 'TEXT', notNull: false, defaultValue: null, primaryKey: 0 },
        ],
      };

      const ddl = exportSchemaToDDL(tableInfo);

      expect(ddl).toBe(
        'CREATE TABLE "users" (\n  "id" INTEGER,\n  "name" TEXT\n);'
      );
    });

    it('creates table with single column primary key', () => {
      const tableInfo: DDLTableInfo = {
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', notNull: true, defaultValue: null, primaryKey: 1 },
          { name: 'name', type: 'TEXT', notNull: false, defaultValue: null, primaryKey: 0 },
        ],
      };

      const ddl = exportSchemaToDDL(tableInfo);

      expect(ddl).toContain('"id" INTEGER PRIMARY KEY');
      expect(ddl).not.toContain('PRIMARY KEY (');
    });

    it('creates table with composite primary key', () => {
      const tableInfo: DDLTableInfo = {
        name: 'order_items',
        columns: [
          { name: 'order_id', type: 'INTEGER', notNull: true, defaultValue: null, primaryKey: 1 },
          { name: 'item_id', type: 'INTEGER', notNull: true, defaultValue: null, primaryKey: 2 },
          { name: 'quantity', type: 'INTEGER', notNull: false, defaultValue: null, primaryKey: 0 },
        ],
      };

      const ddl = exportSchemaToDDL(tableInfo);

      expect(ddl).toContain('PRIMARY KEY ("order_id", "item_id")');
      expect(ddl).not.toContain('"order_id" INTEGER PRIMARY KEY');
    });

    it('handles NOT NULL constraint', () => {
      const tableInfo: DDLTableInfo = {
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', notNull: false, defaultValue: null, primaryKey: 0 },
          { name: 'email', type: 'TEXT', notNull: true, defaultValue: null, primaryKey: 0 },
        ],
      };

      const ddl = exportSchemaToDDL(tableInfo);

      expect(ddl).toContain('"email" TEXT NOT NULL');
      expect(ddl).not.toContain('"id" INTEGER NOT NULL');
    });

    it('handles DEFAULT value', () => {
      const tableInfo: DDLTableInfo = {
        name: 'settings',
        columns: [
          { name: 'key', type: 'TEXT', notNull: false, defaultValue: null, primaryKey: 0 },
          { name: 'value', type: 'TEXT', notNull: false, defaultValue: "''", primaryKey: 0 },
          { name: 'count', type: 'INTEGER', notNull: false, defaultValue: '0', primaryKey: 0 },
        ],
      };

      const ddl = exportSchemaToDDL(tableInfo);

      expect(ddl).toContain("\"value\" TEXT DEFAULT ''");
      expect(ddl).toContain('"count" INTEGER DEFAULT 0');
    });

    it('handles WITHOUT ROWID tables', () => {
      const tableInfo: DDLTableInfo = {
        name: 'cache',
        columns: [
          { name: 'key', type: 'TEXT', notNull: true, defaultValue: null, primaryKey: 1 },
          { name: 'value', type: 'BLOB', notNull: false, defaultValue: null, primaryKey: 0 },
        ],
        withoutRowid: true,
      };

      const ddl = exportSchemaToDDL(tableInfo);

      expect(ddl).toContain('WITHOUT ROWID');
      expect(ddl).toMatch(/\)\s*WITHOUT ROWID;$/);
    });
  });

  describe('identifier escaping', () => {
    it('escapes reserved words in table names', () => {
      const tableInfo: DDLTableInfo = {
        name: 'select',
        columns: [
          { name: 'from', type: 'TEXT', notNull: false, defaultValue: null, primaryKey: 0 },
        ],
      };

      const ddl = exportSchemaToDDL(tableInfo);

      expect(ddl).toContain('CREATE TABLE "select"');
      expect(ddl).toContain('"from" TEXT');
    });

    it('escapes quotes in identifiers', () => {
      const tableInfo: DDLTableInfo = {
        name: 'my"table',
        columns: [
          { name: 'col"name', type: 'TEXT', notNull: false, defaultValue: null, primaryKey: 0 },
        ],
      };

      const ddl = exportSchemaToDDL(tableInfo);

      expect(ddl).toContain('CREATE TABLE "my""table"');
      expect(ddl).toContain('"col""name" TEXT');
    });

    it('handles spaces in identifiers', () => {
      const tableInfo: DDLTableInfo = {
        name: 'my table',
        columns: [
          { name: 'column name', type: 'TEXT', notNull: false, defaultValue: null, primaryKey: 0 },
        ],
      };

      const ddl = exportSchemaToDDL(tableInfo);

      expect(ddl).toContain('CREATE TABLE "my table"');
      expect(ddl).toContain('"column name" TEXT');
    });
  });
});

describe('exportMultipleSchemaToDDL', () => {
  it('exports multiple tables separated by double newlines', () => {
    const tables: DDLTableInfo[] = [
      {
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', notNull: false, defaultValue: null, primaryKey: 1 },
        ],
      },
      {
        name: 'posts',
        columns: [
          { name: 'id', type: 'INTEGER', notNull: false, defaultValue: null, primaryKey: 1 },
        ],
      },
    ];

    const ddl = exportMultipleSchemaToDDL(tables);

    expect(ddl).toContain('CREATE TABLE "users"');
    expect(ddl).toContain('CREATE TABLE "posts"');
    expect(ddl).toContain(';\n\nCREATE TABLE');
  });

  it('handles empty array', () => {
    const ddl = exportMultipleSchemaToDDL([]);

    expect(ddl).toBe('');
  });

  it('handles single table', () => {
    const tables: DDLTableInfo[] = [
      {
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', notNull: false, defaultValue: null, primaryKey: 1 },
        ],
      },
    ];

    const ddl = exportMultipleSchemaToDDL(tables);

    expect(ddl).toBe('CREATE TABLE "users" (\n  "id" INTEGER PRIMARY KEY\n);');
  });
});
