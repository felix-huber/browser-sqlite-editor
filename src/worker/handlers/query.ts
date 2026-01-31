/**
 * Query and execution handlers.
 */

import type { WorkerRequest, WorkerResponse, WorkerErrorCode } from '../../types';
import { getEngine } from '../../core/engine/db-engine';
import { registerQuery, requestCancellation } from '../query-cancel';
import {
  createTransactionTracker,
  executeWithTransactionTracking,
  type TransactionTracker,
  type TransactionWarning,
} from '../../features/sql/transactionTracker';

export type PostResponse = (response: WorkerResponse, requestId?: number) => void;

/**
 * Session-level transaction tracker.
 * Persists across requests within the same worker session.
 * Reset when database is closed/opened.
 */
let sessionTracker: TransactionTracker = createTransactionTracker();

/**
 * Reset the session tracker (called on database close/open).
 */
export function resetSessionTracker(): void {
  sessionTracker = createTransactionTracker();
}

/**
 * Get the current session tracker (for testing).
 */
export function getSessionTracker(): TransactionTracker {
  return sessionTracker;
}

function normalizeQueryError(err: unknown): { message: string; code: WorkerErrorCode } {
  const normalized =
    typeof err === 'object' && err !== null && 'code' in err && 'message' in err
      ? (err as { code?: string; message?: string })
      : null;
  const message =
    normalized?.message ??
    (err instanceof Error ? err.message : String(err));
  const lowerMessage = message.toLowerCase();
  const normalizedCode =
    typeof normalized?.code === 'string'
      ? (normalized.code as WorkerErrorCode)
      : undefined;
  const code: WorkerErrorCode =
    normalizedCode ??
    (message.toUpperCase().includes('SQLITE_CONSTRAINT')
      ? 'CONSTRAINT_VIOLATION'
      : lowerMessage.includes('syntax error')
      ? 'SYNTAX_ERROR'
      : lowerMessage.includes('interrupt') || lowerMessage.includes('cancel')
      ? 'CANCELED'
      : 'UNKNOWN');
  return { message, code };
}

export async function handleQueryRequest(
  request: Extract<WorkerRequest, { type: 'query' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  const cleanup = registerQuery(String(id));
  try {
    const engine = getEngine();
    if (!engine.isReady()) {
      throw new Error('No database open. Please open a database first.');
    }

    // Build SQL with pagination if provided
    let sql = request.sql;
    if (request.limit !== undefined) {
      // Append LIMIT/OFFSET to the SQL for pagination
      sql = `${sql.replace(/;\s*$/, '')} LIMIT ${request.limit}`;
      if (request.offset !== undefined) {
        sql += ` OFFSET ${request.offset}`;
      }
    }

    // Use transaction tracking for query execution
    const trackingResult = await executeWithTransactionTracking(
      engine,
      sql,
      sessionTracker,
      { autoRollbackOrphan: true, params: request.params }
    );

    // Get the query result from the tracking result
    // For SELECT queries, the result is in the first statement's queryResult
    const firstResult = trackingResult.results[0];
    const result = firstResult?.queryResult ?? {
      columns: [],
      columnTypes: [],
      rows: [],
      rowsAffected: trackingResult.totalRowsAffected,
    };

    // Include warnings in the response if any
    const warnings = trackingResult.warnings.length > 0
      ? trackingResult.warnings
      : undefined;

    postResponse({ type: 'queryResult', result, transactionWarnings: warnings }, id);
  } catch (err) {
    const { message, code } = normalizeQueryError(err);
    postResponse({ type: 'error', message, code }, id);
  } finally {
    cleanup();
  }
}

export async function handleExecRequest(
  request: Extract<WorkerRequest, { type: 'exec' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  const cleanup = registerQuery(String(id));
  try {
    const engine = getEngine();
    if (!engine.isReady()) {
      throw new Error('No database open. Please open a database first.');
    }

    // Use transaction tracking for execution
    // skipAutoRollback allows programmatic transactions spanning multiple calls
    const autoRollbackOrphan = !request.skipAutoRollback;
    const trackingResult = await executeWithTransactionTracking(
      engine,
      request.sql,
      sessionTracker,
      { autoRollbackOrphan, params: request.params }
    );

    // Include warnings in the response data
    const responseData: {
      rowsAffected: number;
      lastInsertId?: number;
      transactionWarnings?: TransactionWarning[];
    } = {
      rowsAffected: trackingResult.totalRowsAffected,
    };

    // Get lastInsertId from the last result if available
    const lastResult = trackingResult.results[trackingResult.results.length - 1];
    if (lastResult?.lastInsertId !== undefined) {
      responseData.lastInsertId = lastResult.lastInsertId;
    }

    // Include warnings if any
    if (trackingResult.warnings.length > 0) {
      responseData.transactionWarnings = trackingResult.warnings;
    }

    postResponse({ type: 'success', data: responseData }, id);
  } catch (err) {
    const { message, code } = normalizeQueryError(err);
    postResponse({ type: 'error', message, code }, id);
  } finally {
    cleanup();
  }
}

export async function handleCancelRequest(
  _request: Extract<WorkerRequest, { type: 'cancel' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    await requestCancellation();
    postResponse({ type: 'success' }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to cancel: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}
