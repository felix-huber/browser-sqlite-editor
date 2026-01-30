import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SqlPreviewPanel } from '../SqlPreviewPanel'
import type { QueryResult } from '../../../types'

// Mock SqlResultsDisplay
vi.mock('../../sql/SqlResultsDisplay', () => ({
  SqlResultsDisplay: ({ results, totalExecutionTime }: { results: unknown[]; totalExecutionTime?: number }) => (
    <div data-testid="sql-results-display" data-results-count={results.length} data-time={totalExecutionTime}>
      Results: {results.length}
    </div>
  ),
}))

describe('SqlPreviewPanel', () => {
  const mockQueryResult: QueryResult = {
    columns: ['id', 'name'],
    columnTypes: ['INTEGER', 'TEXT'],
    rows: [
      [1, 'Alice'],
      [2, 'Bob'],
    ],
  }

  const mockWriteText = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    // Use Object.defineProperty to mock navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders without errors', () => {
    render(<SqlPreviewPanel sql="" />)
    expect(screen.getByTestId('sql-preview-panel')).toBeInTheDocument()
  })

  it('shows header with SQL Preview title', () => {
    render(<SqlPreviewPanel sql="SELECT * FROM users" />)
    expect(screen.getByText('SQL Preview')).toBeInTheDocument()
  })

  it('shows empty state when sql is empty', () => {
    render(<SqlPreviewPanel sql="" />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(
      screen.getByText('Add tables and configure your query to see the generated SQL')
    ).toBeInTheDocument()
  })

  it('displays SQL preview text', () => {
    const sql = 'SELECT * FROM users'
    render(<SqlPreviewPanel sql={sql} />)

    const preview = screen.getByTestId('sql-preview-text')
    expect(preview).toBeInTheDocument()
    expect(preview).toHaveTextContent(sql)
  })

  it('shows generating indicator when isGenerating is true', () => {
    render(<SqlPreviewPanel sql="" isGenerating={true} />)
    expect(screen.getByTestId('generating-indicator')).toBeInTheDocument()
    expect(screen.getByText('Generating SQL...')).toBeInTheDocument()
  })

  describe('Run button', () => {
    it('is disabled when sql is empty', () => {
      render(<SqlPreviewPanel sql="" onExecute={vi.fn()} />)
      expect(screen.getByTestId('run-button')).toBeDisabled()
    })

    it('is disabled when no onExecute callback', () => {
      render(<SqlPreviewPanel sql="SELECT * FROM users" />)
      expect(screen.getByTestId('run-button')).toBeDisabled()
    })

    it('is enabled when sql exists and onExecute is provided', () => {
      render(<SqlPreviewPanel sql="SELECT * FROM users" onExecute={vi.fn()} />)
      expect(screen.getByTestId('run-button')).not.toBeDisabled()
    })

    it('is disabled when isGenerating is true', () => {
      render(
        <SqlPreviewPanel
          sql="SELECT * FROM users"
          onExecute={vi.fn()}
          isGenerating={true}
        />
      )
      expect(screen.getByTestId('run-button')).toBeDisabled()
    })

    it('executes query when clicked', async () => {
      const user = userEvent.setup()
      const onExecute = vi.fn().mockResolvedValue(mockQueryResult)

      render(
        <SqlPreviewPanel sql="SELECT * FROM users" onExecute={onExecute} />
      )

      await user.click(screen.getByTestId('run-button'))

      await waitFor(() => {
        expect(onExecute).toHaveBeenCalledWith('SELECT * FROM users', [])
      })
    })

    it('shows Running... during execution', async () => {
      const user = userEvent.setup()
      let resolveQuery: (value: QueryResult) => void
      const onExecute = vi.fn().mockReturnValue(
        new Promise<QueryResult>((resolve) => {
          resolveQuery = resolve
        })
      )

      render(
        <SqlPreviewPanel sql="SELECT * FROM users" onExecute={onExecute} />
      )

      await user.click(screen.getByTestId('run-button'))

      await waitFor(() => {
        expect(screen.getByText('Running...')).toBeInTheDocument()
      })

      // Resolve the promise
      await act(async () => {
        resolveQuery!(mockQueryResult)
      })

      await waitFor(() => {
        expect(screen.queryByText('Running...')).not.toBeInTheDocument()
      })
    })
  })

  describe('Cancel button', () => {
    it('is not shown when not executing', () => {
      render(
        <SqlPreviewPanel
          sql="SELECT * FROM users"
          onExecute={vi.fn()}
          onCancel={vi.fn()}
        />
      )
      expect(screen.queryByTestId('cancel-button')).not.toBeInTheDocument()
    })

    it('calls onCancel when clicked during execution', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      let resolveQuery: (value: QueryResult) => void
      const onExecute = vi.fn().mockReturnValue(
        new Promise<QueryResult>((resolve) => {
          resolveQuery = resolve
        })
      )

      render(
        <SqlPreviewPanel
          sql="SELECT * FROM users"
          onExecute={onExecute}
          onCancel={onCancel}
        />
      )

      await user.click(screen.getByTestId('run-button'))

      await waitFor(() => {
        expect(screen.getByTestId('cancel-button')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('cancel-button'))
      expect(onCancel).toHaveBeenCalled()

      // Cleanup: resolve the promise to avoid warnings
      await act(async () => {
        resolveQuery!(mockQueryResult)
      })
    })
  })

  describe('Copy button', () => {
    it('is disabled when sql is empty', () => {
      render(<SqlPreviewPanel sql="" />)
      expect(screen.getByTestId('copy-button')).toHaveClass('cursor-not-allowed')
    })

    it('copies SQL to clipboard when clicked', async () => {
      const user = userEvent.setup()
      const sql = 'SELECT * FROM users'
      const localMockWriteText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: localMockWriteText },
        writable: true,
        configurable: true,
      })

      render(<SqlPreviewPanel sql={sql} />)

      await user.click(screen.getByTestId('copy-button'))

      expect(localMockWriteText).toHaveBeenCalledWith(sql)
    })

    it('shows Copied! feedback after copy', async () => {
      const user = userEvent.setup()

      render(<SqlPreviewPanel sql="SELECT * FROM users" />)

      await user.click(screen.getByTestId('copy-button'))

      await waitFor(() => {
        expect(screen.getByText('Copied!')).toBeInTheDocument()
      })
    })
  })

  describe('Open in Editor button', () => {
    it('is not shown when onOpenInEditor is not provided', () => {
      render(<SqlPreviewPanel sql="SELECT * FROM users" />)
      expect(screen.queryByTestId('open-in-editor-button')).not.toBeInTheDocument()
    })

    it('is shown when onOpenInEditor is provided', () => {
      render(
        <SqlPreviewPanel
          sql="SELECT * FROM users"
          onOpenInEditor={vi.fn()}
        />
      )
      expect(screen.getByTestId('open-in-editor-button')).toBeInTheDocument()
    })

    it('calls onOpenInEditor with SQL when clicked', async () => {
      const user = userEvent.setup()
      const onOpenInEditor = vi.fn()
      const sql = 'SELECT * FROM users'

      render(<SqlPreviewPanel sql={sql} onOpenInEditor={onOpenInEditor} />)

      await user.click(screen.getByTestId('open-in-editor-button'))
      expect(onOpenInEditor).toHaveBeenCalledWith(sql)
    })

    it('is disabled when sql is empty', () => {
      render(<SqlPreviewPanel sql="" onOpenInEditor={vi.fn()} />)
      expect(screen.getByTestId('open-in-editor-button')).toHaveClass('cursor-not-allowed')
    })
  })

  describe('Keyboard shortcut', () => {
    it('executes query on Cmd/Ctrl+Enter', async () => {
      const onExecute = vi.fn().mockResolvedValue(mockQueryResult)

      render(
        <SqlPreviewPanel sql="SELECT * FROM users" onExecute={onExecute} />
      )

      const panel = screen.getByTestId('sql-preview-panel')

      fireEvent.keyDown(panel, { key: 'Enter', ctrlKey: true })

      await waitFor(() => {
        expect(onExecute).toHaveBeenCalled()
      })
    })

    it('executes query on Meta+Enter (Mac)', async () => {
      const onExecute = vi.fn().mockResolvedValue(mockQueryResult)

      render(
        <SqlPreviewPanel sql="SELECT * FROM users" onExecute={onExecute} />
      )

      const panel = screen.getByTestId('sql-preview-panel')

      fireEvent.keyDown(panel, { key: 'Enter', metaKey: true })

      await waitFor(() => {
        expect(onExecute).toHaveBeenCalled()
      })
    })
  })

  describe('Results display', () => {
    it('shows results after successful execution', async () => {
      const user = userEvent.setup()
      const onExecute = vi.fn().mockResolvedValue(mockQueryResult)

      render(
        <SqlPreviewPanel sql="SELECT * FROM users" onExecute={onExecute} />
      )

      await user.click(screen.getByTestId('run-button'))

      await waitFor(() => {
        expect(screen.getByTestId('results-section')).toBeInTheDocument()
        expect(screen.getByTestId('sql-results-display')).toBeInTheDocument()
      })
    })

    it('shows execution time after run', async () => {
      const user = userEvent.setup()
      const onExecute = vi.fn().mockResolvedValue(mockQueryResult)

      render(
        <SqlPreviewPanel sql="SELECT * FROM users" onExecute={onExecute} />
      )

      await user.click(screen.getByTestId('run-button'))

      await waitFor(() => {
        expect(screen.getByTestId('execution-time')).toBeInTheDocument()
      })
    })

    it('shows row count after successful query', async () => {
      const user = userEvent.setup()
      const onExecute = vi.fn().mockResolvedValue(mockQueryResult)

      render(
        <SqlPreviewPanel sql="SELECT * FROM users" onExecute={onExecute} />
      )

      await user.click(screen.getByTestId('run-button'))

      await waitFor(() => {
        expect(screen.getByTestId('row-count')).toBeInTheDocument()
        expect(screen.getByText('2 rows returned')).toBeInTheDocument()
      })
    })

    it('shows error in results on query failure', async () => {
      const user = userEvent.setup()
      const onExecute = vi.fn().mockRejectedValue(new Error('Syntax error'))

      render(
        <SqlPreviewPanel sql="SELECT * FROM users" onExecute={onExecute} />
      )

      await user.click(screen.getByTestId('run-button'))

      await waitFor(() => {
        expect(screen.getByTestId('results-section')).toBeInTheDocument()
      })
    })
  })

  describe('Parameters display', () => {
    it('shows parameters when provided', () => {
      render(
        <SqlPreviewPanel
          sql="SELECT * FROM users WHERE id = ?"
          params={[123]}
        />
      )

      expect(screen.getByTestId('params-preview')).toBeInTheDocument()
      expect(screen.getByText('Parameters:')).toBeInTheDocument()
      expect(screen.getByText('[123]')).toBeInTheDocument()
    })

    it('does not show parameters section when empty', () => {
      render(<SqlPreviewPanel sql="SELECT * FROM users" params={[]} />)
      expect(screen.queryByTestId('params-preview')).not.toBeInTheDocument()
    })
  })

  describe('Read-only mode', () => {
    it('shows warning banner when isReadOnly is true', () => {
      render(
        <SqlPreviewPanel sql="SELECT * FROM users" isReadOnly={true} />
      )

      expect(screen.getByTestId('readonly-warning')).toBeInTheDocument()
      expect(
        screen.getByText('Database is in read-only mode. Only SELECT queries can be executed.')
      ).toBeInTheDocument()
    })

    it('does not show warning when isReadOnly is false', () => {
      render(
        <SqlPreviewPanel sql="SELECT * FROM users" isReadOnly={false} />
      )

      expect(screen.queryByTestId('readonly-warning')).not.toBeInTheDocument()
    })
  })

  describe('Execution status', () => {
    it('shows execution status during query', async () => {
      const user = userEvent.setup()
      let resolveQuery: (value: QueryResult) => void
      const onExecute = vi.fn().mockReturnValue(
        new Promise<QueryResult>((resolve) => {
          resolveQuery = resolve
        })
      )

      render(
        <SqlPreviewPanel sql="SELECT * FROM users" onExecute={onExecute} />
      )

      await user.click(screen.getByTestId('run-button'))

      await waitFor(() => {
        expect(screen.getByTestId('execution-status')).toBeInTheDocument()
        expect(screen.getByText('Executing query...')).toBeInTheDocument()
      })

      act(() => {
        resolveQuery!(mockQueryResult)
      })

      await waitFor(() => {
        expect(screen.queryByText('Executing query...')).not.toBeInTheDocument()
      })
    })
  })
})
