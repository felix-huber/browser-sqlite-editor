/**
 * SqlPreviewPanel Component
 *
 * Displays generated SQL preview with execution controls:
 * - Read-only CodeMirror editor showing generated SQL
 * - Run button with Cmd/Ctrl+Enter shortcut
 * - Cancel button during execution
 * - Copy SQL button
 * - Open in SQL Editor button
 * - Results display using DataGrid
 * - Execution time display
 */

import { memo, useState, useCallback, useMemo, useRef } from 'react'
import { SqlResultsDisplay, type StatementResult } from '../sql/SqlResultsDisplay'
import type { QueryResult, SqlError } from '../../types'
import { formatExecutionTime } from '../../shared/format/time'

/** Props for SqlPreviewPanel */
export interface SqlPreviewPanelProps {
  /** Generated SQL to display */
  sql: string
  /** Parameters for the generated SQL (not used in preview, shown for reference) */
  params?: unknown[]
  /** Callback to execute the query */
  onExecute?: (sql: string, params?: unknown[]) => Promise<QueryResult>
  /** Callback when execution should be canceled */
  onCancel?: () => void
  /** Callback to open SQL in full editor */
  onOpenInEditor?: (sql: string) => void
  /** Whether the database is in read-only mode */
  isReadOnly?: boolean
  /** Whether the panel is loading (e.g., SQL is being generated) */
  isGenerating?: boolean
  /** Additional CSS class */
  className?: string
  /** Height of the panel (default: 100%) */
  height?: number | string
}

/** Copy icon */
function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/** External link icon */
function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

/** Play icon */
function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

/** Stop icon */
function StopIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  )
}

/** Spinner icon */
function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? ''}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
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
  )
}

/**
 * SQL Preview Panel component for query builder.
 * Shows generated SQL with execution controls and results display.
 */
function SqlPreviewPanelComponent({
  sql,
  params = [],
  onExecute,
  onCancel,
  onOpenInEditor,
  isReadOnly = false,
  isGenerating = false,
  className = '',
  height = '100%',
}: SqlPreviewPanelProps) {
  const [isExecuting, setIsExecuting] = useState(false)
  const [results, setResults] = useState<StatementResult[]>([])
  const [executionTime, setExecutionTime] = useState<number | null>(null)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Handle query execution
  const handleExecute = useCallback(async () => {
    if (!onExecute || !sql.trim() || isExecuting) return

    setIsExecuting(true)
    setResults([])
    setExecutionTime(null)
    abortControllerRef.current = new AbortController()

    const startTime = performance.now()

    try {
      const result = await onExecute(sql, params)
      const endTime = performance.now()
      const duration = endTime - startTime
      setExecutionTime(duration)

      // Convert to StatementResult format
      const statementResult: StatementResult = {
        sql,
        type: 'select',
        result,
        executionTime: duration,
      }
      setResults([statementResult])
    } catch (err) {
      const endTime = performance.now()
      const duration = endTime - startTime
      setExecutionTime(duration)

      // Handle error
      const error: SqlError = {
        message: err instanceof Error ? err.message : String(err),
      }

      // Try to parse line number from error message
      if (err instanceof Error) {
        const lineMatch = err.message.match(/line (\d+)/i)
        const columnMatch = err.message.match(/column (\d+)/i)
        if (lineMatch) error.line = parseInt(lineMatch[1], 10)
        if (columnMatch) error.column = parseInt(columnMatch[1], 10)
      }

      const statementResult: StatementResult = {
        sql,
        type: 'error',
        error,
        executionTime: duration,
      }
      setResults([statementResult])
    } finally {
      setIsExecuting(false)
      abortControllerRef.current = null
    }
  }, [sql, params, onExecute, isExecuting])

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    onCancel?.()
    setIsExecuting(false)
  }, [onCancel])

  // Handle copy to clipboard
  const handleCopy = useCallback(async () => {
    if (!sql.trim()) return

    try {
      await navigator.clipboard.writeText(sql)
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = sql
      textArea.style.position = 'fixed'
      textArea.style.left = '-999999px'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    }
  }, [sql])

  // Handle open in SQL editor
  const handleOpenInEditor = useCallback(() => {
    onOpenInEditor?.(sql)
  }, [sql, onOpenInEditor])

  // Handle keyboard shortcut
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Cmd/Ctrl + Enter to run
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleExecute()
      }
    },
    [handleExecute]
  )

  // Check if SQL is empty or just whitespace
  const hasSql = sql.trim().length > 0

  // Calculate if we can run
  const canRun = hasSql && !isExecuting && !isGenerating && !!onExecute

  // Calculate results height dynamically
  const resultsHeight = useMemo(() => {
    if (results.length === 0) return 0
    const firstResult = results[0]
    if (firstResult.type === 'select' && firstResult.result) {
      const rowCount = firstResult.result.rows.length
      // Estimate height: header (40px) + rows (32px each) + status bar (28px)
      // Cap at 300px for readability
      return Math.min(40 + rowCount * 32 + 28, 300)
    }
    // For errors or non-SELECT, use fixed height
    return 150
  }, [results])

  return (
    <div
      className={`flex flex-col bg-white border border-navy-200 rounded-lg overflow-hidden ${className}`}
      style={{ height }}
      onKeyDown={handleKeyDown}
      data-testid="sql-preview-panel"
    >
      {/* Header / Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-navy-50 border-b border-navy-200 shrink-0">
        <h4 className="text-sm font-semibold text-navy-700">SQL Preview</h4>
        <div className="flex-1" />

        {/* Run button */}
        <button
          onClick={handleExecute}
          disabled={!canRun}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded transition-colors ${
            canRun
              ? 'bg-navy-600 text-white hover:bg-navy-700'
              : 'bg-navy-200 text-navy-400 cursor-not-allowed'
          }`}
          title={`Run query (${navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+Enter)`}
          data-testid="run-button"
        >
          {isExecuting ? (
            <>
              <SpinnerIcon />
              Running...
            </>
          ) : (
            <>
              <PlayIcon />
              Run
            </>
          )}
        </button>

        {/* Cancel button (shown during execution) */}
        {isExecuting && onCancel && (
          <button
            onClick={handleCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors"
            data-testid="cancel-button"
          >
            <StopIcon />
            Cancel
          </button>
        )}

        <div className="w-px h-5 bg-navy-200" />

        {/* Copy button */}
        <button
          onClick={handleCopy}
          disabled={!hasSql}
          className={`flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium rounded transition-colors ${
            hasSql
              ? 'text-navy-600 hover:bg-navy-100'
              : 'text-navy-300 cursor-not-allowed'
          }`}
          title="Copy SQL to clipboard"
          data-testid="copy-button"
        >
          <CopyIcon />
          {copyFeedback ? 'Copied!' : 'Copy'}
        </button>

        {/* Open in SQL Editor button */}
        {onOpenInEditor && (
          <button
            onClick={handleOpenInEditor}
            disabled={!hasSql}
            className={`flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium rounded transition-colors ${
              hasSql
                ? 'text-navy-600 hover:bg-navy-100'
                : 'text-navy-300 cursor-not-allowed'
            }`}
            title="Open in SQL Editor"
            data-testid="open-in-editor-button"
          >
            <ExternalLinkIcon />
            Open in Editor
          </button>
        )}
      </div>

      {/* SQL Preview Editor */}
      <div className="flex-1 min-h-[100px] overflow-hidden">
        {isGenerating ? (
          <div
            className="flex items-center justify-center h-full text-navy-500"
            data-testid="generating-indicator"
          >
            <SpinnerIcon className="mr-2" />
            Generating SQL...
          </div>
        ) : !hasSql ? (
          <div
            className="flex items-center justify-center h-full text-navy-400 text-sm"
            data-testid="empty-state"
          >
            Add tables and configure your query to see the generated SQL
          </div>
        ) : (
          <div
            className="h-full overflow-auto bg-navy-900 text-navy-100 font-mono text-xs p-3"
            data-testid="sql-preview-text"
          >
            <pre className="whitespace-pre">{sql}</pre>
          </div>
        )}
      </div>

      {/* Parameters preview (if any) */}
      {params.length > 0 && (
        <div
          className="px-3 py-2 bg-navy-50 border-t border-navy-200 text-xs font-mono text-navy-600 shrink-0"
          data-testid="params-preview"
        >
          <span className="font-semibold">Parameters:</span>{' '}
          {JSON.stringify(params)}
        </div>
      )}

      {/* Execution status bar */}
      {(isExecuting || executionTime !== null) && (
        <div
          className="flex items-center gap-3 px-3 py-1.5 text-xs text-navy-500 bg-navy-50 border-t border-navy-200 shrink-0"
          data-testid="execution-status"
        >
          {isExecuting ? (
            <>
              <SpinnerIcon className="w-3 h-3" />
              <span>Executing query...</span>
            </>
          ) : (
            <>
              {executionTime !== null && (
                <span data-testid="execution-time">
                  Executed in {formatExecutionTime(executionTime)}
                </span>
              )}
              {results.length > 0 && results[0].type === 'select' && results[0].result && (
                <span data-testid="row-count">
                  {results[0].result.rows.length} row
                  {results[0].result.rows.length !== 1 ? 's' : ''} returned
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Results display */}
      {results.length > 0 && (
        <div
          className="border-t border-navy-200 shrink-0"
          style={{ height: resultsHeight > 0 ? resultsHeight : 'auto' }}
          data-testid="results-section"
        >
          <SqlResultsDisplay
            results={results}
            totalExecutionTime={executionTime ?? undefined}
            height={resultsHeight}
          />
        </div>
      )}

      {/* Read-only mode warning */}
      {isReadOnly && (
        <div
          className="px-3 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-700 shrink-0"
          data-testid="readonly-warning"
        >
          Database is in read-only mode. Only SELECT queries can be executed.
        </div>
      )}
    </div>
  )
}

export const SqlPreviewPanel = memo(SqlPreviewPanelComponent)

export default SqlPreviewPanel
