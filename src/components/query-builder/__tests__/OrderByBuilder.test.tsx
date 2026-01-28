import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  OrderByBuilder,
  generateOrderByClause,
  type SortCondition,
  type AvailableColumn,
} from '../OrderByBuilder'

const mockColumns: AvailableColumn[] = [
  { value: 't1.id', label: 'users.id' },
  { value: 't1.name', label: 'users.name' },
  { value: 't1.email', label: 'users.email' },
  { value: 't2.title', label: 'posts.title' },
]

describe('OrderByBuilder', () => {
  it('renders empty state when no sort conditions', () => {
    const onChange = vi.fn()
    render(
      <OrderByBuilder
        sortConditions={[]}
        onSortConditionsChange={onChange}
        availableColumns={mockColumns}
      />
    )

    expect(screen.getByTestId('no-sorts-message')).toHaveTextContent(
      'No sort conditions'
    )
    expect(screen.getByTestId('add-sort-button')).toBeInTheDocument()
  })

  it('adds a new sort row when Add Sort is clicked', () => {
    const onChange = vi.fn()
    render(
      <OrderByBuilder
        sortConditions={[]}
        onSortConditionsChange={onChange}
        availableColumns={mockColumns}
      />
    )

    fireEvent.click(screen.getByTestId('add-sort-button'))

    expect(onChange).toHaveBeenCalledTimes(1)
    const newConditions = onChange.mock.calls[0][0] as SortCondition[]
    expect(newConditions).toHaveLength(1)
    expect(newConditions[0].column).toBe('')
    expect(newConditions[0].direction).toBe('ASC')
  })

  it('renders sort rows with priority numbers', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: 't1.name', direction: 'ASC' },
      { id: 'sort-2', column: 't1.email', direction: 'DESC' },
    ]
    const onChange = vi.fn()

    render(
      <OrderByBuilder
        sortConditions={conditions}
        onSortConditionsChange={onChange}
        availableColumns={mockColumns}
      />
    )

    expect(screen.getByTestId('sort-priority-0')).toHaveTextContent('1')
    expect(screen.getByTestId('sort-priority-1')).toHaveTextContent('2')
  })

  it('removes a sort row when remove button is clicked', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: 't1.name', direction: 'ASC' },
      { id: 'sort-2', column: 't1.email', direction: 'DESC' },
    ]
    const onChange = vi.fn()

    render(
      <OrderByBuilder
        sortConditions={conditions}
        onSortConditionsChange={onChange}
        availableColumns={mockColumns}
      />
    )

    fireEvent.click(screen.getByTestId('sort-remove-0'))

    expect(onChange).toHaveBeenCalledWith([
      { id: 'sort-2', column: 't1.email', direction: 'DESC' },
    ])
  })

  it('toggles direction between ASC and DESC', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: 't1.name', direction: 'ASC' },
    ]
    const onChange = vi.fn()

    render(
      <OrderByBuilder
        sortConditions={conditions}
        onSortConditionsChange={onChange}
        availableColumns={mockColumns}
      />
    )

    const directionToggle = screen.getByTestId('sort-direction-toggle-0')
    expect(directionToggle).toHaveTextContent('ASC')

    fireEvent.click(directionToggle)

    expect(onChange).toHaveBeenCalledWith([
      { id: 'sort-1', column: 't1.name', direction: 'DESC' },
    ])
  })

  it('shows only selected columns in dropdown', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: '', direction: 'ASC' },
    ]
    const onChange = vi.fn()

    render(
      <OrderByBuilder
        sortConditions={conditions}
        onSortConditionsChange={onChange}
        availableColumns={mockColumns}
      />
    )

    const select = screen.getByTestId('sort-column-select-0')
    const options = select.querySelectorAll('option')

    // 4 columns + 1 placeholder
    expect(options).toHaveLength(5)
    expect(options[0]).toHaveTextContent('Select column...')
    expect(options[1]).toHaveTextContent('users.id')
    expect(options[2]).toHaveTextContent('users.name')
    expect(options[3]).toHaveTextContent('users.email')
    expect(options[4]).toHaveTextContent('posts.title')
  })

  it('updates column selection when dropdown changes', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: '', direction: 'ASC' },
    ]
    const onChange = vi.fn()

    render(
      <OrderByBuilder
        sortConditions={conditions}
        onSortConditionsChange={onChange}
        availableColumns={mockColumns}
      />
    )

    const select = screen.getByTestId('sort-column-select-0')
    fireEvent.change(select, { target: { value: 't1.name' } })

    expect(onChange).toHaveBeenCalledWith([
      { id: 'sort-1', column: 't1.name', direction: 'ASC' },
    ])
  })

  it('clears all sorts when Clear All is clicked', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: 't1.name', direction: 'ASC' },
      { id: 'sort-2', column: 't1.email', direction: 'DESC' },
    ]
    const onChange = vi.fn()

    render(
      <OrderByBuilder
        sortConditions={conditions}
        onSortConditionsChange={onChange}
        availableColumns={mockColumns}
      />
    )

    fireEvent.click(screen.getByTestId('clear-all-sorts'))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('does not show Clear All when no conditions exist', () => {
    const onChange = vi.fn()

    render(
      <OrderByBuilder
        sortConditions={[]}
        onSortConditionsChange={onChange}
        availableColumns={mockColumns}
      />
    )

    expect(screen.queryByTestId('clear-all-sorts')).not.toBeInTheDocument()
  })

  it('generates correct ORDER BY SQL preview', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: 't1.name', direction: 'ASC' },
      { id: 'sort-2', column: 't1.email', direction: 'DESC' },
    ]
    const onChange = vi.fn()

    render(
      <OrderByBuilder
        sortConditions={conditions}
        onSortConditionsChange={onChange}
        availableColumns={mockColumns}
      />
    )

    const preview = screen.getByTestId('order-by-sql-preview')
    expect(preview).toHaveTextContent('ORDER BY t1.name ASC, t1.email DESC')
  })

  it('does not show SQL preview when no valid conditions', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: '', direction: 'ASC' },
    ]
    const onChange = vi.fn()

    render(
      <OrderByBuilder
        sortConditions={conditions}
        onSortConditionsChange={onChange}
        availableColumns={mockColumns}
      />
    )

    expect(screen.queryByTestId('order-by-sql-preview')).not.toBeInTheDocument()
  })

  it('has drag handles for reordering', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: 't1.name', direction: 'ASC' },
      { id: 'sort-2', column: 't1.email', direction: 'DESC' },
    ]
    const onChange = vi.fn()

    render(
      <OrderByBuilder
        sortConditions={conditions}
        onSortConditionsChange={onChange}
        availableColumns={mockColumns}
      />
    )

    expect(screen.getByTestId('sort-drag-handle-0')).toBeInTheDocument()
    expect(screen.getByTestId('sort-drag-handle-1')).toBeInTheDocument()
  })
})

describe('generateOrderByClause', () => {
  it('returns empty string for empty conditions', () => {
    expect(generateOrderByClause([])).toBe('')
  })

  it('returns empty string when all conditions have empty columns', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: '', direction: 'ASC' },
    ]
    expect(generateOrderByClause(conditions)).toBe('')
  })

  it('generates single column ORDER BY', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: 't1.name', direction: 'ASC' },
    ]
    expect(generateOrderByClause(conditions)).toBe('ORDER BY t1.name ASC')
  })

  it('generates multiple column ORDER BY', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: 't1.name', direction: 'ASC' },
      { id: 'sort-2', column: 't1.email', direction: 'DESC' },
      { id: 'sort-3', column: 't2.title', direction: 'ASC' },
    ]
    expect(generateOrderByClause(conditions)).toBe(
      'ORDER BY t1.name ASC, t1.email DESC, t2.title ASC'
    )
  })

  it('skips conditions with empty columns', () => {
    const conditions: SortCondition[] = [
      { id: 'sort-1', column: 't1.name', direction: 'ASC' },
      { id: 'sort-2', column: '', direction: 'DESC' },
      { id: 'sort-3', column: 't1.email', direction: 'ASC' },
    ]
    expect(generateOrderByClause(conditions)).toBe(
      'ORDER BY t1.name ASC, t1.email ASC'
    )
  })
})
