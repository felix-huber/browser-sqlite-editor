/**
 * Transaction State Tracker
 *
 * Tracks transaction state per session and handles edge cases:
 * - BEGIN without COMMIT: auto-rollback with warning
 * - COMMIT without BEGIN: SQLite error, stops execution
 * - Clear transaction state on errors
 */

import type { DatabaseEngine, ExecResult } from '../../core/engine/db-engine';
import type { QueryResult } from '../../types';
import { splitStatements, inferStatementType } from '../../core/sql/multi-exec';

export interface TransactionWarning {
  type: 'orphan_begin' | 'commit_without_begin' | 'rollback_on_error';
  message: string;
  sql?: string;
}

export interface TransactionExecutionResult {
  success: boolean;
  warnings: TransactionWarning[];
  results: StatementExecutionResult[];
  totalRowsAffected: number;
}

export interface StatementExecutionResult {
  sql: string;
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL' | 'OTHER';
  queryResult?: QueryResult;
  rowsAffected?: number;
  lastInsertId?: number;
}

export interface TransactionTracker {
  /** Check if currently in a transaction */
  isInTransaction(): boolean;
  /** Get current nesting depth (includes savepoints) */
  getDepth(): number;
  /** Handle a statement and update state */
  handleStatement(sql: string): void;
  /** Reset all transaction state */
  reset(): void;
  /** Check for orphan transaction at session end */
  checkForOrphanTransaction(): TransactionWarning[];
}

/**
 * Create a new transaction tracker instance.
 */
export function createTransactionTracker(): TransactionTracker {
  let depth = 0;

  const isBegin = (sql: string): boolean => {
    const normalized = sql.trim().toUpperCase();
    return normalized === 'BEGIN' || normalized.startsWith('BEGIN ') || normalized.startsWith('BEGIN\t');
  };

  const isCommit = (sql: string): boolean => {
    const normalized = sql.trim().toUpperCase();
    return normalized === 'COMMIT' || normalized.startsWith('COMMIT ') || normalized.startsWith('COMMIT\t');
  };

  const isRollback = (sql: string): boolean => {
    const normalized = sql.trim().toUpperCase();
    // ROLLBACK TO savepoint doesn't end the transaction
    if (normalized.startsWith('ROLLBACK TO')) {
      return false;
    }
    return normalized === 'ROLLBACK' || normalized.startsWith('ROLLBACK ') || normalized.startsWith('ROLLBACK\t');
  };

  const isSavepoint = (sql: string): boolean => {
    const normalized = sql.trim().toUpperCase();
    return normalized.startsWith('SAVEPOINT ') || normalized.startsWith('SAVEPOINT\t');
  };

  const isRelease = (sql: string): boolean => {
    const normalized = sql.trim().toUpperCase();
    return normalized.startsWith('RELEASE ') || normalized.startsWith('RELEASE\t');
  };

  return {
    isInTransaction(): boolean {
      return depth > 0;
    },

    getDepth(): number {
      return depth;
    },

    handleStatement(sql: string): void {
      const trimmed = sql.trim();
      if (!trimmed) return;

      if (isBegin(trimmed)) {
        depth = 1;
      } else if (isCommit(trimmed) || isRollback(trimmed)) {
        depth = 0;
      } else if (isSavepoint(trimmed)) {
        depth++;
      } else if (isRelease(trimmed)) {
        depth = Math.max(1, depth - 1);
      }
    },

    reset(): void {
      depth = 0;
    },

    checkForOrphanTransaction(): TransactionWarning[] {
      if (depth > 0) {
        return [{
          type: 'orphan_begin',
          message: 'Transaction was started but not committed. Changes will be lost (auto-rollback).',
        }];
      }
      return [];
    },
  };
}

/**
 * Execute SQL with transaction tracking.
 *
 * Handles:
 * - Orphan BEGIN: auto-rollback + warning (only when autoRollbackOrphan is true)
 * - COMMIT without BEGIN: SQLite error stops execution
 * - Clear transaction state on errors
 *
 * @param engine Database engine
 * @param sql SQL to execute
 * @param tracker Transaction tracker instance
 * @param options.autoRollbackOrphan If true, auto-rollback orphan BEGIN in same execution batch
 */
export async function executeWithTransactionTracking(
  engine: DatabaseEngine,
  sql: string,
  tracker: TransactionTracker,
  options: { autoRollbackOrphan?: boolean; params?: unknown[] } = {},
): Promise<TransactionExecutionResult> {
  const { autoRollbackOrphan = true, params } = options;
  const statements = splitStatements(sql);
  const results: StatementExecutionResult[] = [];
  const warnings: TransactionWarning[] = [];
  let totalRowsAffected = 0;

  // Track if we started a transaction in this execution
  const wasInTransaction = tracker.isInTransaction();

  // Check if this batch has explicit transaction control (BEGIN and COMMIT/ROLLBACK in same batch)
  const hasBegin = statements.some(s => {
    const n = s.trim().toUpperCase();
    return n === 'BEGIN' || n.startsWith('BEGIN ') || n.startsWith('BEGIN\t');
  });
  const hasCommitOrRollback = statements.some(s => {
    const n = s.trim().toUpperCase();
    return n === 'COMMIT' || n.startsWith('COMMIT ') || n.startsWith('COMMIT\t') ||
           (n.startsWith('ROLLBACK') && !n.startsWith('ROLLBACK TO'));
  });
  const isOrphanBatch = hasBegin && !hasCommitOrRollback;

  try {
    for (const stmt of statements) {
      const stmtType = inferStatementType(stmt);

      const result: StatementExecutionResult = {
        sql: stmt,
        type: stmtType,
      };

      try {
        if (stmtType === 'SELECT') {
          // Pass params for single-statement queries
          const queryResult = await engine.query(stmt, params);
          result.queryResult = queryResult;
          result.rowsAffected = queryResult.rowsAffected;
        } else {
          // Pass params for single-statement exec
          const execResult: ExecResult = await engine.exec(stmt, params);
          result.rowsAffected = execResult.rowsAffected;
          result.lastInsertId = execResult.lastInsertId;

          if (stmtType === 'INSERT' || stmtType === 'UPDATE' || stmtType === 'DELETE') {
            totalRowsAffected += execResult.rowsAffected;
          }
        }

        // Update tracker state after successful execution
        tracker.handleStatement(stmt);
      } catch (err) {
        // On error, if we're in a transaction and auto-rollback is enabled, issue rollback
        // When skipAutoRollback (autoRollbackOrphan=false), the caller handles rollback
        if (autoRollbackOrphan && tracker.isInTransaction()) {
          try {
            await engine.exec('ROLLBACK');
          } catch {
            // Ignore rollback errors
          }
          tracker.reset();
        }

        throw err;
      }

      results.push(result);
    }

    // After execution, check for orphan transaction within same batch
    // Only auto-rollback if:
    // 1. autoRollbackOrphan is true
    // 2. This batch started a transaction (wasn't already in one)
    // 3. Transaction is still active after batch
    // 4. This batch had BEGIN but no COMMIT/ROLLBACK (orphan within batch)
    if (autoRollbackOrphan && !wasInTransaction && tracker.isInTransaction() && isOrphanBatch) {
      warnings.push({
        type: 'orphan_begin',
        message: 'Transaction was started but not committed. Performing auto-rollback to prevent data loss.',
      });

      try {
        await engine.exec('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
      tracker.reset();
    }

    return {
      success: true,
      warnings,
      results,
      totalRowsAffected,
    };
  } catch (err) {
    // Clear transaction state on error
    tracker.reset();
    throw err;
  }
}
