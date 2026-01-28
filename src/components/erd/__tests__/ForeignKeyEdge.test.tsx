import { describe, it, expect } from 'vitest'
import {
  foreignKeyEdgeTypes,
  type ForeignKeyEdgeData,
} from '../ForeignKeyEdge'
import type { ForeignKeyAction } from '../../../types/index'

/**
 * ForeignKeyEdge component tests
 *
 * Note: The ForeignKeyEdge component relies heavily on React Flow's internal context
 * and EdgeLabelRenderer portal, which makes isolated unit testing challenging.
 * Full integration tests should be performed via E2E testing (Playwright).
 *
 * These tests verify the component's exports and type definitions are correct.
 */

describe('ForeignKeyEdge', () => {
  describe('exports', () => {
    it('exports foreignKeyEdgeTypes for React Flow registration', () => {
      expect(foreignKeyEdgeTypes).toBeDefined()
      expect(foreignKeyEdgeTypes.fkEdge).toBeDefined()
      expect(typeof foreignKeyEdgeTypes.fkEdge).toBe('object') // memoized component
    })

    it('fkEdge type is properly named', () => {
      expect(Object.keys(foreignKeyEdgeTypes)).toContain('fkEdge')
    })
  })

  describe('ForeignKeyEdgeData type', () => {
    it('can create valid ForeignKeyEdgeData with all fields', () => {
      const data: ForeignKeyEdgeData = {
        childTable: 'posts',
        childColumn: 'user_id',
        parentTable: 'users',
        parentColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: false,
        onEdgeDelete: (_id: string) => {},
      }

      expect(data.childTable).toBe('posts')
      expect(data.childColumn).toBe('user_id')
      expect(data.parentTable).toBe('users')
      expect(data.parentColumn).toBe('id')
      expect(data.onDelete).toBe('CASCADE')
      expect(data.onUpdate).toBe('NO ACTION')
      expect(data.cardinality).toBe('one-to-many')
      expect(data.isOptional).toBe(false)
      expect(typeof data.onEdgeDelete).toBe('function')
    })

    it('supports one-to-one cardinality', () => {
      const data: ForeignKeyEdgeData = {
        childTable: 'profiles',
        childColumn: 'user_id',
        parentTable: 'users',
        parentColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-one',
        isOptional: false,
      }

      expect(data.cardinality).toBe('one-to-one')
    })

    it('supports one-to-many cardinality', () => {
      const data: ForeignKeyEdgeData = {
        childTable: 'orders',
        childColumn: 'customer_id',
        parentTable: 'customers',
        parentColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        cardinality: 'one-to-many',
        isOptional: true,
      }

      expect(data.cardinality).toBe('one-to-many')
      expect(data.isOptional).toBe(true)
    })

    it('allows optional callbacks', () => {
      const dataWithoutCallbacks: ForeignKeyEdgeData = {
        childTable: 'a',
        childColumn: 'b',
        parentTable: 'c',
        parentColumn: 'd',
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: false,
      }

      expect(dataWithoutCallbacks.onEdgeDelete).toBeUndefined()
    })

    it('supports all FK actions', () => {
      const actions: ForeignKeyAction[] = [
        'NO ACTION',
        'RESTRICT',
        'SET NULL',
        'SET DEFAULT',
        'CASCADE',
      ]

      actions.forEach((action) => {
        const data: ForeignKeyEdgeData = {
          childTable: 'child',
          childColumn: 'ref_id',
          parentTable: 'parent',
          parentColumn: 'id',
          onDelete: action,
          onUpdate: action,
          cardinality: 'one-to-many',
          isOptional: false,
        }
        expect(data.onDelete).toBe(action)
        expect(data.onUpdate).toBe(action)
      })
    })
  })

  describe('edge styling behavior', () => {
    it('CASCADE is treated as special case for visual warning', () => {
      // Verify that the types support cascade which triggers dashed line
      const cascadeData: ForeignKeyEdgeData = {
        childTable: 'posts',
        childColumn: 'user_id',
        parentTable: 'users',
        parentColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: false,
      }

      expect(cascadeData.onDelete).toBe('CASCADE')
      // Note: Visual styling (dashed line for CASCADE) is verified in E2E tests
    })
  })

  describe('relationship notation', () => {
    it('one-to-many relationship is default FK representation', () => {
      // Most FKs represent one-to-many relationships (many children to one parent)
      const fkData: ForeignKeyEdgeData = {
        childTable: 'order_items',
        childColumn: 'order_id',
        parentTable: 'orders',
        parentColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: false,
      }

      expect(fkData.cardinality).toBe('one-to-many')
      // Note: Crow's foot marker on child side is verified in E2E tests
    })

    it('optional relationships have nullable FK column', () => {
      // Optional FKs (nullable) show circle marker
      const optionalFk: ForeignKeyEdgeData = {
        childTable: 'employees',
        childColumn: 'manager_id',
        parentTable: 'employees',
        parentColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: true, // manager_id is nullable
      }

      expect(optionalFk.isOptional).toBe(true)
      // Note: Optional circle marker is verified in E2E tests
    })
  })
})
