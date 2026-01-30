import { describe, it, expect } from 'vitest'
import { joinEdgeTypes, type JoinEdgeData, type JoinType } from '../JoinEdge'

/**
 * JoinEdge component tests
 *
 * Note: The JoinEdge component relies heavily on React Flow's internal context
 * and EdgeLabelRenderer portal, which makes isolated unit testing challenging.
 * Full integration tests should be performed via E2E testing (Playwright).
 *
 * These tests verify the component's exports and type definitions are correct.
 */

describe('JoinEdge', () => {
  describe('exports', () => {
    it('exports joinEdgeTypes for React Flow registration', () => {
      expect(joinEdgeTypes).toBeDefined()
      expect(joinEdgeTypes.joinEdge).toBeDefined()
      expect(typeof joinEdgeTypes.joinEdge).toBe('object') // memoized component
    })

    it('joinEdge type is properly named', () => {
      expect(Object.keys(joinEdgeTypes)).toContain('joinEdge')
    })
  })

  describe('JoinEdgeData type', () => {
    it('can create valid JoinEdgeData with all fields', () => {
      const data: JoinEdgeData = {
        joinType: 'INNER',
        sourceColumn: 'id',
        targetColumn: 'user_id',
        onJoinTypeChange: (_id: string, _type: JoinType) => {},
        onDelete: (_id: string) => {},
      }

      expect(data.joinType).toBe('INNER')
      expect(data.sourceColumn).toBe('id')
      expect(data.targetColumn).toBe('user_id')
      expect(typeof data.onJoinTypeChange).toBe('function')
      expect(typeof data.onDelete).toBe('function')
    })

    it('supports all join types', () => {
      const joinTypes: JoinType[] = ['INNER', 'LEFT', 'RIGHT', 'FULL']

      joinTypes.forEach((joinType) => {
        const data: JoinEdgeData = {
          joinType,
          sourceColumn: 'col_a',
          targetColumn: 'col_b',
        }
        expect(data.joinType).toBe(joinType)
      })
    })

    it('allows optional callbacks', () => {
      const dataWithoutCallbacks: JoinEdgeData = {
        joinType: 'LEFT',
        sourceColumn: 'a',
        targetColumn: 'b',
      }

      expect(dataWithoutCallbacks.onJoinTypeChange).toBeUndefined()
      expect(dataWithoutCallbacks.onDelete).toBeUndefined()
    })
  })

  describe('JoinType', () => {
    it('includes INNER join', () => {
      const joinType: JoinType = 'INNER'
      expect(joinType).toBe('INNER')
    })

    it('includes LEFT join', () => {
      const joinType: JoinType = 'LEFT'
      expect(joinType).toBe('LEFT')
    })

    it('includes RIGHT join', () => {
      const joinType: JoinType = 'RIGHT'
      expect(joinType).toBe('RIGHT')
    })

    it('includes FULL join', () => {
      const joinType: JoinType = 'FULL'
      expect(joinType).toBe('FULL')
    })
  })
})


