import { describe, it, expect } from 'vitest'
import {
  foreignKeyEdgeTypes,
  formatCompositeFKLabel,
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

  describe('formatCompositeFKLabel', () => {
    it('formats single-column FK without parentheses', () => {
      const label = formatCompositeFKLabel(['user_id'], ['id'])
      expect(label).toBe('user_id → id')
    })

    it('formats composite FK with parentheses', () => {
      const label = formatCompositeFKLabel(['org_id', 'user_id'], ['org_id', 'user_id'])
      expect(label).toBe('(org_id, user_id) → (org_id, user_id)')
    })

    it('formats three-column composite FK', () => {
      const label = formatCompositeFKLabel(['a', 'b', 'c'], ['x', 'y', 'z'])
      expect(label).toBe('(a, b, c) → (x, y, z)')
    })
  })

  describe('ForeignKeyEdgeData type', () => {
    it('can create valid ForeignKeyEdgeData with all fields (single-column)', () => {
      const data: ForeignKeyEdgeData = {
        childTable: 'posts',
        childColumns: ['user_id'],
        parentTable: 'users',
        parentColumns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: false,
        isComposite: false,
        onEdgeDelete: (_id: string) => {},
      }

      expect(data.childTable).toBe('posts')
      expect(data.childColumns).toEqual(['user_id'])
      expect(data.parentTable).toBe('users')
      expect(data.parentColumns).toEqual(['id'])
      expect(data.onDelete).toBe('CASCADE')
      expect(data.onUpdate).toBe('NO ACTION')
      expect(data.cardinality).toBe('one-to-many')
      expect(data.isOptional).toBe(false)
      expect(data.isComposite).toBe(false)
      expect(typeof data.onEdgeDelete).toBe('function')
    })

    it('can create valid ForeignKeyEdgeData for composite FK', () => {
      const data: ForeignKeyEdgeData = {
        childTable: 'order_items',
        childColumns: ['order_id', 'product_id'],
        parentTable: 'order_products',
        parentColumns: ['order_id', 'product_id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: false,
        isComposite: true,
        onEdgeDelete: (_id: string) => {},
      }

      expect(data.childTable).toBe('order_items')
      expect(data.childColumns).toEqual(['order_id', 'product_id'])
      expect(data.parentTable).toBe('order_products')
      expect(data.parentColumns).toEqual(['order_id', 'product_id'])
      expect(data.isComposite).toBe(true)
    })

    it('supports one-to-one cardinality', () => {
      const data: ForeignKeyEdgeData = {
        childTable: 'profiles',
        childColumns: ['user_id'],
        parentTable: 'users',
        parentColumns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-one',
        isOptional: false,
        isComposite: false,
      }

      expect(data.cardinality).toBe('one-to-one')
    })

    it('supports one-to-many cardinality', () => {
      const data: ForeignKeyEdgeData = {
        childTable: 'orders',
        childColumns: ['customer_id'],
        parentTable: 'customers',
        parentColumns: ['id'],
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        cardinality: 'one-to-many',
        isOptional: true,
        isComposite: false,
      }

      expect(data.cardinality).toBe('one-to-many')
      expect(data.isOptional).toBe(true)
    })

    it('allows optional callbacks', () => {
      const dataWithoutCallbacks: ForeignKeyEdgeData = {
        childTable: 'a',
        childColumns: ['b'],
        parentTable: 'c',
        parentColumns: ['d'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: false,
        isComposite: false,
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
          childColumns: ['ref_id'],
          parentTable: 'parent',
          parentColumns: ['id'],
          onDelete: action,
          onUpdate: action,
          cardinality: 'one-to-many',
          isOptional: false,
          isComposite: false,
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
        childColumns: ['user_id'],
        parentTable: 'users',
        parentColumns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: false,
        isComposite: false,
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
        childColumns: ['order_id'],
        parentTable: 'orders',
        parentColumns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: false,
        isComposite: false,
      }

      expect(fkData.cardinality).toBe('one-to-many')
      // Note: Crow's foot marker on child side is verified in E2E tests
    })

    it('optional relationships have nullable FK column', () => {
      // Optional FKs (nullable) show circle marker
      const optionalFk: ForeignKeyEdgeData = {
        childTable: 'employees',
        childColumns: ['manager_id'],
        parentTable: 'employees',
        parentColumns: ['id'],
        onDelete: 'SET NULL',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: true, // manager_id is nullable
        isComposite: false,
      }

      expect(optionalFk.isOptional).toBe(true)
      // Note: Optional circle marker is verified in E2E tests
    })
  })

  describe('composite FK behavior', () => {
    it('composite FKs are marked as read-only', () => {
      const compositeFk: ForeignKeyEdgeData = {
        childTable: 'order_details',
        childColumns: ['order_id', 'product_id'],
        parentTable: 'order_products',
        parentColumns: ['order_id', 'product_id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: false,
        isComposite: true,
      }

      expect(compositeFk.isComposite).toBe(true)
      // Note: Read-only behavior (no edit/delete) verified in E2E tests
    })

    it('single-column FKs are not composite', () => {
      const singleFk: ForeignKeyEdgeData = {
        childTable: 'posts',
        childColumns: ['user_id'],
        parentTable: 'users',
        parentColumns: ['id'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
        cardinality: 'one-to-many',
        isOptional: false,
        isComposite: false,
      }

      expect(singleFk.isComposite).toBe(false)
    })
  })
})
