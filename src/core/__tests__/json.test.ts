import { describe, it, expect } from 'vitest';
import { parseJSON, parseJSONFile } from '../io/json';

describe('parseJSON', () => {
  describe('valid input', () => {
    it('parses simple array with columns and rows extracted correctly', () => {
      const input = JSON.stringify([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns).toEqual([
        { name: 'name', type: 'TEXT' },
        { name: 'age', type: 'INTEGER' },
      ]);
      expect(result.rows).toEqual([
        ['Alice', 30],
        ['Bob', 25],
      ]);
    });

    it('infers INTEGER type for numeric integer values', () => {
      const input = JSON.stringify([{ count: 1 }, { count: 2 }, { count: 3 }]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns).toEqual([{ name: 'count', type: 'INTEGER' }]);
    });

    it('infers REAL type for numeric float values', () => {
      const input = JSON.stringify([{ price: 1.5 }, { price: 2.99 }]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns).toEqual([{ name: 'price', type: 'REAL' }]);
    });

    it('promotes INTEGER to REAL when mixed', () => {
      const input = JSON.stringify([{ value: 1 }, { value: 2.5 }]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns).toEqual([{ name: 'value', type: 'REAL' }]);
    });

    it('infers TEXT for mixed numeric and string values', () => {
      const input = JSON.stringify([{ id: 1 }, { id: 'abc' }]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns).toEqual([{ name: 'id', type: 'TEXT' }]);
    });

    it('handles null values correctly', () => {
      const input = JSON.stringify([
        { name: 'Alice', score: 100 },
        { name: 'Bob', score: null },
      ]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns).toEqual([
        { name: 'name', type: 'TEXT' },
        { name: 'score', type: 'INTEGER' },
      ]);
      expect(result.rows).toEqual([
        ['Alice', 100],
        ['Bob', null],
      ]);
    });

    it('handles empty array and returns empty result', () => {
      const input = JSON.stringify([]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns).toEqual([]);
      expect(result.rows).toEqual([]);
    });

    it('handles single object correctly', () => {
      const input = JSON.stringify([{ solo: 'value' }]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns).toEqual([{ name: 'solo', type: 'TEXT' }]);
      expect(result.rows).toEqual([['value']]);
    });

    it('handles inconsistent keys with union of all keys', () => {
      const input = JSON.stringify([
        { a: 1, b: 2 },
        { b: 3, c: 4 },
        { a: 5, c: 6 },
      ]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns).toEqual([
        { name: 'a', type: 'INTEGER' },
        { name: 'b', type: 'INTEGER' },
        { name: 'c', type: 'INTEGER' },
      ]);
      expect(result.rows).toEqual([
        [1, 2, null],
        [null, 3, 4],
        [5, null, 6],
      ]);
    });

    it('converts boolean values to INTEGER type', () => {
      const input = JSON.stringify([
        { active: true },
        { active: false },
      ]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns).toEqual([{ name: 'active', type: 'INTEGER' }]);
      expect(result.rows).toEqual([[true], [false]]);
    });

    it('parses large array (10k objects) without timeout', () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        name: `item_${i}`,
        value: i * 0.5,
      }));
      const input = JSON.stringify(largeArray);

      const start = performance.now();
      const result = parseJSON(input);
      const duration = performance.now() - start;

      expect(result.isValid).toBe(true);
      expect(result.columns).toHaveLength(3);
      expect(result.rows).toHaveLength(10000);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    });
  });

  describe('invalid input', () => {
    it('rejects invalid JSON with descriptive error', () => {
      const input = '{ invalid json }';

      const result = parseJSON(input);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid JSON');
      expect(result.columns).toEqual([]);
      expect(result.rows).toEqual([]);
    });

    it('rejects non-array root with descriptive error', () => {
      const input = JSON.stringify({ not: 'an array' });

      const result = parseJSON(input);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('JSON root must be an array');
    });

    it('rejects array with non-object elements', () => {
      const input = JSON.stringify([1, 2, 3]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('must be an object');
    });

    it('rejects nested objects with descriptive error including line number', () => {
      // Multi-line JSON with nested object on line 4
      const input = `[
  { "name": "test" },
  { "name": "ok" },
  { "name": "bad", "nested": { "foo": 1 } }
]`;

      const result = parseJSON(input);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('nested object');
      expect(result.error).toContain('nested');
      expect(result.error).toMatch(/line 4/i);
    });

    it('rejects array values with descriptive error including line number', () => {
      // Multi-line JSON with array value on line 3
      const input = `[
  { "name": "test" },
  { "name": "bad", "arr": [1, 2, 3] }
]`;

      const result = parseJSON(input);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('array');
      expect(result.error).toContain('arr');
      expect(result.error).toMatch(/line 3/i);
    });

    it('rejects null elements in array', () => {
      const input = `[
  { "a": 1 },
  null,
  { "a": 2 }
]`;

      const result = parseJSON(input);

      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/line 3/i);
      expect(result.error).toContain('must be an object');
    });

    it('rejects mixed array with non-objects', () => {
      const input = `[
  { "a": 1 },
  "string",
  { "a": 2 }
]`;

      const result = parseJSON(input);

      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/line 3/i);
    });
  });

  describe('BLOB placeholder handling', () => {
    it('imports BLOB placeholder object as TEXT with warning', () => {
      const input = JSON.stringify([
        { name: 'test', blob: { __blob_base64__: 'SGVsbG8=', bytes: 5 } },
      ]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns).toEqual([
        { name: 'name', type: 'TEXT' },
        { name: 'blob', type: 'TEXT' },
      ]);
      // BLOB placeholder imported as string representation
      expect(result.rows[0][1]).toBe('{"__blob_base64__":"SGVsbG8=","bytes":5}');
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toMatch(/BLOB placeholder/i);
      expect(result.warnings![0]).toMatch(/line 1/i);
    });

    it('reports multiple BLOB placeholder warnings', () => {
      const input = `[
  { "id": 1, "data": { "__blob_base64__": "AAA=", "bytes": 2 } },
  { "id": 2, "data": { "__blob_base64__": "BBB=", "bytes": 2 } }
]`;

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings![0]).toMatch(/line 2/i);
      expect(result.warnings![1]).toMatch(/line 3/i);
    });
  });

  describe('edge cases', () => {
    it('preserves column order based on first occurrence', () => {
      const input = JSON.stringify([
        { z: 1, a: 2, m: 3 },
        { a: 4, m: 5, z: 6 },
      ]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns.map(c => c.name)).toEqual(['z', 'a', 'm']);
    });

    it('handles empty string values', () => {
      const input = JSON.stringify([{ name: '' }]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.rows).toEqual([['']]);
    });

    it('handles special characters in string values', () => {
      const input = JSON.stringify([
        { text: 'Hello\nWorld' },
        { text: 'Tab\there' },
        { text: 'Quote"test' },
      ]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.rows).toEqual([
        ['Hello\nWorld'],
        ['Tab\there'],
        ['Quote"test'],
      ]);
    });

    it('handles Unicode characters', () => {
      const input = JSON.stringify([
        { emoji: '👋🌍' },
        { emoji: '日本語' },
      ]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.rows).toEqual([['👋🌍'], ['日本語']]);
    });

    it('handles very large numbers', () => {
      const input = JSON.stringify([
        { big: 9007199254740991 }, // Number.MAX_SAFE_INTEGER
        { big: -9007199254740991 },
      ]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      expect(result.columns).toEqual([{ name: 'big', type: 'INTEGER' }]);
    });

    it('handles scientific notation numbers', () => {
      const input = JSON.stringify([
        { sci: 1e10 },
        { sci: 1.5e-3 },
      ]);

      const result = parseJSON(input);

      expect(result.isValid).toBe(true);
      // 1e10 = 10000000000 (integer), 1.5e-3 = 0.0015 (float)
      expect(result.columns).toEqual([{ name: 'sci', type: 'REAL' }]);
    });
  });
});

describe('parseJSONFile', () => {
  it('parses File object correctly', async () => {
    const content = JSON.stringify([{ name: 'test' }]);
    // Use real File constructor - jsdom supports this
    const file = new File([content], 'test.json', { type: 'application/json' });

    const result = await parseJSONFile(file);

    expect(result.isValid).toBe(true);
    expect(result.columns).toEqual([{ name: 'name', type: 'TEXT' }]);
    expect(result.rows).toEqual([['test']]);
  });

  it('handles empty file', async () => {
    const file = new File(['[]'], 'empty.json', { type: 'application/json' });

    const result = await parseJSONFile(file);

    expect(result.isValid).toBe(true);
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
  });
});
