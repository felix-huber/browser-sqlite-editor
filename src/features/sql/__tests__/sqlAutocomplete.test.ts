import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete';
import {
  createSqlCompletionSource,
  createEmptySchema,
  type AutocompleteSchema,
} from '../sqlAutocomplete';
import type { ColumnInfo } from '../../../types';

/**
 * Helper to create a mock CompletionContext for testing
 */
function createCompletionContext(
  doc: string,
  pos: number,
  explicit = true
): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, explicit);
}

/**
 * Get completions synchronously (our source is sync)
 */
function getCompletions(
  schema: AutocompleteSchema,
  doc: string,
  pos: number,
  explicit = true
): CompletionResult | null {
  const source = createSqlCompletionSource(() => schema);
  const context = createCompletionContext(doc, pos, explicit);
  const result = source(context);
  // Our source is synchronous, so this should be a direct result
  return result as CompletionResult | null;
}

/**
 * Helper to filter completions by type
 */
function filterByType(options: readonly Completion[], type: string): Completion[] {
  return options.filter((opt) => opt.type === type);
}

/**
 * Helper to get labels from completions
 */
function getLabels(options: readonly Completion[]): string[] {
  return options.map((opt) => opt.label);
}

/**
 * Helper to create a test schema
 */
function createTestSchema(): AutocompleteSchema {
  const usersColumns: ColumnInfo[] = [
    { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
    { cid: 1, name: 'name', type: 'TEXT', notnull: true, dfltValue: null, pk: 0, generated: null, hidden: false },
    { cid: 2, name: 'email', type: 'TEXT', notnull: false, dfltValue: null, pk: 0, generated: null, hidden: false },
    { cid: 3, name: 'full_name', type: 'TEXT', notnull: false, dfltValue: null, pk: 0, generated: 'virtual', hidden: false },
    { cid: 4, name: 'created_at', type: 'TEXT', notnull: true, dfltValue: null, pk: 0, generated: 'stored', hidden: false },
  ];

  const ordersColumns: ColumnInfo[] = [
    { cid: 0, name: 'order_id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
    { cid: 1, name: 'user_id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 0, generated: null, hidden: false },
    { cid: 2, name: 'total', type: 'REAL', notnull: false, dfltValue: null, pk: 0, generated: null, hidden: false },
  ];

  const productsColumns: ColumnInfo[] = [
    { cid: 0, name: 'product_id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
    { cid: 1, name: 'name', type: 'TEXT', notnull: true, dfltValue: null, pk: 0, generated: null, hidden: false },
    { cid: 2, name: 'price', type: 'REAL', notnull: false, dfltValue: null, pk: 0, generated: null, hidden: false },
  ];

  return {
    tables: new Map([
      ['users', usersColumns],
      ['orders', ordersColumns],
      ['products', productsColumns],
    ]),
    views: ['active_users', 'order_summary'],
  };
}

describe('sqlAutocomplete', () => {
  describe('createEmptySchema', () => {
    it('returns an empty schema with no tables or views', () => {
      const schema = createEmptySchema();
      expect(schema.tables.size).toBe(0);
      expect(schema.views.length).toBe(0);
    });
  });

  describe('createSqlCompletionSource', () => {
    describe('table name completions', () => {
      it('"SELECT * FROM " → table names suggested', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT * FROM ', 14);

        expect(result).not.toBeNull();
        expect(result!.options).toBeDefined();

        const tableLabels = getLabels(filterByType(result!.options, 'class'));

        expect(tableLabels).toContain('users');
        expect(tableLabels).toContain('orders');
        expect(tableLabels).toContain('products');
      });

      it('suggests tables after JOIN keyword', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT * FROM users JOIN ', 25);

        expect(result).not.toBeNull();
        const tableLabels = getLabels(filterByType(result!.options, 'class'));

        expect(tableLabels).toContain('orders');
        expect(tableLabels).toContain('products');
      });

      it('suggests tables after INTO keyword', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'INSERT INTO ', 12);

        expect(result).not.toBeNull();
        const tableLabels = getLabels(filterByType(result!.options, 'class'));

        expect(tableLabels).toContain('users');
      });

      it('suggests tables after UPDATE keyword', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'UPDATE ', 7);

        expect(result).not.toBeNull();
        const tableLabels = getLabels(filterByType(result!.options, 'class'));

        expect(tableLabels).toContain('users');
      });

      it('suggests views as well as tables', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT * FROM ', 14);

        expect(result).not.toBeNull();
        const viewLabels = getLabels(filterByType(result!.options, 'interface'));

        expect(viewLabels).toContain('active_users');
        expect(viewLabels).toContain('order_summary');
      });

      it('filters tables by prefix match', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT * FROM us', 16);

        expect(result).not.toBeNull();
        const tableLabels = getLabels(filterByType(result!.options, 'class'));

        expect(tableLabels).toContain('users');
      });
    });

    describe('column name completions', () => {
      it('"SELECT " after table selected → column names from that table', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT  FROM users', 7);

        expect(result).not.toBeNull();
        const columnLabels = getLabels(
          result!.options.filter((opt) => opt.type === 'property' || opt.type === 'function')
        );

        expect(columnLabels).toContain('id');
        expect(columnLabels).toContain('name');
        expect(columnLabels).toContain('email');
      });

      it('"SELECT " with JOIN → columns from all joined tables', () => {
        const schema = createTestSchema();
        const result = getCompletions(
          schema,
          'SELECT  FROM users JOIN orders ON users.id = orders.user_id',
          7
        );

        expect(result).not.toBeNull();
        const columnLabels = getLabels(
          result!.options.filter((opt) => opt.type === 'property' || opt.type === 'function')
        );

        // Should contain columns from both users and orders
        // With multi-table query, columns are prefixed with table name
        expect(columnLabels.some((l) => l.includes('id') || l.includes('users.id'))).toBe(true);
        expect(columnLabels.some((l) => l.includes('order_id') || l.includes('orders.order_id'))).toBe(true);
      });

      it('suggests columns after WHERE keyword', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT * FROM users WHERE ', 26);

        expect(result).not.toBeNull();
        const columnLabels = getLabels(
          result!.options.filter((opt) => opt.type === 'property' || opt.type === 'function')
        );

        expect(columnLabels).toContain('id');
        expect(columnLabels).toContain('name');
      });

      it('suggests columns after ORDER BY', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT * FROM users ORDER BY ', 29);

        expect(result).not.toBeNull();
        const columnLabels = getLabels(
          result!.options.filter((opt) => opt.type === 'property' || opt.type === 'function')
        );

        expect(columnLabels).toContain('id');
        expect(columnLabels).toContain('name');
      });

      it('suggests columns after GROUP BY', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT * FROM users GROUP BY ', 29);

        expect(result).not.toBeNull();
        const columnLabels = getLabels(
          result!.options.filter((opt) => opt.type === 'property' || opt.type === 'function')
        );

        expect(columnLabels).toContain('id');
        expect(columnLabels).toContain('name');
      });
    });

    describe('generated column indicator', () => {
      it('generated column shows indicator with type "function"', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT * FROM users WHERE full', 30);

        expect(result).not.toBeNull();

        // Find the full_name column
        const fullNameOption = result!.options.find(
          (opt) => opt.label === 'full_name'
        );

        expect(fullNameOption).toBeDefined();
        expect(fullNameOption!.type).toBe('function'); // Generated columns use 'function' type
        expect(fullNameOption!.detail).toContain('virtual');
      });

      it('stored generated column has appropriate detail', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT * FROM users WHERE created', 33);

        expect(result).not.toBeNull();

        const createdAtOption = result!.options.find(
          (opt) => opt.label === 'created_at'
        );

        expect(createdAtOption).toBeDefined();
        expect(createdAtOption!.type).toBe('function'); // Generated columns use 'function' type
        expect(createdAtOption!.detail).toContain('stored');
      });

      it('regular columns use "property" type', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT * FROM users WHERE na', 28);

        expect(result).not.toBeNull();

        const nameOption = result!.options.find((opt) => opt.label === 'name');

        expect(nameOption).toBeDefined();
        expect(nameOption!.type).toBe('property'); // Regular columns use 'property' type
      });

      it('primary key column shows PK in detail', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT * FROM users WHERE i', 27);

        expect(result).not.toBeNull();

        const idOption = result!.options.find((opt) => opt.label === 'id');

        expect(idOption).toBeDefined();
        expect(idOption!.detail).toContain('PK');
      });
    });

    describe('keyword completions', () => {
      it('reserved word triggers keyword completion', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SEL', 3);

        expect(result).not.toBeNull();
        const keywordLabels = getLabels(filterByType(result!.options, 'keyword'));

        expect(keywordLabels).toContain('SELECT');
      });

      it('suggests keywords matching prefix', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'WH', 2);

        expect(result).not.toBeNull();
        const keywordLabels = getLabels(filterByType(result!.options, 'keyword'));

        expect(keywordLabels).toContain('WHERE');
        expect(keywordLabels).toContain('WITH');
        expect(keywordLabels).toContain('WHEN');
      });

      it('suggests JOIN keywords', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'JO', 2);

        expect(result).not.toBeNull();
        const keywordLabels = getLabels(filterByType(result!.options, 'keyword'));

        expect(keywordLabels).toContain('JOIN');
      });
    });

    describe('completion priority', () => {
      it('exact match > prefix match > fuzzy match', () => {
        const schema: AutocompleteSchema = {
          tables: new Map([
            ['user', []],
            ['users', []],
            ['user_data', []],
          ]),
          views: [],
        };
        const result = getCompletions(schema, 'SELECT * FROM user', 18);

        expect(result).not.toBeNull();
        const tableOptions = filterByType(result!.options, 'class');

        // Find the positions
        const userPos = tableOptions.findIndex((opt) => opt.label === 'user');
        const usersPos = tableOptions.findIndex((opt) => opt.label === 'users');
        const userDataPos = tableOptions.findIndex((opt) => opt.label === 'user_data');

        // Exact match should be first
        expect(userPos).toBe(0);
        // Prefix matches should come next
        expect(usersPos).toBeLessThan(userDataPos);
      });
    });

    describe('schema refresh', () => {
      it('uses updated schema when it changes', () => {
        let schema = createEmptySchema();
        const source = createSqlCompletionSource(() => schema);

        // Initially no tables
        const context1 = createCompletionContext('SELECT * FROM ', 14);
        const result1 = source(context1) as CompletionResult | null;
        const tableCount1 = result1?.options.filter((opt) => opt.type === 'class').length ?? 0;
        expect(tableCount1).toBe(0);

        // Update schema
        schema = createTestSchema();

        // Now should have tables
        const context2 = createCompletionContext('SELECT * FROM ', 14);
        const result2 = source(context2) as CompletionResult | null;
        const tableCount2 = result2?.options.filter((opt) => opt.type === 'class').length ?? 0;
        expect(tableCount2).toBe(3);
      });
    });

    describe('edge cases', () => {
      it('returns null when no word started and not explicit', () => {
        const schema = createTestSchema();
        const result = getCompletions(schema, 'SELECT * FROM ', 14, false);

        // With explicit=false (implicit completion), empty word should return null
        expect(result).toBeNull();
      });

      it('handles empty schema gracefully', () => {
        const schema = createEmptySchema();
        const result = getCompletions(schema, 'SELECT * FROM ', 14);

        // Should still return keyword completions
        expect(result).not.toBeNull();
        const keywordLabels = getLabels(filterByType(result!.options, 'keyword'));

        expect(keywordLabels.length).toBeGreaterThan(0);
      });

      it('handles special characters in table names', () => {
        const schema: AutocompleteSchema = {
          tables: new Map([['my_table_2024', []]]),
          views: [],
        };
        const result = getCompletions(schema, 'SELECT * FROM my_', 17);

        expect(result).not.toBeNull();
        const tableLabels = getLabels(filterByType(result!.options, 'class'));

        expect(tableLabels).toContain('my_table_2024');
      });
    });
  });
});
