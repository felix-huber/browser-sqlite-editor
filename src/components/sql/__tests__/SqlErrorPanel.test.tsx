import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  SqlErrorPanel,
  parseLineNumber,
  classifyErrorType,
  generateSuggestion,
  parseError,
} from '../SqlErrorPanel'
import type { SqlError } from '../../../types'

describe('SqlErrorPanel', () => {
  afterEach(() => {
    cleanup()
  })

  describe('parseLineNumber', () => {
    it('extracts line number from "at line N" format', () => {
      const result = parseLineNumber('syntax error at line 5')
      expect(result.line).toBe(5)
    })

    it('extracts line number from "on line N" format', () => {
      const result = parseLineNumber('error on line 10')
      expect(result.line).toBe(10)
    })

    it('extracts line number from "line N" format', () => {
      const result = parseLineNumber('line 3: unexpected token')
      expect(result.line).toBe(3)
    })

    it('extracts column number from "column N" format', () => {
      const result = parseLineNumber('error at column 15')
      expect(result.column).toBe(15)
    })

    it('extracts both line and column from "(N:M)" format', () => {
      const result = parseLineNumber('syntax error (3:15)')
      expect(result.line).toBe(3)
      expect(result.column).toBe(15)
    })

    it('extracts both line and column from "N:M" format', () => {
      const result = parseLineNumber('error 5:10 near SELECT')
      expect(result.line).toBe(5)
      expect(result.column).toBe(10)
    })

    it('returns undefined for messages without line info', () => {
      const result = parseLineNumber('syntax error near SELECT')
      expect(result.line).toBeUndefined()
      expect(result.column).toBeUndefined()
    })
  })

  describe('classifyErrorType', () => {
    it('classifies syntax errors', () => {
      expect(classifyErrorType('syntax error near SELECT')).toBe('syntax')
      expect(classifyErrorType('near "FROM": syntax error')).toBe('syntax')
      expect(classifyErrorType('incomplete input')).toBe('syntax')
      expect(classifyErrorType('unrecognized token: "!!"')).toBe('syntax')
      expect(classifyErrorType('no such table: users')).toBe('syntax')
      expect(classifyErrorType('no such column: name')).toBe('syntax')
      expect(classifyErrorType('no such function: foo')).toBe('syntax')
    })

    it('classifies constraint violations', () => {
      expect(classifyErrorType('UNIQUE constraint failed')).toBe('constraint')
      expect(classifyErrorType('FOREIGN KEY constraint failed')).toBe('constraint')
      expect(classifyErrorType('NOT NULL constraint failed')).toBe('constraint')
      expect(classifyErrorType('CHECK constraint failed')).toBe('constraint')
      expect(classifyErrorType('PRIMARY KEY must be unique')).toBe('constraint')
    })

    it('classifies runtime errors', () => {
      expect(classifyErrorType('database is locked')).toBe('runtime')
      expect(classifyErrorType('disk I/O error')).toBe('runtime')
      expect(classifyErrorType('database disk image is malformed')).toBe('runtime')
      expect(classifyErrorType('out of memory')).toBe('runtime')
      expect(classifyErrorType('read-only database')).toBe('runtime')
    })

    it('returns unknown for unrecognized errors', () => {
      expect(classifyErrorType('something went wrong')).toBe('unknown')
    })
  })

  describe('generateSuggestion', () => {
    it('generates suggestion for missing table', () => {
      const suggestion = generateSuggestion('no such table: users')
      expect(suggestion).toContain('Table "users" does not exist')
    })

    it('generates suggestion for missing column', () => {
      const suggestion = generateSuggestion('no such column: name')
      expect(suggestion).toContain('Column "name" does not exist')
    })

    it('generates suggestion for missing function', () => {
      const suggestion = generateSuggestion('no such function: foo')
      expect(suggestion).toContain('Function "foo" is not available')
    })

    it('generates suggestion for near token syntax error', () => {
      const suggestion = generateSuggestion('near "FROM": syntax error')
      expect(suggestion).toContain('Syntax error near "FROM"')
    })

    it('generates suggestion for unique constraint', () => {
      const suggestion = generateSuggestion('UNIQUE constraint failed')
      expect(suggestion).toContain('already exists')
    })

    it('generates suggestion for foreign key constraint', () => {
      const suggestion = generateSuggestion('FOREIGN KEY constraint failed')
      expect(suggestion).toContain('parent record')
    })

    it('generates suggestion for NOT NULL constraint', () => {
      const suggestion = generateSuggestion('NOT NULL constraint failed')
      expect(suggestion).toContain('requires a value')
    })

    it('returns undefined for unrecognized errors', () => {
      const suggestion = generateSuggestion('something went wrong')
      expect(suggestion).toBeUndefined()
    })
  })

  describe('parseError', () => {
    it('parses a complete error with all fields', () => {
      const error: SqlError = {
        message: 'near "SELECT": syntax error at line 5, column 10',
      }
      const parsed = parseError(error)

      expect(parsed.line).toBe(5)
      expect(parsed.column).toBe(10)
      expect(parsed.type).toBe('syntax')
      expect(parsed.suggestion).toBeDefined()
    })

    it('preserves pre-existing line/column from error', () => {
      const error: SqlError = {
        message: 'syntax error',
        line: 3,
        column: 7,
      }
      const parsed = parseError(error)

      expect(parsed.line).toBe(3)
      expect(parsed.column).toBe(7)
    })
  })

  describe('SqlErrorPanel component', () => {
    it('renders nothing when errors array is empty', () => {
      render(<SqlErrorPanel errors={[]} />)
      expect(screen.queryByTestId('sql-error-panel')).not.toBeInTheDocument()
    })

    it('renders single error without header', () => {
      const errors: SqlError[] = [{ message: 'syntax error' }]
      render(<SqlErrorPanel errors={errors} />)

      expect(screen.getByTestId('sql-error-panel')).toBeInTheDocument()
      expect(screen.queryByTestId('error-panel-header')).not.toBeInTheDocument()
      expect(screen.getByTestId('error-item-0')).toBeInTheDocument()
    })

    it('renders multiple errors with header', () => {
      const errors: SqlError[] = [
        { message: 'syntax error 1' },
        { message: 'syntax error 2' },
      ]
      render(<SqlErrorPanel errors={errors} />)

      expect(screen.getByTestId('error-panel-header')).toHaveTextContent('2 errors found')
      expect(screen.getByTestId('error-item-0')).toBeInTheDocument()
      expect(screen.getByTestId('error-item-1')).toBeInTheDocument()
    })

    it('displays error type icon', () => {
      const errors: SqlError[] = [{ message: 'syntax error near SELECT' }]
      render(<SqlErrorPanel errors={errors} />)

      expect(screen.getByTestId('error-icon-0')).toBeInTheDocument()
      expect(screen.getByTestId('error-type-0')).toHaveTextContent('Syntax Error')
    })

    it('displays constraint error type', () => {
      const errors: SqlError[] = [{ message: 'UNIQUE constraint failed' }]
      render(<SqlErrorPanel errors={errors} />)

      expect(screen.getByTestId('error-type-0')).toHaveTextContent('Constraint Violation')
    })

    it('displays runtime error type', () => {
      const errors: SqlError[] = [{ message: 'database is locked' }]
      render(<SqlErrorPanel errors={errors} />)

      expect(screen.getByTestId('error-type-0')).toHaveTextContent('Runtime Error')
    })

    it('displays error message', () => {
      const errors: SqlError[] = [{ message: 'no such table: users' }]
      render(<SqlErrorPanel errors={errors} />)

      expect(screen.getByTestId('error-message-0')).toHaveTextContent('no such table: users')
    })

    it('displays line number when available', () => {
      const errors: SqlError[] = [{ message: 'syntax error', line: 5 }]
      render(<SqlErrorPanel errors={errors} />)

      expect(screen.getByTestId('error-location-0')).toHaveTextContent('Line 5')
    })

    it('displays line:column when both available', () => {
      const errors: SqlError[] = [{ message: 'syntax error', line: 5, column: 10 }]
      render(<SqlErrorPanel errors={errors} />)

      expect(screen.getByTestId('error-location-0')).toHaveTextContent('5:10')
    })

    it('displays suggestion when available', () => {
      const errors: SqlError[] = [{ message: 'no such table: users' }]
      render(<SqlErrorPanel errors={errors} />)

      expect(screen.getByTestId('error-suggestion-0')).toBeInTheDocument()
      expect(screen.getByTestId('error-suggestion-0')).toHaveTextContent('Table "users" does not exist')
    })

    it('does not display suggestion when not available', () => {
      const errors: SqlError[] = [{ message: 'something went wrong' }]
      render(<SqlErrorPanel errors={errors} />)

      expect(screen.queryByTestId('error-suggestion-0')).not.toBeInTheDocument()
    })

    it('calls onJumpToLocation when clicking line number', () => {
      const onJumpToLocation = vi.fn()
      const errors: SqlError[] = [{ message: 'syntax error', line: 5, column: 10 }]
      render(<SqlErrorPanel errors={errors} onJumpToLocation={onJumpToLocation} />)

      fireEvent.click(screen.getByTestId('error-location-0'))

      expect(onJumpToLocation).toHaveBeenCalledWith(5, 10)
    })

    it('displays statement index for multi-statement errors', () => {
      const errors: SqlError[] = [
        { message: 'syntax error', statementIndex: 2 },
      ]
      render(<SqlErrorPanel errors={errors} />)

      expect(screen.getByText('Statement 3')).toBeInTheDocument()
    })
  })
})
