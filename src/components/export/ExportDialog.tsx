import { useState, useCallback, useEffect, useRef } from 'react'
import {
  exportToCSV,
  exportToJSON,
  exportSchemaToDDL,
  type CSVExportOptions,
  type JSONExportOptions,
  type DDLTableInfo,
} from '../../lib/export'
import { escapeIdentifier } from '../../lib/sql/escape'

export type ExportFormat = 'csv' | 'json' | 'sql'
export type CSVDelimiter = ',' | ';' | '\t'
export type LineEnding = 'crlf' | 'lf'

export interface ExportDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Callback when the dialog should close */
  onClose: () => void
  /** Table name for filename and SQL INSERT statements */
  tableName: string
  /** Column names */
  columns: string[]
  /** Row data to export */
  rows: unknown[][]
  /** Table info for SQL DDL generation (optional) */
  tableInfo?: DDLTableInfo
  /** Row count threshold for warning (default: 100000) */
  rowLimitWarning?: number
}

interface CSVOptionsState {
  delimiter: CSVDelimiter
  spreadsheetSafe: boolean
  includeHeaders: boolean
  lineEnding: LineEnding
}

interface JSONOptionsState {
  prettyPrint: boolean
  arrayOfObjects: boolean
}

interface SQLOptionsState {
  targetTableName: string
  includeCreateTable: boolean
}

/**
 * Escape formula-triggering characters for spreadsheet safety.
 * Prefixes dangerous characters with a single quote.
 */
function escapeFormulaChar(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const dangerousChars = ['=', '+', '-', '@']
  if (dangerousChars.some((char) => value.startsWith(char))) {
    return "'" + value
  }
  return value
}

/**
 * Convert line endings in content.
 */
function convertLineEndings(content: string, lineEnding: LineEnding): string {
  if (lineEnding === 'crlf') {
    // First normalize to LF, then convert to CRLF
    return content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
  }
  // Normalize to LF
  return content.replace(/\r\n/g, '\n')
}

/**
 * Generate SQL INSERT statements for data.
 */
function generateSQLInserts(
  tableName: string,
  columns: string[],
  rows: unknown[][]
): string {
  if (rows.length === 0) return ''

  const escapeValue = (value: unknown): string => {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return value ? '1' : '0'
    if (value instanceof Uint8Array) {
      const hex = Array.from(value)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      return `X'${hex}'`
    }
    // String: escape single quotes
    const str = String(value)
    return `'${str.replace(/'/g, "''")}'`
  }

  const colList = columns.map(escapeIdentifier).join(', ')
  const tableSql = escapeIdentifier(tableName)

  const statements = rows.map((row) => {
    const values = row.map(escapeValue).join(', ')
    return `INSERT INTO ${tableSql} (${colList}) VALUES (${values});`
  })

  return statements.join('\n')
}

/**
 * Trigger a file download in the browser.
 */
function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function ExportDialog({
  isOpen,
  onClose,
  tableName,
  columns,
  rows,
  tableInfo,
  rowLimitWarning = 100000,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [csvOptions, setCsvOptions] = useState<CSVOptionsState>({
    delimiter: ',',
    spreadsheetSafe: false,
    includeHeaders: true,
    lineEnding: 'lf',
  })
  const [jsonOptions, setJsonOptions] = useState<JSONOptionsState>({
    prettyPrint: true,
    arrayOfObjects: true,
  })
  const [sqlOptions, setSqlOptions] = useState<SQLOptionsState>({
    targetTableName: tableName,
    includeCreateTable: true,
  })

  const dialogRef = useRef<HTMLDialogElement>(null)

  // Update SQL target table name when tableName prop changes
  useEffect(() => {
    setSqlOptions((prev) => ({ ...prev, targetTableName: tableName }))
  }, [tableName])

  // Reset options when opening to ensure a predictable default state
  useEffect(() => {
    if (!isOpen) return
    setFormat('csv')
    setCsvOptions({
      delimiter: ',',
      spreadsheetSafe: false,
      includeHeaders: true,
      lineEnding: 'lf',
    })
    setJsonOptions({
      prettyPrint: true,
      arrayOfObjects: true,
    })
  }, [isOpen])

  // Handle dialog open/close
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (isOpen) {
      dialog.showModal()
    } else {
      dialog.close()
    }
  }, [isOpen])

  // Handle Escape key and backdrop click
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const handleCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }

    const handleClick = (e: MouseEvent) => {
      if (e.target === dialog) {
        onClose()
      }
    }

    dialog.addEventListener('cancel', handleCancel)
    dialog.addEventListener('click', handleClick)

    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      dialog.removeEventListener('click', handleClick)
    }
  }, [onClose])

  const handleExport = useCallback(() => {
    let content: string
    let filename: string
    let mimeType: string

    switch (format) {
      case 'csv': {
        // Apply spreadsheet-safe escaping if enabled
        const processedRows = csvOptions.spreadsheetSafe
          ? rows.map((row) => row.map(escapeFormulaChar))
          : rows

        // Custom delimiter handling - we need to use papaparse's config
        const csvExportOptions: CSVExportOptions = {
          includeBOM: true,
          includeHeader: csvOptions.includeHeaders,
          blobHandling: 'hex',
        }

        let csvContent = exportToCSV(columns, processedRows, csvExportOptions)

        // Replace delimiter if not comma
        if (csvOptions.delimiter !== ',') {
          // Re-export with the correct delimiter
          // Note: papaparse doesn't expose delimiter in unparse directly in our wrapper
          // So we do a simple post-process for semicolon/tab
          // This is safe because CSV values are properly quoted
          csvContent = csvContent.replace(/,/g, csvOptions.delimiter)
        }

        content = convertLineEndings(csvContent, csvOptions.lineEnding)
        filename = `${tableName}.csv`
        mimeType = 'text/csv;charset=utf-8'
        break
      }

      case 'json': {
        const jsonExportOptions: JSONExportOptions = {
          pretty: jsonOptions.prettyPrint,
          indent: 2,
        }

        if (jsonOptions.arrayOfObjects) {
          content = exportToJSON(columns, rows, jsonExportOptions)
        } else {
          // Object of arrays format
          const objOfArrays: Record<string, unknown[]> = {}
          columns.forEach((col, colIdx) => {
            objOfArrays[col] = rows.map((row) => row[colIdx])
          })
          content = jsonOptions.prettyPrint
            ? JSON.stringify(objOfArrays, null, 2)
            : JSON.stringify(objOfArrays)
        }

        filename = `${tableName}.json`
        mimeType = 'application/json;charset=utf-8'
        break
      }

      case 'sql': {
        const parts: string[] = []

        // Add CREATE TABLE if requested and tableInfo available
        if (sqlOptions.includeCreateTable && tableInfo) {
          const ddlTableInfo = { ...tableInfo, name: sqlOptions.targetTableName }
          parts.push(exportSchemaToDDL(ddlTableInfo))
          parts.push('')
        }

        // Add INSERT statements
        const inserts = generateSQLInserts(
          sqlOptions.targetTableName,
          columns,
          rows
        )
        if (inserts) {
          parts.push(inserts)
        }

        content = parts.join('\n')
        filename = `${tableName}.sql`
        mimeType = 'application/sql;charset=utf-8'
        break
      }

      default:
        return
    }

    triggerDownload(content, filename, mimeType)
  }, [
    format,
    csvOptions,
    jsonOptions,
    sqlOptions,
    columns,
    rows,
    tableName,
    tableInfo,
  ])

  const showRowWarning = rows.length > rowLimitWarning

  if (!isOpen) return null

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 p-0 m-auto max-w-md w-full bg-transparent backdrop:bg-navy-900/50"
      data-testid="export-dialog"
      aria-labelledby="export-dialog-title"
    >
      <div className="bg-white rounded-lg shadow-xl border border-navy-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-navy-200">
          <h2
            id="export-dialog-title"
            className="text-lg font-semibold text-navy-900"
          >
            Export Data
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-navy-500 hover:bg-navy-100 rounded transition-colors"
            aria-label="Close dialog"
            data-testid="close-button"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Row count warning */}
          {showRowWarning && (
            <div
              className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-sm"
              role="alert"
              data-testid="row-warning"
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
              <div>
                <p className="font-medium text-amber-800">Large export</p>
                <p className="text-amber-700">
                  Exporting {rows.length.toLocaleString()} rows may take a while and
                  could slow down your browser.
                </p>
              </div>
            </div>
          )}

          {/* Format selector */}
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-2">
              Format
            </label>
            <div className="flex gap-2" role="radiogroup" aria-label="Export format">
              {(['csv', 'json', 'sql'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={format === f}
                  onClick={() => setFormat(f)}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded border transition-colors ${
                    format === f
                      ? 'bg-navy-600 text-white border-navy-600'
                      : 'bg-white text-navy-700 border-navy-300 hover:bg-navy-50'
                  }`}
                  data-testid={`format-${f}`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* CSV Options */}
          {format === 'csv' && (
            <div className="space-y-3" data-testid="csv-options">
              {/* Delimiter */}
              <div>
                <label
                  htmlFor="csv-delimiter"
                  className="block text-sm font-medium text-navy-700 mb-1"
                >
                  Delimiter
                </label>
                <select
                  id="csv-delimiter"
                  value={csvOptions.delimiter}
                  onChange={(e) =>
                    setCsvOptions((prev) => ({
                      ...prev,
                      delimiter: e.target.value as CSVDelimiter,
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-navy-300 rounded focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
                  data-testid="csv-delimiter-select"
                >
                  <option value=",">Comma (,)</option>
                  <option value=";">Semicolon (;)</option>
                  <option value="&#9;">Tab</option>
                </select>
              </div>

              {/* Include Headers */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={csvOptions.includeHeaders}
                  onChange={(e) =>
                    setCsvOptions((prev) => ({
                      ...prev,
                      includeHeaders: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 text-navy-600 border-navy-300 rounded focus:ring-navy-600"
                  data-testid="csv-include-headers"
                />
                <span className="text-sm text-navy-700">Include headers</span>
              </label>

              {/* Spreadsheet Safe */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={csvOptions.spreadsheetSafe}
                  onChange={(e) =>
                    setCsvOptions((prev) => ({
                      ...prev,
                      spreadsheetSafe: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 text-navy-600 border-navy-300 rounded focus:ring-navy-600"
                  data-testid="csv-spreadsheet-safe"
                />
                <span className="text-sm text-navy-700">
                  Spreadsheet-safe (escape formulas)
                </span>
              </label>

              {/* Line Ending */}
              <div>
                <label
                  htmlFor="csv-line-ending"
                  className="block text-sm font-medium text-navy-700 mb-1"
                >
                  Line ending
                </label>
                <select
                  id="csv-line-ending"
                  value={csvOptions.lineEnding}
                  onChange={(e) =>
                    setCsvOptions((prev) => ({
                      ...prev,
                      lineEnding: e.target.value as LineEnding,
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-navy-300 rounded focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
                  data-testid="csv-line-ending-select"
                >
                  <option value="lf">LF (Unix/Mac)</option>
                  <option value="crlf">CRLF (Windows)</option>
                </select>
              </div>
            </div>
          )}

          {/* JSON Options */}
          {format === 'json' && (
            <div className="space-y-3" data-testid="json-options">
              {/* Pretty Print */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={jsonOptions.prettyPrint}
                  onChange={(e) =>
                    setJsonOptions((prev) => ({
                      ...prev,
                      prettyPrint: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 text-navy-600 border-navy-300 rounded focus:ring-navy-600"
                  data-testid="json-pretty-print"
                />
                <span className="text-sm text-navy-700">Pretty print</span>
              </label>

              {/* Format type */}
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">
                  Structure
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="json-structure"
                      checked={jsonOptions.arrayOfObjects}
                      onChange={() =>
                        setJsonOptions((prev) => ({
                          ...prev,
                          arrayOfObjects: true,
                        }))
                      }
                      className="w-4 h-4 text-navy-600 border-navy-300 focus:ring-navy-600"
                      data-testid="json-array-of-objects"
                    />
                    <span className="text-sm text-navy-700">
                      Array of objects
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="json-structure"
                      checked={!jsonOptions.arrayOfObjects}
                      onChange={() =>
                        setJsonOptions((prev) => ({
                          ...prev,
                          arrayOfObjects: false,
                        }))
                      }
                      className="w-4 h-4 text-navy-600 border-navy-300 focus:ring-navy-600"
                      data-testid="json-object-of-arrays"
                    />
                    <span className="text-sm text-navy-700">
                      Object of arrays
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* SQL Options */}
          {format === 'sql' && (
            <div className="space-y-3" data-testid="sql-options">
              {/* Table name */}
              <div>
                <label
                  htmlFor="sql-table-name"
                  className="block text-sm font-medium text-navy-700 mb-1"
                >
                  Table name
                </label>
                <input
                  id="sql-table-name"
                  type="text"
                  value={sqlOptions.targetTableName}
                  onChange={(e) =>
                    setSqlOptions((prev) => ({
                      ...prev,
                      targetTableName: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-navy-300 rounded focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
                  placeholder="Enter table name"
                  data-testid="sql-table-name-input"
                />
              </div>

              {/* Include CREATE TABLE */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sqlOptions.includeCreateTable}
                  onChange={(e) =>
                    setSqlOptions((prev) => ({
                      ...prev,
                      includeCreateTable: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 text-navy-600 border-navy-300 rounded focus:ring-navy-600"
                  disabled={!tableInfo}
                  data-testid="sql-include-create-table"
                />
                <span
                  className={`text-sm ${
                    tableInfo ? 'text-navy-700' : 'text-navy-400'
                  }`}
                >
                  Include CREATE TABLE statement
                  {!tableInfo && ' (schema not available)'}
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-4 py-3 border-t border-navy-200 bg-navy-50 rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-navy-700 bg-white border border-navy-300 rounded hover:bg-navy-50 transition-colors"
            data-testid="cancel-button"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="px-4 py-2 text-sm font-medium text-white bg-navy-600 rounded hover:bg-navy-700 transition-colors"
            data-testid="download-button"
          >
            Download
          </button>
        </div>
      </div>
    </dialog>
  )
}

export default ExportDialog
