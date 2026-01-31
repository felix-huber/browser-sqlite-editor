import Papa from 'papaparse'

export type ColumnType = 'INTEGER' | 'REAL' | 'TEXT'

// Sentinel value to mark quoted empty strings - chosen to be unlikely in real data
const QUOTED_EMPTY_SENTINEL = '\x00__QUOTED_EMPTY__\x00'

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
 * Pre-process CSV to mark quoted empty strings with a sentinel value.
 * This allows us to distinguish "" (quoted empty → empty string) from
 * bare empty (unquoted empty → NULL) after Papa Parse normalizes them.
 */
function markQuotedEmptyStrings(csv: string): string {
  // Replace "" (quoted empty) with a sentinel value
  // Pattern: match "" that is either at start, after delimiter, or after newline
  // and followed by delimiter, newline, or end
  return csv.replace(
    /(?<=^|,|;|\t|\r?\n)""(?=,|;|\t|\r?\n|$)/g,
    `"${QUOTED_EMPTY_SENTINEL}"`
  )
}

/**
 * Normalize header name:
 * - Trim whitespace
 * - Keep spaces (use identifier quoting in SQL)
 * - Handle empty headers by generating column_N
 */
function normalizeHeader(header: string, index: number): { name: string; originalName: string } {
  const originalName = header
  let name = header.trim()

  if (!name) {
    name = `column_${index + 1}`
  }

  return { name, originalName }
}

/**
 * Deduplicate headers case-insensitively.
 * 'name', 'Name' becomes 'name', 'Name_1'
 * Handles collision when suffixed name already exists (e.g., 'name', 'name_1', 'Name')
 */
function deduplicateHeaders(headers: { name: string; originalName: string }[]): { name: string; originalName: string }[] {
  // First pass: collect all header names (lowercased) for collision detection
  const allNames = new Set<string>(headers.map(h => h.name.toLowerCase()))
  const usedNames = new Set<string>()
  const result: { name: string; originalName: string }[] = []

  for (const header of headers) {
    const lowerName = header.name.toLowerCase()

    if (!usedNames.has(lowerName)) {
      // First occurrence of this name, keep as-is
      result.push(header)
      usedNames.add(lowerName)
    } else {
      // Duplicate: find a suffix that doesn't collide
      let suffix = 1
      let candidateName = `${header.name}_${suffix}`
      while (allNames.has(candidateName.toLowerCase()) || usedNames.has(candidateName.toLowerCase())) {
        suffix++
        candidateName = `${header.name}_${suffix}`
      }
      result.push({
        name: candidateName,
        originalName: header.originalName,
      })
      usedNames.add(candidateName.toLowerCase())
    }
  }

  return result
}

/**
 * Validate that bytes are valid UTF-8
 */
function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    decoder.decode(bytes)
    return true
  } catch {
    return false
  }
}

/**
 * Check if a numeric string has leading zeros that would be lost if parsed as a number.
 * e.g., '007' has leading zeros, '7' does not, '0' does not, '0.5' does not
 */
function hasLeadingZeros(str: string): boolean {
  // Must start with '0' and have more characters after
  if (!str.startsWith('0') || str.length <= 1) return false
  // '0.xxx' is a decimal, not leading zeros
  if (str[1] === '.') return false
  // '0' followed by another digit means leading zero
  return true
}

/**
 * Infer column type from sample values
 * - Values with leading zeros (e.g., '007') → TEXT (preserve formatting)
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

    // Check for leading zeros - must be treated as TEXT to preserve formatting
    if (hasLeadingZeros(str)) {
      return 'TEXT'
    }

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

  // Pre-process to mark quoted empty strings
  const markedString = markQuotedEmptyStrings(cleanString)

  // Parse with auto-detected delimiter
  const result = Papa.parse<string[]>(markedString, {
    header: false,
    skipEmptyLines: false, // Don't skip - we need to preserve rows with empty fields
    dynamicTyping: false, // Keep as strings for now, we'll do our own type inference
  })

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(`CSV parse error: ${result.errors[0]?.message || 'Unknown error'}`)
  }

  const rawRows = result.data as string[][]

  // Filter out completely empty rows (rows where all cells are empty strings)
  const rows = rawRows.filter(row => row.some(cell => cell !== ''))

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

  // Build raw headers
  const rawHeaders: { name: string; originalName: string }[] = []
  for (let i = 0; i < maxWidth; i++) {
    let rawHeader = hasHeader ? (headerRow[i] ?? '') : ''
    // Strip sentinel from headers - quoted empty header should become column_N
    if (rawHeader === QUOTED_EMPTY_SENTINEL) {
      rawHeader = ''
    }
    rawHeaders.push(normalizeHeader(rawHeader, i))
  }

  // Deduplicate headers case-insensitively
  const dedupedHeaders = deduplicateHeaders(rawHeaders)

  // Build column definitions with type inference
  const columns: ColumnDef[] = []
  for (let i = 0; i < maxWidth; i++) {
    const { name, originalName } = dedupedHeaders[i]

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
      // Handle quoted empty string sentinel → empty string
      if (cell === QUOTED_EMPTY_SENTINEL) {
        return ''
      }

      // Unquoted empty → NULL
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
 * Read file as ArrayBuffer using FileReader (for test environment compatibility)
 */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  // Try native arrayBuffer() first (faster in modern browsers)
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer()
  }
  // Fallback for test environments
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Parse CSV from File using streaming.
 * Validates UTF-8 encoding before parsing.
 */
export async function parseCSVFile(file: File): Promise<ParseResult> {
  // Validate UTF-8 encoding first
  const buffer = await readFileAsArrayBuffer(file)
  const bytes = new Uint8Array(buffer)
  if (!isValidUtf8(bytes)) {
    throw new Error('CSV file contains non-UTF-8 characters. Please convert to UTF-8 encoding before importing.')
  }

  // Decode and preprocess for quoted empty strings
  const decoder = new TextDecoder('utf-8')
  const csvString = stripBOM(decoder.decode(bytes))

  if (!csvString.trim()) {
    return { columns: [], rows: [], hasHeader: true }
  }

  // Pre-process to mark quoted empty strings
  const markedString = markQuotedEmptyStrings(csvString)

  return new Promise((resolve, reject) => {
    const rows: string[][] = []

    Papa.parse<string[]>(markedString, {
      header: false,
      skipEmptyLines: false,
      dynamicTyping: false,
      chunk(results: Papa.ParseResult<string[]>) {
        rows.push(...(results.data as string[][]))
      },
      complete() {
        // Filter out completely empty rows
        const filteredRows = rows.filter(row => row.some(cell => cell !== ''))

        if (filteredRows.length === 0) {
          resolve({ columns: [], rows: [], hasHeader: true })
          return
        }

        // Normalize row lengths to max width
        const maxWidth = Math.max(...filteredRows.map(r => r.length))
        const normalizedRows = filteredRows.map(row => {
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

        // Build raw headers
        const rawHeaders: { name: string; originalName: string }[] = []
        for (let i = 0; i < maxWidth; i++) {
          let rawHeader = hasHeader ? (headerRow[i] ?? '') : ''
          // Strip sentinel from headers - quoted empty header should become column_N
          if (rawHeader === QUOTED_EMPTY_SENTINEL) {
            rawHeader = ''
          }
          rawHeaders.push(normalizeHeader(rawHeader, i))
        }

        // Deduplicate headers case-insensitively
        const dedupedHeaders = deduplicateHeaders(rawHeaders)

        // Build column definitions with type inference
        const columns: ColumnDef[] = []
        for (let i = 0; i < maxWidth; i++) {
          const { name, originalName } = dedupedHeaders[i]

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
            // Handle quoted empty string sentinel → empty string
            if (cell === QUOTED_EMPTY_SENTINEL) {
              return ''
            }

            // Unquoted empty → NULL
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
      error(error: Error) {
        reject(new Error(`CSV parse error: ${error.message}`))
      },
    })
  })
}

/**
 * Parse CSV from raw bytes with UTF-8 validation.
 * Throws if the input is not valid UTF-8.
 */
export function parseCSVBytes(bytes: Uint8Array): ParseResult {
  if (!isValidUtf8(bytes)) {
    throw new Error('CSV file contains non-UTF-8 characters. Please convert to UTF-8 encoding before importing.')
  }

  const decoder = new TextDecoder('utf-8')
  const csvString = decoder.decode(bytes)
  return parseCSVString(csvString)
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
