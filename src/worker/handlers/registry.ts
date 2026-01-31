/**
 * Registry and database lifecycle handlers.
 */

import type { WorkerRequest, WorkerResponse, WorkerErrorCode, StorageMode } from '../../types';
import { getEngine } from '../../core/engine/db-engine';
import { OPFS_VFS_NAME, getOPFSDatabaseSize } from '../../core/engine/opfs-vfs';
import { getRegistry, toFilename } from '../db-registry';
import { resolveDbPath } from '../storage';
import { getIdbDbSize } from '../idb-storage';
import { openDatabase } from '../sqlite-engine';
import { resetSessionTracker } from './query';

export type PostResponse = (response: WorkerResponse, requestId?: number) => void;

export async function handleOpenRequest(
  request: Extract<WorkerRequest, { type: 'open' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    // Reset transaction tracker when opening a new database
    resetSessionTracker();

    const { path, vfsName } = await resolveDbPath(request.dbName);
    const readOnly = request.readOnly ?? false;
    const createIfMissing = vfsName === OPFS_VFS_NAME && !readOnly;
    await openDatabase(path, vfsName, { readOnly, createIfMissing });
    postResponse({ type: 'lockStatus', isWriter: !readOnly }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to open database: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}

export async function handleCloseRequest(
  _request: Extract<WorkerRequest, { type: 'close' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    // Reset transaction tracker when closing the database
    resetSessionTracker();

    const engine = getEngine();
    await engine.close();
    postResponse({ type: 'success' }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to close database: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}

export async function handleCreateDbRequest(
  request: Extract<WorkerRequest, { type: 'createDb' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const { path, vfsName } = await resolveDbPath(request.name, { allowCreate: true });
    await openDatabase(path, vfsName, { createIfMissing: true });
    const registry = getRegistry();
    if (!registry.isInitialized()) {
      await registry.init();
    }
    await registry.registerDatabase(request.name);
    postResponse({ type: 'success' }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to create database: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}

export async function handleDeleteDbRequest(
  request: Extract<WorkerRequest, { type: 'deleteDb' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const registry = getRegistry();
    if (!registry.isInitialized()) {
      await registry.init();
    }
    const result = await registry.deleteDatabase(request.name);
    if (!result.success) {
      const code = result.error?.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNKNOWN';
      postResponse({
        type: 'error',
        message: result.error?.message ?? 'Failed to delete database',
        code,
      }, id);
      return;
    }
    // If file deletion failed, attempt self-healing cleanup
    if (result.warnings && result.warnings.length > 0) {
      await registry.healFileOperationFailures();
    }
    postResponse({
      type: 'success',
      data: result.warnings ? { warnings: result.warnings } : undefined,
    }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to delete database: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}

export async function handleRenameDbRequest(
  request: Extract<WorkerRequest, { type: 'renameDb' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const registry = getRegistry();
    if (!registry.isInitialized()) {
      await registry.init();
    }
    const entry = registry.getDatabaseByName(request.oldName);
    if (!entry) {
      postResponse({
        type: 'error',
        message: `Database "${request.oldName}" not found`,
        code: 'NOT_FOUND',
      }, id);
      return;
    }

    const result = await registry.renameDatabase(entry.id, request.newName);
    if (!result.success) {
      const errorCode = result.error?.code;
      const code: WorkerErrorCode =
        errorCode === 'NOT_FOUND'
          ? 'NOT_FOUND'
          : errorCode === 'NAME_EXISTS' ||
            errorCode === 'NAME_EMPTY' ||
            errorCode === 'NAME_TOO_LONG' ||
            errorCode === 'PATH_SEPARATOR' ||
            errorCode === 'HIDDEN_FILE' ||
            errorCode === 'RESERVED_NAME' ||
            errorCode === 'PATH_TRAVERSAL'
          ? 'INVALID_NAME'
          : 'UNKNOWN';
      postResponse({
        type: 'error',
        message: result.error?.message ?? 'Failed to rename database',
        code,
      }, id);
      return;
    }

    postResponse({ type: 'success' }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to rename database: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}

export async function handleGetRegistryRequest(
  _request: Extract<WorkerRequest, { type: 'getRegistry' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const registry = getRegistry();
    if (!registry.isInitialized()) {
      await registry.init();
    }
    const entries = registry.listDatabases();
    const databases = entries.map((e) => ({
      name: e.name,
      file: e.storageType === 'opfs' ? toFilename(e.name) : e.name,
      createdAt: e.createdAt,
      lastOpenedAt: e.lastOpenedAt,
      fkEnforced: true,
    }));
    postResponse({
      type: 'registryResult',
      registry: { v: 1, databases },
    }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to get registry: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}

export async function handleGetDbSizeRequest(
  request: Extract<WorkerRequest, { type: 'getDbSize' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const registry = getRegistry();
    if (!registry.isInitialized()) {
      await registry.init();
    }
    const entry = registry.getDatabaseByName(request.dbName);
    if (!entry) {
      postResponse({
        type: 'error',
        message: `Database "${request.dbName}" not found`,
        code: 'NOT_FOUND',
      }, id);
      return;
    }

    const storageMode: StorageMode = entry.storageType ?? registry.getStorageMode();
    let sizeBytes = 0;

    if (storageMode === 'opfs') {
      sizeBytes = await getOPFSDatabaseSize(toFilename(entry.name)) ?? 0;
    } else {
      sizeBytes = await getIdbDbSize(entry.name);
    }

    postResponse({
      type: 'dbSizeResult',
      sizeBytes,
      storageMode,
    }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to get database size: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}
