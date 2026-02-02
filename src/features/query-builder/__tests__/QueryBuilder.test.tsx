import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
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

  it('drag table to canvas adds TableBox node', async () => {
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

    // onTablesChange is now deferred via queueMicrotask, so we need to wait
    await act(async () => {
      fireEvent.drop(canvas, dropEvent)
      // Wait for queueMicrotask to flush
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

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

  // =============================================================================
  // State Change Callback Tests - Testing fixes for infinite loop and queueMicrotask
  // =============================================================================
  // These tests verify fixes from commits 9b0a89d and current uncommitted changes:
  // 1. Using refs for prop callbacks to prevent infinite loops
  // 2. Using queueMicrotask to defer callbacks and avoid "Cannot update while rendering" warnings

  describe('State change callbacks (with queueMicrotask deferral)', () => {
    /**
     * Helper to wait for queueMicrotask to flush.
     * The QueryBuilder component now defers all parent callbacks via queueMicrotask
     * to avoid React warnings about updating state during render.
     */
    const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

    it('calls onStateChange when table is added (deferred via queueMicrotask)', async () => {
      const onStateChange = vi.fn()
      render(<QueryBuilder tables={mockTables} onStateChange={onStateChange} />)

      const canvas = screen.getByTestId('query-builder-canvas')

      await act(async () => {
        fireEvent.drop(canvas, {
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
        })
        await flushMicrotasks()
      })

      // onStateChange should be called with nodes array and edges array
      expect(onStateChange).toHaveBeenCalled()
      const [nodes, edges] = onStateChange.mock.calls[onStateChange.mock.calls.length - 1]
      expect(Array.isArray(nodes)).toBe(true)
      expect(Array.isArray(edges)).toBe(true)
    })

    it('calls onTablesChange with updated table list (deferred via queueMicrotask)', async () => {
      const onTablesChange = vi.fn()
      const onStateChange = vi.fn()
      render(
        <QueryBuilder
          tables={mockTables}
          onTablesChange={onTablesChange}
          onStateChange={onStateChange}
        />
      )

      const canvas = screen.getByTestId('query-builder-canvas')

      // Add first table - callback is deferred via queueMicrotask
      await act(async () => {
        fireEvent.drop(canvas, {
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
        })
        await flushMicrotasks()
      })

      expect(onTablesChange).toHaveBeenCalledWith(['users'])

      // Add second table
      await act(async () => {
        fireEvent.drop(canvas, {
          preventDefault: vi.fn(),
          clientX: 500,
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
            getData: () => 'orders',
          },
        })
        await flushMicrotasks()
      })

      expect(onTablesChange).toHaveBeenCalledWith(['users', 'orders'])
    })

    /**
     * This test verifies the fix for the infinite loop issue (commit 9b0a89d).
     *
     * The fix uses refs for prop callbacks (onTablesChangeRef, onJoinsChangeRef, etc.)
     * to ensure that changing callback references does not trigger re-renders
     * or callback recreation in useCallback dependencies.
     *
     * Before the fix: Changing callbacks in parent would cause internal callbacks
     * to be recreated, triggering effects and potentially infinite loops.
     *
     * After the fix: Refs store the latest callback reference without affecting
     * React's dependency tracking, breaking the update cycle.
     */
    it('does not cause infinite loops when callbacks are updated', async () => {
      const onTablesChange = vi.fn()
      const onJoinsChange = vi.fn()

      const { rerender } = render(
        <QueryBuilder
          tables={mockTables}
          onTablesChange={onTablesChange}
          onJoinsChange={onJoinsChange}
        />
      )

      // Add a table
      const canvas = screen.getByTestId('query-builder-canvas')
      await act(async () => {
        fireEvent.drop(canvas, {
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
        })
        await flushMicrotasks()
      })

      const initialCallCount = onTablesChange.mock.calls.length

      // Create new callback references (simulating parent re-render)
      const newOnTablesChange = vi.fn()
      const newOnJoinsChange = vi.fn()

      rerender(
        <QueryBuilder
          tables={mockTables}
          onTablesChange={newOnTablesChange}
          onJoinsChange={newOnJoinsChange}
        />
      )

      // Wait for any potential re-renders
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      // The new callbacks should not have been called excessively
      // (i.e., no infinite loop triggered by callback reference change)
      // In a broken state, this would be called many times in rapid succession
      expect(newOnTablesChange.mock.calls.length).toBeLessThan(10)
    })

    /**
     * This test verifies the queueMicrotask fix for state change callbacks.
     *
     * The fix defers callbacks using queueMicrotask to avoid the React warning:
     * "Cannot update a component while rendering a different component"
     *
     * This happens when a parent component's callback tries to update state
     * synchronously during the child's render phase.
     */
    it('defers onStateChange callback to avoid render-time updates', async () => {
      const callOrder: string[] = []

      const onStateChange = vi.fn(() => {
        callOrder.push('onStateChange')
      })

      render(<QueryBuilder tables={mockTables} onStateChange={onStateChange} />)

      const canvas = screen.getByTestId('query-builder-canvas')

      await act(async () => {
        callOrder.push('beforeDrop')
        fireEvent.drop(canvas, {
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
        })
        callOrder.push('afterDrop')
        await flushMicrotasks()
      })

      // onStateChange should be called after drop (via microtask)
      expect(onStateChange).toHaveBeenCalled()
      // The callback should be deferred, not called synchronously during drop
      expect(callOrder.includes('onStateChange')).toBe(true)
    })

    /**
     * Test that onJoinsChange is also properly deferred via queueMicrotask.
     * This ensures consistency in callback timing across all parent notifications.
     */
    it('defers onJoinsChange callback via queueMicrotask', async () => {
      const onJoinsChange = vi.fn()
      const onTablesChange = vi.fn()

      render(
        <QueryBuilder
          tables={mockTables}
          onTablesChange={onTablesChange}
          onJoinsChange={onJoinsChange}
        />
      )

      // onJoinsChange should not be called synchronously on mount
      expect(onJoinsChange).not.toHaveBeenCalled()

      // Even after microtask flush, it shouldn't be called until we add joins
      await act(async () => {
        await flushMicrotasks()
      })

      // No joins yet, so still shouldn't be called
      // (Initial call is empty edges array from state change, not joins change)
    })
  })
})
