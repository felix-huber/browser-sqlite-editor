/**
 * Import/export and snapshot handlers.
 */

import type { StorageMode, WorkerRequest, WorkerResponse } from '../../types';
import { getIDBStorage } from '../idb-storage';
import { importDatabase } from '../file-import';
import { getRegistry } from '../db-registry';
import { exportDatabaseBlob } from '../storage';

export type PostResponse = (response: WorkerResponse, requestId?: number) => void;
export type PostBroadcast = (event: WorkerResponse) => void;

export async function handleFlushSnapshotRequest(
  _request: Extract<WorkerRequest, { type: 'flushSnapshot' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const storage = getIDBStorage();
    const result = await storage.flush();
    if (!result.success) {
      postResponse({
        type: 'error',
        message: result.error?.message ?? 'Failed to flush snapshot',
        code: result.error?.code ?? 'UNKNOWN',
      }, id);
      return;
    }
    postResponse({ type: 'success' }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to flush snapshot: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}

export async function handleExportRequest(
  request: Extract<WorkerRequest, { type: 'export' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const blob = await exportDatabaseBlob(request.dbName);
    postResponse({ type: 'success', data: blob }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes('not found') ? 'NOT_FOUND' : 'UNKNOWN';
    postResponse({
      type: 'error',
      message: `Export failed: ${message}`,
      code,
    }, id);
  }
}

async function handleImportRequestWithMode(
  request: Extract<WorkerRequest, { type: 'import' | 'importOpfs' }>,
  id: number,
  postResponse: PostResponse,
  postBroadcast: PostBroadcast,
  storageMode: StorageMode
): Promise<void> {
  try {
    const registry = getRegistry();
    if (!registry.isInitialized()) {
      await registry.init();
    }

    const importResult = await importDatabase(request.file, {
      nameHint: request.nameHint,
      storageMode,
      onProgress: (percent) => {
        postBroadcast({ type: 'progress', percent, message: 'Importing database...' });
      },
    });

    if (importResult.success) {
      postResponse({
        type: 'success',
        data: {
          dbId: importResult.dbId,
          dbName: importResult.dbName,
          storageType: importResult.storageType,
          fileSize: importResult.fileSize,
        },
      }, id);
    } else {
      postResponse({
        type: 'error',
        message: importResult.message,
        code: importResult.code,
      }, id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Import failed: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}

export async function handleImportRequest(
  request: Extract<WorkerRequest, { type: 'import' }>,
  id: number,
  postResponse: PostResponse,
  postBroadcast: PostBroadcast
): Promise<void> {
  // Always use IDB for imports to avoid OPFS multi-tab lock conflicts.
  // OPFS uses exclusive createSyncAccessHandle() locks that conflict across tabs.
  // IDB is multi-tab safe and has negligible performance difference for typical use.
  return handleImportRequestWithMode(request, id, postResponse, postBroadcast, 'idb');
}

export async function handleImportOpfsRequest(
  request: Extract<WorkerRequest, { type: 'importOpfs' }>,
  id: number,
  postResponse: PostResponse,
  postBroadcast: PostBroadcast
): Promise<void> {
  return handleImportRequestWithMode(request, id, postResponse, postBroadcast, 'opfs');
}

export async function handleFlushAndCloseRequest(
  request: Extract<WorkerRequest, { type: 'flushAndClose' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const storage = getIDBStorage();
    const result = await storage.flushAndClose(request.dbId);

    postResponse({
      type: 'flushAndCloseResult',
      success: result.success,
      error: result.error
        ? {
            code: result.error.code,
            message: result.error.message,
            attempts: result.error.attempts,
          }
        : undefined,
    }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'flushAndCloseResult',
      success: false,
      error: {
        code: 'IDB_FLUSH_FAILED',
        message: `Unexpected error during flushAndClose: ${message}`,
        attempts: 0,
      },
    }, id);
  }
}
