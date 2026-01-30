/**
 * Unit tests for FK relationship query utilities
 *
 * Tests the parsing of PRAGMA foreign_key_list results and
 * the ForeignKeyGraph navigation helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  parseForeignKeyList,
  ForeignKeyGraph,
  buildForeignKeyGraph,
} from '../db/fk-query';
import type { ForeignKeyInfo, QueryResult } from '../../types';

/**
 * Helper to create a mock QueryResult from PRAGMA foreign_key_list
 */
function createFKListResult(
  rows: Array<[number, number, string, string, string, string, string, string]>
): QueryResult {
  return {
    columns: ['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'],
    columnTypes: ['INTEGER', 'INTEGER', 'TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT'],
    rows,
  };
}

describe('parseForeignKeyList', () => {
  it('should return empty array for no FKs', () => {
    const result = createFKListResult([]);
    const fks = parseForeignKeyList('child_table', result);

    expect(fks).toEqual([]);
  });

  it('should parse single FK correctly', () => {
    const result = createFKListResult([
      [0, 0, 'parent_table', 'parent_id', 'id', 'NO ACTION', 'CASCADE', 'NONE'],
    ]);

    const fks = parseForeignKeyList('child_table', result);

    expect(fks).toHaveLength(1);
    expect(fks[0]).toEqual({
      id: 0,
      childTable: 'child_table',
      childColumn: 'parent_id',
      parentTable: 'parent_table',
      parentColumn: 'id',
      onUpdate: 'NO ACTION',
      onDelete: 'CASCADE',
      match: 'NONE',
    });
  });

  it('should parse multiple FKs from same table', () => {
    const result = createFKListResult([
      [0, 0, 'users', 'user_id', 'id', 'NO ACTION', 'CASCADE', 'NONE'],
      [1, 0, 'products', 'product_id', 'id', 'NO ACTION', 'SET NULL', 'NONE'],
    ]);

    const fks = parseForeignKeyList('orders', result);

    expect(fks).toHaveLength(2);
    expect(fks[0].parentTable).toBe('users');
    expect(fks[0].childColumn).toBe('user_id');
    expect(fks[0].onDelete).toBe('CASCADE');
    expect(fks[1].parentTable).toBe('products');
    expect(fks[1].childColumn).toBe('product_id');
    expect(fks[1].onDelete).toBe('SET NULL');
  });

  it('should handle self-referential FK', () => {
    const result = createFKListResult([
      [0, 0, 'employees', 'manager_id', 'id', 'NO ACTION', 'SET NULL', 'NONE'],
    ]);

    const fks = parseForeignKeyList('employees', result);

    expect(fks).toHaveLength(1);
    expect(fks[0].childTable).toBe('employees');
    expect(fks[0].parentTable).toBe('employees');
  });

  it('should parse multi-column FK (composite key)', () => {
    // Multi-column FK has same id but different seq
    const result = createFKListResult([
      [0, 0, 'parent', 'col_a', 'pk_a', 'CASCADE', 'CASCADE', 'NONE'],
      [0, 1, 'parent', 'col_b', 'pk_b', 'CASCADE', 'CASCADE', 'NONE'],
    ]);

    const fks = parseForeignKeyList('child', result);

    expect(fks).toHaveLength(2);
    // Both entries have same id
    expect(fks[0].id).toBe(0);
    expect(fks[1].id).toBe(0);
    // Different columns
    expect(fks[0].childColumn).toBe('col_a');
    expect(fks[0].parentColumn).toBe('pk_a');
    expect(fks[1].childColumn).toBe('col_b');
    expect(fks[1].parentColumn).toBe('pk_b');
  });

  it('should normalize action names to uppercase', () => {
    const result = createFKListResult([
      [0, 0, 'parent', 'fk_col', 'id', 'cascade', 'set null', 'NONE'],
    ]);

    const fks = parseForeignKeyList('child', result);

    expect(fks[0].onUpdate).toBe('CASCADE');
    expect(fks[0].onDelete).toBe('SET NULL');
  });

  it('should handle all FK action types', () => {
    const actions: Array<[string, string]> = [
      ['NO ACTION', 'NO ACTION'],
      ['RESTRICT', 'RESTRICT'],
      ['SET NULL', 'SET NULL'],
      ['SET DEFAULT', 'SET DEFAULT'],
      ['CASCADE', 'CASCADE'],
    ];

    for (const [input, expected] of actions) {
      const result = createFKListResult([
        [0, 0, 'parent', 'fk', 'id', input, input, 'NONE'],
      ]);

      const fks = parseForeignKeyList('child', result);
      expect(fks[0].onUpdate).toBe(expected);
      expect(fks[0].onDelete).toBe(expected);
    }
  });

  it('should default unknown actions to NO ACTION', () => {
    const result = createFKListResult([
      [0, 0, 'parent', 'fk', 'id', 'UNKNOWN', '', 'NONE'],
    ]);

    const fks = parseForeignKeyList('child', result);

    expect(fks[0].onUpdate).toBe('NO ACTION');
    expect(fks[0].onDelete).toBe('NO ACTION');
  });
});

describe('ForeignKeyGraph', () => {
  // Sample FK data for testing
  const sampleFKs: ForeignKeyInfo[] = [
    {
      id: 0,
      childTable: 'orders',
      childColumn: 'user_id',
      parentTable: 'users',
      parentColumn: 'id',
      onUpdate: 'NO ACTION',
      onDelete: 'CASCADE',
      match: 'NONE',
    },
    {
      id: 0,
      childTable: 'orders',
      childColumn: 'product_id',
      parentTable: 'products',
      parentColumn: 'id',
      onUpdate: 'NO ACTION',
      onDelete: 'SET NULL',
      match: 'NONE',
    },
    {
      id: 0,
      childTable: 'order_items',
      childColumn: 'order_id',
      parentTable: 'orders',
      parentColumn: 'id',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      match: 'NONE',
    },
    {
      id: 0,
      childTable: 'employees',
      childColumn: 'manager_id',
      parentTable: 'employees',
      parentColumn: 'id',
      onUpdate: 'NO ACTION',
      onDelete: 'SET NULL',
      match: 'NONE',
    },
  ];

  describe('constructor and getAll', () => {
    it('should store all relationships', () => {
      const graph = new ForeignKeyGraph(sampleFKs);
      expect(graph.getAll()).toHaveLength(4);
    });

    it('should handle empty FK list', () => {
      const graph = new ForeignKeyGraph([]);
      expect(graph.getAll()).toHaveLength(0);
    });
  });

  describe('getOutgoingFKs', () => {
    it('should return FKs where table is the child', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      const orderFKs = graph.getOutgoingFKs('orders');
      expect(orderFKs).toHaveLength(2);
      expect(orderFKs.map((fk) => fk.parentTable).sort()).toEqual(['products', 'users']);
    });

    it('should return empty array for table with no outgoing FKs', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      const userFKs = graph.getOutgoingFKs('users');
      expect(userFKs).toHaveLength(0);
    });
  });

  describe('getIncomingFKs', () => {
    it('should return FKs where table is the parent', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      const orderIncoming = graph.getIncomingFKs('orders');
      expect(orderIncoming).toHaveLength(1);
      expect(orderIncoming[0].childTable).toBe('order_items');
    });

    it('should return empty array for table with no incoming FKs', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      const itemIncoming = graph.getIncomingFKs('order_items');
      expect(itemIncoming).toHaveLength(0);
    });
  });

  describe('getReferencedTables', () => {
    it('should return unique parent tables', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      const referenced = graph.getReferencedTables('orders');
      expect(referenced.sort()).toEqual(['products', 'users']);
    });
  });

  describe('getReferencingTables', () => {
    it('should return unique child tables', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      const referencing = graph.getReferencingTables('users');
      expect(referencing).toEqual(['orders']);
    });
  });

  describe('hasRelationship', () => {
    it('should return true for existing relationship', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      expect(graph.hasRelationship('orders', 'users')).toBe(true);
      expect(graph.hasRelationship('orders', 'products')).toBe(true);
    });

    it('should return false for non-existing relationship', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      expect(graph.hasRelationship('users', 'orders')).toBe(false);
      expect(graph.hasRelationship('users', 'products')).toBe(false);
    });
  });

  describe('getRelationships', () => {
    it('should return FKs between specific tables', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      const rels = graph.getRelationships('orders', 'users');
      expect(rels).toHaveLength(1);
      expect(rels[0].childColumn).toBe('user_id');
    });

    it('should return empty array for no relationship', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      const rels = graph.getRelationships('users', 'products');
      expect(rels).toHaveLength(0);
    });
  });

  describe('isSelfReferential', () => {
    it('should detect self-referential FK', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      expect(graph.isSelfReferential('employees')).toBe(true);
    });

    it('should return false for non-self-referential table', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      expect(graph.isSelfReferential('orders')).toBe(false);
      expect(graph.isSelfReferential('users')).toBe(false);
    });
  });

  describe('getAllTables', () => {
    it('should return all tables involved in FKs', () => {
      const graph = new ForeignKeyGraph(sampleFKs);

      const tables = graph.getAllTables();
      expect(tables.size).toBe(5);
      expect(tables.has('users')).toBe(true);
      expect(tables.has('products')).toBe(true);
      expect(tables.has('orders')).toBe(true);
      expect(tables.has('order_items')).toBe(true);
      expect(tables.has('employees')).toBe(true);
    });
  });
});

describe('buildForeignKeyGraph', () => {
  it('should create a ForeignKeyGraph from FK array', () => {
    const fks: ForeignKeyInfo[] = [
      {
        id: 0,
        childTable: 'child',
        childColumn: 'parent_id',
        parentTable: 'parent',
        parentColumn: 'id',
        onUpdate: 'NO ACTION',
        onDelete: 'CASCADE',
        match: 'NONE',
      },
    ];

    const graph = buildForeignKeyGraph(fks);

    expect(graph).toBeInstanceOf(ForeignKeyGraph);
    expect(graph.getAll()).toHaveLength(1);
  });
});
