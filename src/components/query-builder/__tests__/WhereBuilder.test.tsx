import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  WhereBuilder,
  type WhereBuilderColumn,
  type WhereCondition,
  generateWhereClause,
  buildLikePattern,
  getOperatorsForType,
  TEXT_OPERATORS,
  NUMERIC_OPERATORS,
  ANY_OPERATORS,
} from '../WhereBuilder'

// Test columns
const testColumns: WhereBuilderColumn[] = [
  { name: 't1.id', type: 'INTEGER' },
  { name: 't1.name', type: 'TEXT' },
  { name: 't1.email', type: 'TEXT' },
  { name: 't1.age', type: 'INTEGER' },
  { name: 't1.price', type: 'REAL' },
]

describe('WhereBuilder', () => {
  describe('Component rendering', () => {
    it('renders empty state when no conditions', () => {
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={[]}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      expect(screen.getByTestId('where-builder')).toBeInTheDocument()
      expect(screen.getByText(/No conditions/)).toBeInTheDocument()
      expect(screen.getByTestId('add-condition-button')).toBeInTheDocument()
    })

    it('add condition creates new row', () => {
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={[]}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      fireEvent.click(screen.getByTestId('add-condition-button'))

      expect(onConditionsChange).toHaveBeenCalledTimes(1)
      const [newConditions] = onConditionsChange.mock.calls[0]
      expect(newConditions).toHaveLength(1)
      expect(newConditions[0]).toMatchObject({
        column: 't1.id',
        operator: '=',
        value: '',
      })
      expect(newConditions[0].id).toBeDefined()
    })

    it('renders condition rows', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.name', operator: '=', value: 'John' },
        { id: 'cond-2', column: 't1.age', operator: '>', value: '18' },
      ]
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={conditions}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      expect(screen.getByTestId('condition-row-cond-1')).toBeInTheDocument()
      expect(screen.getByTestId('condition-row-cond-2')).toBeInTheDocument()
      expect(screen.getByTestId('conditions-list')).toBeInTheDocument()
    })

    it('remove condition removes row', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.name', operator: '=', value: 'John' },
        { id: 'cond-2', column: 't1.age', operator: '>', value: '18' },
      ]
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={conditions}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      fireEvent.click(screen.getByTestId('condition-remove-cond-1'))

      expect(onConditionsChange).toHaveBeenCalledWith([conditions[1]])
    })
  })

  describe('Column change updates operator options', () => {
    it('changing to numeric column updates operators', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.name', operator: 'LIKE', value: '%test%', likeMode: 'contains' },
      ]
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={conditions}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      // Change from TEXT to INTEGER column - LIKE is not available for INTEGER
      fireEvent.change(screen.getByTestId('condition-column-cond-1'), {
        target: { value: 't1.id' },
      })

      expect(onConditionsChange).toHaveBeenCalledTimes(1)
      const [newConditions] = onConditionsChange.mock.calls[0]
      expect(newConditions[0].column).toBe('t1.id')
      // LIKE is not available for INTEGER, so operator should be reset to first available
      expect(newConditions[0].operator).toBe('=')
    })
  })

  describe('LIKE pattern generation', () => {
    it('contains pattern adds % on both sides', () => {
      expect(buildLikePattern('test', 'contains')).toBe('%test%')
    })

    it('starts_with pattern adds % at end', () => {
      expect(buildLikePattern('test', 'starts_with')).toBe('test%')
    })

    it('ends_with pattern adds % at beginning', () => {
      expect(buildLikePattern('test', 'ends_with')).toBe('%test')
    })

    it('exact pattern has no wildcards', () => {
      expect(buildLikePattern('test', 'exact')).toBe('test')
    })

    it('special characters are escaped via escapeLike', () => {
      // % should be escaped
      expect(buildLikePattern('100%', 'contains')).toBe('%100\\%%')
      // _ should be escaped
      expect(buildLikePattern('a_b', 'contains')).toBe('%a\\_b%')
      // \ should be escaped
      expect(buildLikePattern('a\\b', 'contains')).toBe('%a\\\\b%')
    })

    it('combined special characters are all escaped', () => {
      expect(buildLikePattern('50%_off\\', 'exact')).toBe('50\\%\\_off\\\\')
    })
  })

  describe('Operator type mapping', () => {
    it('TEXT columns get text operators', () => {
      const ops = getOperatorsForType('TEXT')
      expect(ops).toContain('LIKE')
      expect(ops).toContain('NOT LIKE')
      expect(ops).not.toContain('BETWEEN')
      expect(ops).toContain('IN')
      TEXT_OPERATORS.forEach((op) => expect(ops).toContain(op))
      ANY_OPERATORS.forEach((op) => expect(ops).toContain(op))
    })

    it('INTEGER columns get numeric operators', () => {
      const ops = getOperatorsForType('INTEGER')
      expect(ops).toContain('BETWEEN')
      expect(ops).toContain('<')
      expect(ops).toContain('>')
      expect(ops).not.toContain('LIKE')
      NUMERIC_OPERATORS.forEach((op) => expect(ops).toContain(op))
      ANY_OPERATORS.forEach((op) => expect(ops).toContain(op))
    })

    it('REAL columns get numeric operators', () => {
      const ops = getOperatorsForType('REAL')
      expect(ops).toContain('BETWEEN')
      expect(ops).toContain('<')
    })

    it('FLOAT columns get numeric operators', () => {
      const ops = getOperatorsForType('FLOAT')
      expect(ops).toContain('BETWEEN')
    })

    it('DOUBLE columns get numeric operators', () => {
      const ops = getOperatorsForType('DOUBLE PRECISION')
      expect(ops).toContain('BETWEEN')
    })

    it('VARCHAR columns get text operators', () => {
      const ops = getOperatorsForType('VARCHAR(255)')
      expect(ops).toContain('LIKE')
    })
  })

  describe('AND/OR toggle', () => {
    it('shows toggle when multiple conditions', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.name', operator: '=', value: 'John' },
        { id: 'cond-2', column: 't1.age', operator: '>', value: '18' },
      ]
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={conditions}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      expect(screen.getByTestId('logic-toggle')).toBeInTheDocument()
      expect(screen.getByTestId('logic-toggle')).toHaveTextContent('AND')
    })

    it('hides toggle when single condition', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.name', operator: '=', value: 'John' },
      ]
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={conditions}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      expect(screen.queryByTestId('logic-toggle')).not.toBeInTheDocument()
    })

    it('toggle updates condition combination', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.name', operator: '=', value: 'John' },
        { id: 'cond-2', column: 't1.age', operator: '>', value: '18' },
      ]
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={conditions}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      fireEvent.click(screen.getByTestId('logic-toggle'))

      expect(onLogicChange).toHaveBeenCalledWith('OR')
    })
  })

  describe('WHERE clause generation', () => {
    it('generates simple equality condition', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.name', operator: '=', value: 'John' },
      ]

      const result = generateWhereClause(conditions, 'AND')

      expect(result.clause).toBe('t1.name = ?')
      expect(result.params).toEqual(['John'])
    })

    it('generates multiple conditions with AND', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.name', operator: '=', value: 'John' },
        { id: 'cond-2', column: 't1.age', operator: '>', value: '18' },
      ]

      const result = generateWhereClause(conditions, 'AND')

      expect(result.clause).toBe('t1.name = ? AND t1.age > ?')
      expect(result.params).toEqual(['John', '18'])
    })

    it('generates multiple conditions with OR', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.name', operator: '=', value: 'John' },
        { id: 'cond-2', column: 't1.name', operator: '=', value: 'Jane' },
      ]

      const result = generateWhereClause(conditions, 'OR')

      expect(result.clause).toBe('t1.name = ? OR t1.name = ?')
      expect(result.params).toEqual(['John', 'Jane'])
    })

    it('generates IS NULL condition', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.email', operator: 'IS NULL', value: '' },
      ]

      const result = generateWhereClause(conditions, 'AND')

      expect(result.clause).toBe('t1.email IS NULL')
      expect(result.params).toEqual([])
    })

    it('generates IS NOT NULL condition', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.email', operator: 'IS NOT NULL', value: '' },
      ]

      const result = generateWhereClause(conditions, 'AND')

      expect(result.clause).toBe('t1.email IS NOT NULL')
      expect(result.params).toEqual([])
    })

    it('generates LIKE condition with ESCAPE clause', () => {
      const conditions: WhereCondition[] = [
        {
          id: 'cond-1',
          column: 't1.name',
          operator: 'LIKE',
          value: 'test',
          likeMode: 'contains',
        },
      ]

      const result = generateWhereClause(conditions, 'AND')

      expect(result.clause).toBe("t1.name LIKE ? ESCAPE '\\'")
      expect(result.params).toEqual(['%test%'])
    })

    it('generates NOT LIKE condition', () => {
      const conditions: WhereCondition[] = [
        {
          id: 'cond-1',
          column: 't1.name',
          operator: 'NOT LIKE',
          value: 'admin',
          likeMode: 'starts_with',
        },
      ]

      const result = generateWhereClause(conditions, 'AND')

      expect(result.clause).toBe("t1.name NOT LIKE ? ESCAPE '\\'")
      expect(result.params).toEqual(['admin%'])
    })

    it('generates BETWEEN condition', () => {
      const conditions: WhereCondition[] = [
        {
          id: 'cond-1',
          column: 't1.age',
          operator: 'BETWEEN',
          value: '18',
          valueTo: '65',
        },
      ]

      const result = generateWhereClause(conditions, 'AND')

      expect(result.clause).toBe('t1.age BETWEEN ? AND ?')
      expect(result.params).toEqual(['18', '65'])
    })

    it('generates IN condition', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.id', operator: 'IN', value: '1, 2, 3' },
      ]

      const result = generateWhereClause(conditions, 'AND')

      expect(result.clause).toBe('t1.id IN (?, ?, ?)')
      expect(result.params).toEqual(['1', '2', '3'])
    })

    it('generates NOT IN condition', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.status', operator: 'NOT IN', value: 'deleted, archived' },
      ]

      const result = generateWhereClause(conditions, 'AND')

      expect(result.clause).toBe('t1.status NOT IN (?, ?)')
      expect(result.params).toEqual(['deleted', 'archived'])
    })

    it('returns empty clause for empty conditions', () => {
      const result = generateWhereClause([], 'AND')

      expect(result.clause).toBe('')
      expect(result.params).toEqual([])
    })

    it('skips conditions with empty column', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: '', operator: '=', value: 'test' },
        { id: 'cond-2', column: 't1.name', operator: '=', value: 'John' },
      ]

      const result = generateWhereClause(conditions, 'AND')

      expect(result.clause).toBe('t1.name = ?')
      expect(result.params).toEqual(['John'])
    })
  })

  describe('SQL preview', () => {
    it('shows preview when conditions exist', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.name', operator: '=', value: 'John' },
      ]
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={conditions}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      const preview = screen.getByTestId('where-preview')
      expect(preview).toHaveTextContent('WHERE t1.name = ?')
    })

    it('hides preview when no conditions', () => {
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={[]}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      expect(screen.queryByTestId('where-preview')).not.toBeInTheDocument()
    })
  })

  describe('LIKE mode selector', () => {
    it('shows LIKE mode selector for LIKE operator', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.name', operator: 'LIKE', value: 'test', likeMode: 'contains' },
      ]
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={conditions}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      expect(screen.getByTestId('condition-like-mode-cond-1')).toBeInTheDocument()
    })

    it('hides LIKE mode selector for non-LIKE operators', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.name', operator: '=', value: 'test' },
      ]
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={conditions}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      expect(screen.queryByTestId('condition-like-mode-cond-1')).not.toBeInTheDocument()
    })
  })

  describe('BETWEEN value inputs', () => {
    it('shows two value inputs for BETWEEN operator', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.age', operator: 'BETWEEN', value: '18', valueTo: '65' },
      ]
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={conditions}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      expect(screen.getByTestId('condition-value-cond-1')).toBeInTheDocument()
      expect(screen.getByTestId('condition-value-to-cond-1')).toBeInTheDocument()
    })
  })

  describe('NULL operators', () => {
    it('hides value input for IS NULL', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.email', operator: 'IS NULL', value: '' },
      ]
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={conditions}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      expect(screen.queryByTestId('condition-value-cond-1')).not.toBeInTheDocument()
    })

    it('hides value input for IS NOT NULL', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.email', operator: 'IS NOT NULL', value: '' },
      ]
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={testColumns}
          conditions={conditions}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      expect(screen.queryByTestId('condition-value-cond-1')).not.toBeInTheDocument()
    })
  })

  describe('Disabled state', () => {
    it('disables add button when no columns', () => {
      const onConditionsChange = vi.fn()
      const onLogicChange = vi.fn()

      render(
        <WhereBuilder
          columns={[]}
          conditions={[]}
          logic="AND"
          onConditionsChange={onConditionsChange}
          onLogicChange={onLogicChange}
        />
      )

      expect(screen.getByTestId('add-condition-button')).toBeDisabled()
    })
  })
})
