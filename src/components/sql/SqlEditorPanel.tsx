import { useState, useCallback, useRef, useEffect } from 'react'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import type { QueryResult, SqlError, QueryHistoryItem } from '../../types'

/**
 * Check if a SQL statement is read-only.
 * Returns true for SELECT and read-only PRAGMAs.
 */
function isReadOnlyStatement(sql: string): boolean {
  const normalized = sql.trim().toUpperCase()

  // SELECT and WITH (CTE) are always read-only
  if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) {
    return true
  }

  // EXPLAIN is read-only
  if (normalized.startsWith('EXPLAIN')) {
    return true
  }

  // PRAGMA: only certain ones are read-only
  if (normalized.startsWith('PRAGMA')) {
    // Write PRAGMAs (setting values)
    const writePragmas = [
      'PRAGMA JOURNAL_MODE',
      'PRAGMA WAL_CHECKPOINT',
      'PRAGMA FOREIGN_KEYS',
      'PRAGMA SYNCHRONOUS',
      'PRAGMA CACHE_SIZE',
      'PRAGMA TEMP_STORE',
      'PRAGMA SECURE_DELETE',
      'PRAGMA AUTO_VACUUM',
      'PRAGMA RECURSIVE_TRIGGERS',
      'PRAGMA WRITABLE_SCHEMA',
      'PRAGMA PAGE_SIZE',
    ]

    // Check if it's a write pragma (PRAGMA name = value)
    // Read pragmas are: PRAGMA name or PRAGMA name(table)
    const hasEquals = normalized.includes('=')

    // If it has an equals sign, check if it's a known write pragma
    if (hasEquals) {
      return false // Setting a pragma value is a write operation
    }

    // Check for write pragmas that use function syntax
    for (const wp of writePragmas) {
      if (normalized.startsWith(wp + '(')) {
        return false
      }
    }

    return true // Read-only PRAGMA query
  }

  // DML statements are not read-only
  if (
    normalized.startsWith('INSERT') ||
    normalized.startsWith('UPDATE') ||
    normalized.startsWith('DELETE') ||
    normalized.startsWith('REPLACE')
  ) {
    return false
  }

  // DDL statements are not read-only
  if (
    normalized.startsWith('CREATE') ||
    normalized.startsWith('ALTER') ||
    normalized.startsWith('DROP') ||
    normalized.startsWith('VACUUM') ||
    normalized.startsWith('REINDEX') ||
    normalized.startsWith('ANALYZE')
  ) {
    return false
  }

  // Transaction control
  if (
    normalized.startsWith('BEGIN') ||
    normalized.startsWith('COMMIT') ||
    normalized.startsWith('ROLLBACK') ||
    normalized.startsWith('SAVEPOINT') ||
    normalized.startsWith('RELEASE')
  ) {
    return false
  }

  // Unknown - assume not read-only for safety
  return false
}

export interface SqlEditorPanelProps {
  /** Callback when a query should be executed */
  onExecute: (sql: string) => Promise<QueryResult>
  /** Callback when execution should be canceled */
  onCancel?: () => void
  /** Query history for dropdown */
  history?: QueryHistoryItem[]
  /** Whether the database is in read-only mode */
  isReadOnly?: boolean
  /** Initial SQL value */
  initialValue?: string
  /** Additional CSS class */
  className?: string
}

/**
 * Full SQL editor panel with toolbar, run button, history, and results display.
 */
export function SqlEditorPanel({
  onExecute,
  onCancel,
  history = [],
  isReadOnly = false,
  initialValue = '',
  className = '',
}: SqlEditorPanelProps) {
  const [sql, setSql] = useState(initialValue)
  const [isExecuting, setIsExecuting] = useState(false)
  const [error, setError] = useState<SqlError | null>(null)
  const [results, setResults] = useState<QueryResult | null>(null)
  const [executionTime, setExecutionTime] = useState<number | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [readOnlyWarning, setReadOnlyWarning] = useState<string | null>(null)

  const historyRef = useRef<HTMLDivElement>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  // Close history dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
        setShowHistory(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const executeQuery = useCallback(async () => {
    const queryText = sql.trim()
    if (!queryText || isExecuting) return

    // Check read-only guard
    if (isReadOnly && !isReadOnlyStatement(queryText)) {
      setReadOnlyWarning('Cannot execute write operations in read-only mode. Only SELECT queries and read-only PRAGMAs are allowed.')
      setError(null)
      setResults(null)
      return
    }

    setIsExecuting(true)
    setError(null)
    setResults(null)
    setReadOnlyWarning(null)
    const startTime = performance.now()

    try {
      const result = await onExecute(queryText)
      const endTime = performance.now()
      setExecutionTime(endTime - startTime)
      setResults(result)
    } catch (err) {
      const endTime = performance.now()
      setExecutionTime(endTime - startTime)

      if (err instanceof Error) {
        // Parse error for line number if available
        const lineMatch = err.message.match(/line (\d+)/i)
        const columnMatch = err.message.match(/column (\d+)/i)

        setError({
          message: err.message,
          line: lineMatch ? parseInt(lineMatch[1], 10) : undefined,
          column: columnMatch ? parseInt(columnMatch[1], 10) : undefined,
        })
      } else {
        setError({ message: String(err) })
      }
    } finally {
      setIsExecuting(false)
    }
  }, [sql, isExecuting, isReadOnly, onExecute])

  const handleCancel = useCallback(() => {
    if (onCancel) {
      onCancel()
    }
    setIsExecuting(false)
  }, [onCancel])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Ctrl/Cmd + Enter to run query
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        executeQuery()
      }
    },
    [executeQuery]
  )

  const handleHistorySelect = useCallback((item: QueryHistoryItem) => {
    setSql(item.sql)
    setShowHistory(false)
    // Clear previous results when loading from history
    setError(null)
    setResults(null)
    setReadOnlyWarning(null)
  }, [])

  const formatTime = (ms: number): string => {
    if (ms < 1000) {
      return `${ms.toFixed(0)}ms`
    }
    return `${(ms / 1000).toFixed(2)}s`
  }

  return (
    <div
      className={`flex flex-col h-full bg-navy-50 ${className}`}
      onKeyDown={handleKeyDown}
      data-testid="sql-editor-panel"
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-navy-200">
        {/* Run button */}
        <button
          onClick={executeQuery}
          disabled={isExecuting || !sql.trim()}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded transition-colors ${
            isExecuting || !sql.trim()
              ? 'bg-navy-100 text-navy-400 cursor-not-allowed'
              : 'bg-navy-600 text-white hover:bg-navy-700'
          }`}
          data-testid="run-button"
          title="Run query (Ctrl+Enter)"
        >
          {isExecuting ? (
            <>
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Running...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                />
              </svg>
              Run
            </>
          )}
        </button>

        {/* Cancel button - only shown during execution */}
        {isExecuting && onCancel && (
          <button
            onClick={handleCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-navy-700 bg-white border border-navy-300 rounded hover:bg-navy-50 transition-colors"
            data-testid="cancel-button"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            Cancel
          </button>
        )}

        <div className="flex-1" />

        {/* History dropdown */}
        {history.length > 0 && (
          <div className="relative" ref={historyRef}>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-navy-700 bg-white border border-navy-300 rounded hover:bg-navy-50 transition-colors"
              data-testid="history-button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              History
              <svg
                className={`w-4 h-4 transition-transform ${showHistory ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {showHistory && (
              <div
                className="absolute right-0 mt-1 w-80 max-h-64 overflow-auto bg-white border border-navy-200 rounded-lg shadow-lg z-10"
                data-testid="history-dropdown"
              >
                {history.map((item, index) => (
                  <button
                    key={index}
                    onClick={() => handleHistorySelect(item)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-navy-50 border-b border-navy-100 last:border-b-0"
                    data-testid={`history-item-${index}`}
                  >
                    <div className="font-mono text-navy-900 truncate">{item.sql}</div>
                    <div className="text-xs text-navy-500 mt-0.5">
                      {new Date(item.executedAt).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Keyboard shortcut hint */}
        <span className="text-xs text-navy-400">
          {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+Enter to run
        </span>
      </div>

      {/* Editor area */}
      <div ref={editorContainerRef} className="flex-1 min-h-0 overflow-hidden">
        <CodeMirrorEditor
          value={sql}
          onChange={setSql}
          className="h-full"
          placeholder="Enter SQL query..."
        />
      </div>

      {/* Results area */}
      <div className="border-t border-navy-200 bg-white">
        {/* Status bar */}
        {(executionTime !== null || isExecuting) && (
          <div className="flex items-center gap-3 px-3 py-1.5 text-xs text-navy-500 border-b border-navy-100">
            {isExecuting ? (
              <span>Executing...</span>
            ) : (
              <>
                {executionTime !== null && (
                  <span data-testid="execution-time">
                    Executed in {formatTime(executionTime)}
                  </span>
                )}
                {results && (
                  <span data-testid="result-count">
                    {results.rows.length} row{results.rows.length !== 1 ? 's' : ''} returned
                    {results.hasMore && ' (more available)'}
                  </span>
                )}
                {results?.rowsAffected !== undefined && results.rowsAffected > 0 && (
                  <span data-testid="rows-affected">
                    {results.rowsAffected} row{results.rowsAffected !== 1 ? 's' : ''} affected
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/* Read-only warning */}
        {readOnlyWarning && (
          <div
            className="flex items-start gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200"
            role="alert"
            data-testid="readonly-warning"
          >
            <svg
              className="w-5 h-5 text-amber-600 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div className="text-sm text-amber-800">{readOnlyWarning}</div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div
            className="flex items-start gap-2 px-3 py-2 bg-red-50 border-b border-red-200"
            role="alert"
            data-testid="error-display"
          >
            <svg
              className="w-5 h-5 text-red-600 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="text-sm">
              <span className="font-medium text-red-800">Error</span>
              {error.line && (
                <span className="text-red-600"> at line {error.line}</span>
              )}
              {error.column && (
                <span className="text-red-600">, column {error.column}</span>
              )}
              <div className="text-red-700 mt-0.5" data-testid="error-message">
                {error.message}
              </div>
            </div>
          </div>
        )}

        {/* Results table */}
        {results && results.rows.length > 0 && (
          <div className="max-h-64 overflow-auto" data-testid="results-table">
            <table className="w-full text-sm">
              <thead className="bg-navy-100 sticky top-0">
                <tr>
                  {results.columns.map((col, i) => (
                    <th
                      key={i}
                      className="px-3 py-2 text-left font-medium text-navy-700 border-b border-navy-200"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.rows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className="hover:bg-navy-50 border-b border-navy-100"
                  >
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="px-3 py-1.5 text-navy-900 max-w-xs truncate"
                      >
                        {cell === null ? (
                          <span className="text-navy-400 italic">NULL</span>
                        ) : cell instanceof Uint8Array ? (
                          <span className="text-navy-500 font-mono text-xs">
                            [BLOB {cell.length} bytes]
                          </span>
                        ) : (
                          String(cell)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty results message */}
        {results && results.rows.length === 0 && !error && (
          <div className="px-3 py-4 text-center text-sm text-navy-500" data-testid="empty-results">
            Query executed successfully. No rows returned.
          </div>
        )}
      </div>
    </div>
  )
}

export default SqlEditorPanel
