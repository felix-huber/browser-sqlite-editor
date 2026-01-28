import Papa from 'papaparse'

export type ColumnType = 'INTEGER' | 'REAL' | 'TEXT'

export interface ColumnDef {
  name: string
  type: ColumnType
  originalName: string
}

export interface ParseResult {
  columns: ColumnDef[]
  rows: unknown[][]
  hasHeader: boolean
}

const SAMPLE_ROWS_FOR_TYPE_INFERENCE = 100

/**
 * Strip UTF-8 BOM from string if present
 */
function stripBOM(str: string): string {
  if (str.charCodeAt(0) === 0xfeff) {
    return str.slice(1)
  }
  return str
}

/**
 * Normalize header name:
 * - Trim whitespace
 * - Replace spaces with underscores
 * - Handle empty headers by generating column_N
 */
function normalizeHeader(header: string, index: number): { name: string; originalName: string } {
  const originalName = header
  let name = header.trim()

  if (!name) {
    name = `column_${index + 1}`
  } else {
    name = name.replace(/\s+/g, '_')
  }

  return { name, originalName }
}

/**
 * Infer column type from sample values
 * - If all non-empty values are integers → INTEGER
 * - If all non-empty values are numbers → REAL
 * - Otherwise → TEXT
 */
function inferColumnType(values: unknown[]): ColumnType {
  let hasValue = false
  let allIntegers = true
  let allNumbers = true

  for (const value of values) {
    if (value === null || value === undefined || value === '') {
      continue
    }

    hasValue = true
    const str = String(value).trim()

    if (str === '') continue

    const num = Number(str)
    if (isNaN(num)) {
      allNumbers = false
      allIntegers = false
      break
    }

    if (!Number.isInteger(num)) {
      allIntegers = false
    }
  }

  if (!hasValue) return 'TEXT'
  if (allIntegers) return 'INTEGER'
  if (allNumbers) return 'REAL'
  return 'TEXT'
}

/**
 * Detect if first row looks like headers
 * Heuristic: if first row has all strings and subsequent rows have numbers, it's likely a header
 */
function detectHasHeader(rows: unknown[][]): boolean {
  if (rows.length < 2) return true // Assume header if only one row

  const firstRow = rows[0]
  const secondRow = rows[1]

  // If first row has any numeric value and second row also has numeric in same column,
  // probably no header
  let firstRowHasNumeric = false
  let columnsWhereFirstIsTextAndSecondIsNumeric = 0

  for (let i = 0; i < firstRow.length; i++) {
    const first = String(firstRow[i] ?? '').trim()
    const second = String(secondRow[i] ?? '').trim()

    const firstIsNum = first !== '' && !isNaN(Number(first))
    const secondIsNum = second !== '' && !isNaN(Number(second))

    if (firstIsNum) firstRowHasNumeric = true
    if (!firstIsNum && secondIsNum) columnsWhereFirstIsTextAndSecondIsNumeric++
  }

  // If first row has no numeric values but second row does, likely has header
  if (!firstRowHasNumeric && columnsWhereFirstIsTextAndSecondIsNumeric > 0) {
    return true
  }

  // If first row has numeric values, probably no header
  if (firstRowHasNumeric) {
    return false
  }

  return true
}

/**
 * Parse CSV from string
 */
export function parseCSVString(csvString: string): ParseResult {
  // Strip BOM
  const cleanString = stripBOM(csvString)

  if (!cleanString.trim()) {
    return { columns: [], rows: [], hasHeader: true }
  }

  // Parse with auto-detected delimiter
  const result = Papa.parse<string[]>(cleanString, {
    header: false,
    skipEmptyLines: 'greedy',
    dynamicTyping: false, // Keep as strings for now, we'll do our own type inference
  })

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(`CSV parse error: ${result.errors[0]?.message || 'Unknown error'}`)
  }

  const rows = result.data as string[][]

  if (rows.length === 0) {
    return { columns: [], rows: [], hasHeader: true }
  }

  // Normalize row lengths to max width
  const maxWidth = Math.max(...rows.map(r => r.length))
  const normalizedRows = rows.map(row => {
    const normalized = [...row]
    while (normalized.length < maxWidth) {
      normalized.push('')
    }
    return normalized.slice(0, maxWidth)
  })

  const hasHeader = detectHasHeader(normalizedRows)

  // Extract headers and data rows
  const headerRow = hasHeader ? normalizedRows[0] : []
  const dataRows = hasHeader ? normalizedRows.slice(1) : normalizedRows

  // Build column definitions
  const columns: ColumnDef[] = []
  for (let i = 0; i < maxWidth; i++) {
    const rawHeader = hasHeader ? (headerRow[i] ?? '') : ''
    const { name, originalName } = normalizeHeader(rawHeader, i)

    // Get sample values for type inference
    const sampleValues = dataRows
      .slice(0, SAMPLE_ROWS_FOR_TYPE_INFERENCE)
      .map(row => row[i])

    const type = inferColumnType(sampleValues)

    columns.push({ name, type, originalName })
  }

  // Convert data rows to appropriate types
  const typedRows = dataRows.map(row =>
    row.map((cell, colIndex) => {
      if (cell === '' || cell === null || cell === undefined) {
        return null
      }

      const colType = columns[colIndex]?.type ?? 'TEXT'
      const trimmed = String(cell).trim()

      if (trimmed === '') return null

      if (colType === 'INTEGER') {
        const num = parseInt(trimmed, 10)
        return isNaN(num) ? trimmed : num
      }
      if (colType === 'REAL') {
        const num = parseFloat(trimmed)
        return isNaN(num) ? trimmed : num
      }
      return trimmed
    })
  )

  return { columns, rows: typedRows, hasHeader }
}

/**
 * Parse CSV from File using streaming for large files
 */
export function parseCSVFile(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const rows: string[][] = []
    let isFirstChunk = true

    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      chunk(results) {
        // Strip BOM from first cell of first chunk
        if (isFirstChunk && results.data.length > 0) {
          const firstRow = results.data[0]
          if (firstRow && firstRow.length > 0 && typeof firstRow[0] === 'string') {
            firstRow[0] = stripBOM(firstRow[0])
          }
          isFirstChunk = false
        }
        rows.push(...(results.data as string[][]))
      },
      complete() {
        if (rows.length === 0) {
          resolve({ columns: [], rows: [], hasHeader: true })
          return
        }

        // Normalize row lengths to max width
        const maxWidth = Math.max(...rows.map(r => r.length))
        const normalizedRows = rows.map(row => {
          const normalized = [...row]
          while (normalized.length < maxWidth) {
            normalized.push('')
          }
          return normalized.slice(0, maxWidth)
        })

        const hasHeader = detectHasHeader(normalizedRows)

        // Extract headers and data rows
        const headerRow = hasHeader ? normalizedRows[0] : []
        const dataRows = hasHeader ? normalizedRows.slice(1) : normalizedRows

        // Build column definitions
        const columns: ColumnDef[] = []
        for (let i = 0; i < maxWidth; i++) {
          const rawHeader = hasHeader ? (headerRow[i] ?? '') : ''
          const { name, originalName } = normalizeHeader(rawHeader, i)

          // Get sample values for type inference
          const sampleValues = dataRows
            .slice(0, SAMPLE_ROWS_FOR_TYPE_INFERENCE)
            .map(row => row[i])

          const type = inferColumnType(sampleValues)

          columns.push({ name, type, originalName })
        }

        // Convert data rows to appropriate types
        const typedRows = dataRows.map(row =>
          row.map((cell, colIndex) => {
            if (cell === '' || cell === null || cell === undefined) {
              return null
            }

            const colType = columns[colIndex]?.type ?? 'TEXT'
            const trimmed = String(cell).trim()

            if (trimmed === '') return null

            if (colType === 'INTEGER') {
              const num = parseInt(trimmed, 10)
              return isNaN(num) ? trimmed : num
            }
            if (colType === 'REAL') {
              const num = parseFloat(trimmed)
              return isNaN(num) ? trimmed : num
            }
            return trimmed
          })
        )

        resolve({ columns, rows: typedRows, hasHeader })
      },
      error(error) {
        reject(new Error(`CSV parse error: ${error.message}`))
      },
    })
  })
}

/**
 * Serialize rows to CSV string
 */
export function serializeToCSV(
  columns: ColumnDef[],
  rows: unknown[][],
  includeHeader = true
): string {
  const header = includeHeader ? [columns.map(c => c.name)] : []
  const data = [...header, ...rows.map(row => row.map(cell => cell ?? ''))]

  return Papa.unparse(data)
}
