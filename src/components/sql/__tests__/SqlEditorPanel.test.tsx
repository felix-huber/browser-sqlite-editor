import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SqlEditorPanel } from '../SqlEditorPanel'
import type { QueryResult, QueryHistoryItem } from '../../../types'

describe('SqlEditorPanel', () => {
  // Mock ResizeObserver which TanStack Virtual uses
  class MockResizeObserver {
    private callback: ResizeObserverCallback

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }

    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      )
    }

    unobserve() {}
    disconnect() {}
  }

  const setupVirtualizerMocks = () => {
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

    Element.prototype.getBoundingClientRect = function () {
      if (this.classList?.contains('overflow-auto')) {
        return {
          width: 800,
          height: 228,
          top: 0,
          left: 0,
          bottom: 228,
          right: 800,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }
      }
      return originalGetBoundingClientRect.call(this)
    }

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 3200
      },
    })

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        if (this.classList?.contains('overflow-auto')) {
          return 228
        }
        return 0
      },
    })

    return originalGetBoundingClientRect
  }

  let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect

  const mockQueryResult: QueryResult = {
    columns: ['id', 'name'],
    columnTypes: ['INTEGER', 'TEXT'],
    rows: [
      [1, 'Alice'],
      [2, 'Bob'],
    ],
  }

  const mockExecute = vi.fn()
  const mockCancel = vi.fn()

  beforeEach(() => {
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
    originalGetBoundingClientRect = setupVirtualizerMocks()
    vi.clearAllMocks()
    mockExecute.mockResolvedValue(mockQueryResult)
  })

  afterEach(() => {
    cleanup()
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
    vi.clearAllTimers()
  })

  it('mounts without errors', () => {
    render(<SqlEditorPanel onExecute={mockExecute} />)
    expect(screen.getByTestId('sql-editor-panel')).toBeInTheDocument()
  })

  it('renders run button', () => {
    render(<SqlEditorPanel onExecute={mockExecute} />)
    expect(screen.getByTestId('run-button')).toBeInTheDocument()
  })

  it('run button is disabled when editor is empty', () => {
    render(<SqlEditorPanel onExecute={mockExecute} />)
    const runButton = screen.getByTestId('run-button')
    expect(runButton).toBeDisabled()
  })

  it('run button calls execute handler when clicked', async () => {
    const user = userEvent.setup()
    render(<SqlEditorPanel onExecute={mockExecute} initialValue="SELECT 1" />)

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith('SELECT 1')
    })
  })

  it('cancel button is shown during execution and calls cancel handler', async () => {
    // Mock a slow execution
    mockExecute.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockQueryResult), 1000))
    )

    const user = userEvent.setup()
    render(
      <SqlEditorPanel
        onExecute={mockExecute}
        onCancel={mockCancel}
        initialValue="SELECT * FROM large_table"
      />
    )

    // Click run
    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    // Cancel button should appear
    await waitFor(() => {
      expect(screen.getByTestId('cancel-button')).toBeInTheDocument()
    })

    // Click cancel
    const cancelButton = screen.getByTestId('cancel-button')
    await user.click(cancelButton)

    expect(mockCancel).toHaveBeenCalled()
  })

  it('Ctrl+Enter triggers run', async () => {
    render(<SqlEditorPanel onExecute={mockExecute} initialValue="SELECT 1" />)

    const panel = screen.getByTestId('sql-editor-panel')
    fireEvent.keyDown(panel, { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith('SELECT 1')
    })
  })

  it('Cmd+Enter triggers run on Mac', async () => {
    render(<SqlEditorPanel onExecute={mockExecute} initialValue="SELECT 1" />)

    const panel = screen.getByTestId('sql-editor-panel')
    fireEvent.keyDown(panel, { key: 'Enter', metaKey: true })

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith('SELECT 1')
    })
  })

  it('read-only mode: SELECT still executes', async () => {
    const user = userEvent.setup()
    render(
      <SqlEditorPanel
        onExecute={mockExecute}
        isReadOnly={true}
        initialValue="SELECT * FROM users"
      />
    )

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith('SELECT * FROM users')
    })
  })

  it('read-only mode: DML shows warning, not executed', async () => {
    const user = userEvent.setup()
    render(
      <SqlEditorPanel
        onExecute={mockExecute}
        isReadOnly={true}
        initialValue="INSERT INTO users (name) VALUES ('test')"
      />
    )

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(screen.getByTestId('readonly-warning')).toBeInTheDocument()
    })

    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('read-only mode: UPDATE shows warning', async () => {
    const user = userEvent.setup()
    render(
      <SqlEditorPanel
        onExecute={mockExecute}
        isReadOnly={true}
        initialValue="UPDATE users SET name = 'test'"
      />
    )

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(screen.getByTestId('readonly-warning')).toBeInTheDocument()
    })

    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('read-only mode: DELETE shows warning', async () => {
    const user = userEvent.setup()
    render(
      <SqlEditorPanel
        onExecute={mockExecute}
        isReadOnly={true}
        initialValue="DELETE FROM users"
      />
    )

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(screen.getByTestId('readonly-warning')).toBeInTheDocument()
    })

    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('read-only mode: DDL shows warning', async () => {
    const user = userEvent.setup()
    render(
      <SqlEditorPanel
        onExecute={mockExecute}
        isReadOnly={true}
        initialValue="CREATE TABLE test (id INTEGER)"
      />
    )

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(screen.getByTestId('readonly-warning')).toBeInTheDocument()
    })

    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('read-only mode: read-only PRAGMA executes', async () => {
    const user = userEvent.setup()
    mockExecute.mockResolvedValue({
      columns: ['name', 'type'],
      columnTypes: ['TEXT', 'TEXT'],
      rows: [['id', 'INTEGER']],
    })

    render(
      <SqlEditorPanel
        onExecute={mockExecute}
        isReadOnly={true}
        initialValue="PRAGMA table_info(users)"
      />
    )

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith('PRAGMA table_info(users)')
    })
  })

  it('read-only mode: write PRAGMA shows warning', async () => {
    const user = userEvent.setup()
    render(
      <SqlEditorPanel
        onExecute={mockExecute}
        isReadOnly={true}
        initialValue="PRAGMA journal_mode = WAL"
      />
    )

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(screen.getByTestId('readonly-warning')).toBeInTheDocument()
    })

    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('displays results after successful execution', async () => {
    const user = userEvent.setup()
    render(<SqlEditorPanel onExecute={mockExecute} initialValue="SELECT * FROM users" />)

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(screen.getByTestId('results-table')).toBeInTheDocument()
    })

    // Check column headers
    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.getByText('name')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('row-count')).toHaveTextContent('2 rows')
      expect(screen.getByTestId('column-count')).toHaveTextContent('2 columns')
    })
  })

  it('displays error on execution failure', async () => {
    mockExecute.mockRejectedValue(new Error('syntax error at line 1'))

    const user = userEvent.setup()
    render(<SqlEditorPanel onExecute={mockExecute} initialValue="SELEC * FROM users" />)

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(screen.getByTestId('error-display')).toBeInTheDocument()
    })

    // Error message is now in the SqlErrorPanel with indexed test ids
    expect(screen.getByTestId('error-message-0')).toHaveTextContent('syntax error at line 1')
  })

  it('displays execution time after query', async () => {
    const user = userEvent.setup()
    render(<SqlEditorPanel onExecute={mockExecute} initialValue="SELECT 1" />)

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(screen.getByTestId('execution-time-status')).toBeInTheDocument()
    })
  })

  it('displays row count after query', async () => {
    const user = userEvent.setup()
    render(<SqlEditorPanel onExecute={mockExecute} initialValue="SELECT * FROM users" />)

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(screen.getByTestId('row-count')).toHaveTextContent('2 rows')
    })
  })

  it('displays empty results message when no rows returned', async () => {
    mockExecute.mockResolvedValue({
      columns: ['id'],
      columnTypes: ['INTEGER'],
      rows: [],
    })

    const user = userEvent.setup()
    render(<SqlEditorPanel onExecute={mockExecute} initialValue="SELECT * FROM empty_table" />)

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(screen.getByTestId('select-empty-results')).toBeInTheDocument()
    })
  })

  it('renders history button when history is provided', () => {
    const history: QueryHistoryItem[] = [
      { sql: 'SELECT 1', executedAt: new Date().toISOString() },
    ]

    render(<SqlEditorPanel onExecute={mockExecute} history={history} />)
    expect(screen.getByTestId('history-button')).toBeInTheDocument()
  })

  it('history dropdown opens and shows items', async () => {
    const user = userEvent.setup()
    const history: QueryHistoryItem[] = [
      { sql: 'SELECT 1', executedAt: '2024-01-01T12:00:00Z' },
      { sql: 'SELECT 2', executedAt: '2024-01-01T13:00:00Z' },
    ]

    render(<SqlEditorPanel onExecute={mockExecute} history={history} />)

    const historyButton = screen.getByTestId('history-button')
    await user.click(historyButton)

    await waitFor(() => {
      expect(screen.getByTestId('history-dropdown')).toBeInTheDocument()
    })

    expect(screen.getByTestId('history-item-0')).toBeInTheDocument()
    expect(screen.getByTestId('history-item-1')).toBeInTheDocument()
  })

  it('selecting history item populates editor', async () => {
    const user = userEvent.setup()
    const history: QueryHistoryItem[] = [
      { sql: 'SELECT * FROM products', executedAt: '2024-01-01T12:00:00Z' },
    ]

    render(<SqlEditorPanel onExecute={mockExecute} history={history} />)

    // Open history
    const historyButton = screen.getByTestId('history-button')
    await user.click(historyButton)

    // Click history item
    const historyItem = screen.getByTestId('history-item-0')
    await user.click(historyItem)

    // Now execute to verify the SQL was loaded
    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith('SELECT * FROM products')
    })
  })

  it('displays results summary for NULL values', async () => {
    mockExecute.mockResolvedValue({
      columns: ['id', 'name'],
      columnTypes: ['INTEGER', 'TEXT'],
      rows: [[1, null]],
    })

    const user = userEvent.setup()
    render(<SqlEditorPanel onExecute={mockExecute} initialValue="SELECT * FROM users" />)

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(screen.getByTestId('row-count')).toHaveTextContent('1 row')
      expect(screen.getByTestId('column-count')).toHaveTextContent('2 columns')
    })
  })

  it('displays results summary for BLOB values', async () => {
    mockExecute.mockResolvedValue({
      columns: ['id', 'data'],
      columnTypes: ['INTEGER', 'BLOB'],
      rows: [[1, new Uint8Array([1, 2, 3, 4, 5])]],
    })

    const user = userEvent.setup()
    render(<SqlEditorPanel onExecute={mockExecute} initialValue="SELECT * FROM files" />)

    const runButton = screen.getByTestId('run-button')
    await user.click(runButton)

    await waitFor(() => {
      expect(screen.getByTestId('row-count')).toHaveTextContent('1 row')
      expect(screen.getByTestId('column-count')).toHaveTextContent('2 columns')
    })
  })
})
