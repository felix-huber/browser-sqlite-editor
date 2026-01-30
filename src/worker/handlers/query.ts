/**
 * Query and execution handlers.
 */

import type { WorkerRequest, WorkerResponse, WorkerErrorCode } from '../../types';
import { getEngine } from '../../core/engine/db-engine';
import { registerQuery, requestCancellation } from '../query-cancel';

export type PostResponse = (response: WorkerResponse, requestId?: number) => void;

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
    const result = await engine.query(request.sql, request.params);
    postResponse({ type: 'queryResult', result }, id);
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
    const result = await engine.exec(request.sql, request.params);
    postResponse({ type: 'success', data: result }, id);
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
