/**
 * Multi-statement SQL Execution
 *
 * Handles execution of SQL scripts containing multiple statements.
 * Wraps all statements in an implicit transaction with rollback on error.
 */

import type { QueryResult } from '../../types';
import type { DatabaseEngine, ExecResult } from '../engine/db-engine';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a single statement execution
 */
export interface StatementResult {
  /** The SQL statement that was executed */
  sql: string;
  /** Statement index (0-based) */
  index: number;
  /** Statement type inferred from SQL */
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL' | 'OTHER';
  /** Query result for SELECT statements */
  queryResult?: QueryResult;
  /** Rows affected for DML statements */
  rowsAffected?: number;
  /** Last insert ID for INSERT statements */
  lastInsertId?: number;
}

/**
 * Result of multi-statement execution
 */
export interface MultiExecResult {
  /** Results for each statement */
  statements: StatementResult[];
  /** Total rows affected across all DML statements */
  totalRowsAffected: number;
  /** Whether execution was successful (no errors) */
  success: boolean;
}

/**
 * Error during multi-statement execution
 */
export interface MultiExecError extends Error {
  /** Statement index where error occurred (0-based) */
  statementIndex: number;
  /** The SQL statement that failed */
  sql: string;
  /** Original error message */
  originalMessage: string;
}

// =============================================================================
// SQL Statement Parsing
// =============================================================================

/**
 * State machine states for SQL parsing
 */
type ParserState =
  | 'normal'
  | 'single_quote'
  | 'double_quote'
  | 'backtick'
  | 'line_comment'
  | 'block_comment';

/**
 * Check if the current position matches a word boundary keyword.
 * The keyword must be preceded and followed by non-word characters.
 */
function matchKeyword(sql: string, pos: number, keyword: string): boolean {
  // Check if we have enough characters
  if (pos + keyword.length > sql.length) {
    return false;
  }

  // Check the keyword itself (case-insensitive)
  const slice = sql.slice(pos, pos + keyword.length);
  if (slice.toUpperCase() !== keyword.toUpperCase()) {
    return false;
  }

  // Check for word boundary before (must be non-word char or start of string)
  if (pos > 0) {
    const charBefore = sql[pos - 1];
    if (/\w/.test(charBefore)) {
      return false;
    }
  }

  // Check for word boundary after (must be non-word char or end of string)
  const posAfter = pos + keyword.length;
  if (posAfter < sql.length) {
    const charAfter = sql[posAfter];
    if (/\w/.test(charAfter)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if BEGIN at the current position is a block delimiter (not a transaction command).
 * BEGIN is a block delimiter when it appears after certain keywords like CREATE TRIGGER.
 * It is a transaction command when it's at the start of a statement.
 */
function isBeginBlockDelimiter(currentStatement: string): boolean {
  // Normalize the current statement so far
  const normalized = currentStatement.trim().toUpperCase();

  // BEGIN is a block delimiter in CREATE TRIGGER statements
  // Pattern: CREATE [TEMP|TEMPORARY] TRIGGER ... ON table_name BEGIN
  if (normalized.startsWith('CREATE')) {
    // Check if this is a trigger creation
    return /CREATE\s+(TEMP(ORARY)?\s+)?TRIGGER\b/i.test(normalized);
  }

  return false;
}

/**
 * Split SQL text into individual statements.
 *
 * Handles:
 * - String literals (single quotes, double quotes, backticks)
 * - Line comments (--)
 * - Block comments (/* *\/)
 * - Empty statements (consecutive semicolons)
 * - BEGIN...END blocks in triggers - semicolons inside are not statement separators
 *
 * @param sql Multi-statement SQL text
 * @returns Array of individual SQL statements (trimmed, non-empty)
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let state: ParserState = 'normal';
  let i = 0;
  // Track BEGIN...END nesting depth for triggers and compound statements
  let beginEndDepth = 0;

  while (i < sql.length) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    switch (state) {
      case 'normal':
        // Check for BEGIN keyword
        if (matchKeyword(sql, i, 'BEGIN')) {
          // Only treat as block delimiter if inside a CREATE TRIGGER statement
          if (isBeginBlockDelimiter(current)) {
            beginEndDepth++;
          }
          current += sql.slice(i, i + 5); // Add 'BEGIN'
          i += 4; // Will be incremented by 1 at end of loop
        }
        // Check for END keyword (ends a block)
        else if (matchKeyword(sql, i, 'END')) {
          current += sql.slice(i, i + 3); // Add 'END'
          if (beginEndDepth > 0) {
            beginEndDepth--;
          }
          i += 2; // Will be incremented by 1 at end of loop
        }
        else if (char === ';') {
          // Only treat as statement separator if not inside BEGIN...END
          if (beginEndDepth === 0) {
            // End of statement
            const trimmed = current.trim();
            if (trimmed) {
              statements.push(trimmed);
            }
            current = '';
          } else {
            // Inside BEGIN...END block, keep the semicolon
            current += char;
          }
        } else if (char === "'" ) {
          current += char;
          state = 'single_quote';
        } else if (char === '"') {
          current += char;
          state = 'double_quote';
        } else if (char === '`') {
          current += char;
          state = 'backtick';
        } else if (char === '-' && nextChar === '-') {
          state = 'line_comment';
          i++; // Skip the second dash
        } else if (char === '/' && nextChar === '*') {
          state = 'block_comment';
          i++; // Skip the asterisk
        } else {
          current += char;
        }
        break;

      case 'single_quote':
        current += char;
        if (char === "'") {
          // Check for escaped quote ('')
          if (nextChar === "'") {
            current += nextChar;
            i++; // Skip the escaped quote
          } else {
            state = 'normal';
          }
        }
        break;

      case 'double_quote':
        current += char;
        if (char === '"') {
          // Check for escaped quote ("")
          if (nextChar === '"') {
            current += nextChar;
            i++; // Skip the escaped quote
          } else {
            state = 'normal';
          }
        }
        break;

      case 'backtick':
        current += char;
        if (char === '`') {
          // Check for escaped backtick (``)
          if (nextChar === '`') {
            current += nextChar;
            i++; // Skip the escaped backtick
          } else {
            state = 'normal';
          }
        }
        break;

      case 'line_comment':
        // Consume until end of line
        if (char === '\n' || char === '\r') {
          state = 'normal';
          // Add a space to separate potential tokens
          current += ' ';
        }
        break;

      case 'block_comment':
        // Consume until */
        if (char === '*' && nextChar === '/') {
          state = 'normal';
          i++; // Skip the slash
          // Add a space to separate potential tokens
          current += ' ';
        }
        break;
    }

    i++;
  }

  // Don't forget the last statement (may not end with semicolon)
  const trimmed = current.trim();
  if (trimmed) {
    statements.push(trimmed);
  }

  return statements;
}

/**
 * Infer statement type from SQL text.
 *
 * @param sql SQL statement
 * @returns Inferred statement type
 */
export function inferStatementType(
  sql: string,
): 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL' | 'OTHER' {
  // Normalize: remove leading whitespace and comments, uppercase first word
  const normalized = sql
    .replace(/^\s+/, '')
    .replace(/^--.*$/m, '')
    .replace(/^\/\*[\s\S]*?\*\//, '')
    .trim()
    .toUpperCase();

  if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) {
    return 'SELECT';
  }
  if (normalized.startsWith('INSERT')) {
    return 'INSERT';
  }
  if (normalized.startsWith('UPDATE')) {
    return 'UPDATE';
  }
  if (normalized.startsWith('DELETE')) {
    return 'DELETE';
  }
  if (
    normalized.startsWith('CREATE') ||
    normalized.startsWith('DROP') ||
    normalized.startsWith('ALTER') ||
    normalized.startsWith('VACUUM') ||
    normalized.startsWith('REINDEX') ||
    normalized.startsWith('ANALYZE')
  ) {
    return 'DDL';
  }
  return 'OTHER';
}

/**
 * Check if SQL is a transaction control statement.
 *
 * @param sql SQL statement
 * @returns Whether this is BEGIN, COMMIT, ROLLBACK, etc.
 */
export function isTransactionControl(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  return (
    normalized.startsWith('BEGIN') ||
    normalized.startsWith('COMMIT') ||
    normalized.startsWith('ROLLBACK') ||
    normalized.startsWith('SAVEPOINT') ||
    normalized.startsWith('RELEASE')
  );
}

// =============================================================================
// Multi-Statement Execution
// =============================================================================

/**
 * Create a MultiExecError with proper stack trace.
 */
function createMultiExecError(
  message: string,
  statementIndex: number,
  sql: string,
  originalMessage: string,
): MultiExecError {
  const error = new Error(message) as MultiExecError;
  error.name = 'MultiExecError';
  error.statementIndex = statementIndex;
  error.sql = sql;
  error.originalMessage = originalMessage;
  return error;
}

/**
 * Execute multiple SQL statements within a transaction.
 *
 * All statements are wrapped in an implicit transaction (BEGIN...COMMIT).
 * If any statement fails, the entire batch is rolled back.
 *
 * Transaction control statements (BEGIN, COMMIT, ROLLBACK) in the input
 * are executed as-is without wrapping - use this for explicit transaction control.
 *
 * @param engine Database engine instance
 * @param sql Multi-statement SQL text
 * @returns Result containing per-statement results and totals
 * @throws MultiExecError if any statement fails (with rollback)
 */
export async function executeMultiStatement(
  engine: DatabaseEngine,
  sql: string,
): Promise<MultiExecResult> {
  const statements = splitStatements(sql);

  if (statements.length === 0) {
    return {
      statements: [],
      totalRowsAffected: 0,
      success: true,
    };
  }

  // Check if user is managing their own transaction
  const hasExplicitTransaction = statements.some(isTransactionControl);

  const results: StatementResult[] = [];
  let totalRowsAffected = 0;
  let inImplicitTransaction = false;

  try {
    // Start implicit transaction if user isn't managing their own
    if (!hasExplicitTransaction) {
      await engine.exec('BEGIN');
      inImplicitTransaction = true;
    }

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const stmtType = inferStatementType(stmt);

      const result: StatementResult = {
        sql: stmt,
        index: i,
        type: stmtType,
      };

      try {
        if (stmtType === 'SELECT') {
          // Execute as query and capture results
          const queryResult = await engine.query(stmt);
          result.queryResult = queryResult;
          result.rowsAffected = queryResult.rowsAffected;
        } else {
          // Execute as exec and capture affected rows
          const execResult: ExecResult = await engine.exec(stmt);
          result.rowsAffected = execResult.rowsAffected;
          result.lastInsertId = execResult.lastInsertId;

          if (stmtType !== 'DDL' && stmtType !== 'OTHER') {
            totalRowsAffected += execResult.rowsAffected;
          }
        }
      } catch (err) {
        // Re-throw with statement context
        const message = err instanceof Error ? err.message : String(err);
        throw createMultiExecError(
          `Statement ${i + 1} failed: ${message}`,
          i,
          stmt,
          message,
        );
      }

      results.push(result);
    }

    // Commit implicit transaction
    if (inImplicitTransaction) {
      await engine.exec('COMMIT');
      inImplicitTransaction = false;
    }

    return {
      statements: results,
      totalRowsAffected,
      success: true,
    };
  } catch (err) {
    // Rollback implicit transaction on error
    if (inImplicitTransaction) {
      try {
        await engine.exec('ROLLBACK');
      } catch {
        // Ignore rollback errors - original error is more important
      }
    }

    throw err;
  }
}

/**
 * Execute multiple SQL statements and return only SELECT results.
 *
 * Convenience wrapper that filters to just SELECT query results.
 *
 * @param engine Database engine instance
 * @param sql Multi-statement SQL text
 * @returns Array of query results (one per SELECT statement)
 */
export async function executeAndCollectResults(
  engine: DatabaseEngine,
  sql: string,
): Promise<QueryResult[]> {
  const result = await executeMultiStatement(engine, sql);

  return result.statements
    .filter((s) => s.type === 'SELECT' && s.queryResult)
    .map((s) => s.queryResult!);
}

/**
 * Generate execution summary string.
 *
 * @param result Multi-exec result
 * @returns Human-readable summary
 */
export function generateSummary(result: MultiExecResult): string {
  const parts: string[] = [];

  const selectCount = result.statements.filter((s) => s.type === 'SELECT').length;
  const insertCount = result.statements.filter((s) => s.type === 'INSERT').length;
  const updateCount = result.statements.filter((s) => s.type === 'UPDATE').length;
  const deleteCount = result.statements.filter((s) => s.type === 'DELETE').length;
  const ddlCount = result.statements.filter((s) => s.type === 'DDL').length;

  if (selectCount > 0) {
    parts.push(`${selectCount} SELECT`);
  }
  if (insertCount > 0) {
    parts.push(`${insertCount} INSERT`);
  }
  if (updateCount > 0) {
    parts.push(`${updateCount} UPDATE`);
  }
  if (deleteCount > 0) {
    parts.push(`${deleteCount} DELETE`);
  }
  if (ddlCount > 0) {
    parts.push(`${ddlCount} DDL`);
  }

  const stmtSummary = parts.length > 0 ? parts.join(', ') : 'No statements';

  if (result.totalRowsAffected > 0) {
    return `${stmtSummary}; ${result.totalRowsAffected} row(s) affected`;
  }

  return stmtSummary;
}
