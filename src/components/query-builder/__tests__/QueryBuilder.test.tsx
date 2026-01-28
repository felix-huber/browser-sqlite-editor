import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryBuilder } from '../QueryBuilder'

// Mock IntersectionObserver for React Flow
class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: IntersectionObserverMock,
  })

  // Mock getBoundingClientRect for React Flow viewport calculations
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    bottom: 600,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => {},
  }))
})

const mockTables = ['users', 'orders', 'products', 'categories', 'inventory']

describe('QueryBuilder', () => {
  it('renders without errors', () => {
    render(<QueryBuilder tables={[]} />)
    expect(screen.getByTestId('query-builder')).toBeInTheDocument()
  })

  it('renders table list from schema', () => {
    render(<QueryBuilder tables={mockTables} />)

    expect(screen.getByTestId('table-list')).toBeInTheDocument()
    expect(screen.getByTestId('table-item-users')).toBeInTheDocument()
    expect(screen.getByTestId('table-item-orders')).toBeInTheDocument()
    expect(screen.getByTestId('table-item-products')).toBeInTheDocument()
    expect(screen.getByTestId('table-item-categories')).toBeInTheDocument()
    expect(screen.getByTestId('table-item-inventory')).toBeInTheDocument()
  })

  it('renders empty state when no tables available', () => {
    render(<QueryBuilder tables={[]} />)
    expect(screen.getByText('No tables available')).toBeInTheDocument()
  })

  it('search filters table list', async () => {
    const user = userEvent.setup()
    render(<QueryBuilder tables={mockTables} />)

    const searchInput = screen.getByTestId('table-search-input')
    await user.type(searchInput, 'ord')

    // Only 'orders' should be visible
    expect(screen.getByTestId('table-item-orders')).toBeInTheDocument()
    expect(screen.queryByTestId('table-item-users')).not.toBeInTheDocument()
    expect(screen.queryByTestId('table-item-products')).not.toBeInTheDocument()
  })

  it('search shows no matching tables message', async () => {
    const user = userEvent.setup()
    render(<QueryBuilder tables={mockTables} />)

    const searchInput = screen.getByTestId('table-search-input')
    await user.type(searchInput, 'nonexistent')

    expect(screen.getByText('No matching tables')).toBeInTheDocument()
  })

  it('renders canvas area', () => {
    render(<QueryBuilder tables={mockTables} />)
    expect(screen.getByTestId('query-builder-canvas')).toBeInTheDocument()
  })

  it('renders clear button', () => {
    render(<QueryBuilder tables={mockTables} />)
    expect(screen.getByTestId('clear-canvas-button')).toBeInTheDocument()
  })

  it('clear button is disabled when canvas is empty', () => {
    render(<QueryBuilder tables={mockTables} />)
    const clearButton = screen.getByTestId('clear-canvas-button')
    expect(clearButton).toBeDisabled()
  })

  it('drag table to canvas adds TableBox node', () => {
    const onTablesChange = vi.fn()
    render(<QueryBuilder tables={mockTables} onTablesChange={onTablesChange} />)

    const tableItem = screen.getByTestId('table-item-users')
    const canvas = screen.getByTestId('query-builder-canvas')

    // Simulate drag and drop
    fireEvent.dragStart(tableItem, {
      dataTransfer: {
        setData: vi.fn(),
        effectAllowed: 'copy',
      },
    })

    const dropEvent = {
      preventDefault: vi.fn(),
      clientX: 400,
      clientY: 300,
      currentTarget: {
        getBoundingClientRect: () => ({
          left: 200,
          top: 0,
          width: 600,
          height: 600,
        }),
      },
      dataTransfer: {
        getData: () => 'users',
      },
    }

    fireEvent.drop(canvas, dropEvent)

    // onTablesChange should be called with the added table
    expect(onTablesChange).toHaveBeenCalledWith(['users'])
  })

  it('table limit: warning shown after 10 tables', () => {
    const onTablesChange = vi.fn()
    render(<QueryBuilder tables={mockTables} onTablesChange={onTablesChange} />)

    const canvas = screen.getByTestId('query-builder-canvas')

    // Add 10 tables
    for (let i = 0; i < 10; i++) {
      const dropEvent = {
        preventDefault: vi.fn(),
        clientX: 400 + i * 10,
        clientY: 300,
        currentTarget: {
          getBoundingClientRect: () => ({
            left: 200,
            top: 0,
            width: 600,
            height: 600,
          }),
        },
        dataTransfer: {
          getData: () => `table-${i}`,
        },
      }
      fireEvent.drop(canvas, dropEvent)
    }

    // Try to add 11th table - should show warning
    const eleventhDropEvent = {
      preventDefault: vi.fn(),
      clientX: 500,
      clientY: 400,
      currentTarget: {
        getBoundingClientRect: () => ({
          left: 200,
          top: 0,
          width: 600,
          height: 600,
        }),
      },
      dataTransfer: {
        getData: () => 'extra-table',
      },
    }
    fireEvent.drop(canvas, eleventhDropEvent)

    expect(screen.getByTestId('limit-warning')).toBeInTheDocument()
    expect(screen.getByText('Maximum 10 tables allowed')).toBeInTheDocument()
  })

  it('clear removes all nodes from canvas', async () => {
    const user = userEvent.setup()
    const onTablesChange = vi.fn()
    render(<QueryBuilder tables={mockTables} onTablesChange={onTablesChange} />)

    const canvas = screen.getByTestId('query-builder-canvas')

    // Add a table first
    const dropEvent = {
      preventDefault: vi.fn(),
      clientX: 400,
      clientY: 300,
      currentTarget: {
        getBoundingClientRect: () => ({
          left: 200,
          top: 0,
          width: 600,
          height: 600,
        }),
      },
      dataTransfer: {
        getData: () => 'users',
      },
    }
    fireEvent.drop(canvas, dropEvent)

    // Clear button should now be enabled
    const clearButton = screen.getByTestId('clear-canvas-button')
    expect(clearButton).not.toBeDisabled()

    // Click clear
    await user.click(clearButton)

    // onTablesChange should be called with empty array
    expect(onTablesChange).toHaveBeenLastCalledWith([])

    // Clear button should be disabled again
    expect(clearButton).toBeDisabled()
  })

  it('shows table count indicator', () => {
    render(<QueryBuilder tables={mockTables} />)
    expect(screen.getByText('0 / 10 tables')).toBeInTheDocument()
  })

  it('renders React Flow controls', () => {
    render(<QueryBuilder tables={mockTables} />)

    const controls = document.querySelector('.react-flow__controls')
    expect(controls).toBeInTheDocument()
  })

  it('renders React Flow background', () => {
    render(<QueryBuilder tables={mockTables} />)

    const background = document.querySelector('.react-flow__background')
    expect(background).toBeInTheDocument()
  })

  it('table items are draggable', () => {
    render(<QueryBuilder tables={mockTables} />)

    const tableItem = screen.getByTestId('table-item-users')
    expect(tableItem).toHaveAttribute('draggable', 'true')
  })

  it('renders search input', () => {
    render(<QueryBuilder tables={mockTables} />)
    expect(screen.getByTestId('table-search-input')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
  })
})
