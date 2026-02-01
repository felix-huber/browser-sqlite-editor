/**
 * Registry and database lifecycle handlers.
 */

import type { WorkerRequest, WorkerResponse, WorkerErrorCode, StorageMode } from '../../types';
import { getEngine, resetEngine } from '../../core/engine/db-engine';
import { OPFS_VFS_NAME, getOPFSDatabaseSize, ensureAppDirectories } from '../../core/engine/opfs-vfs';
import { getRegistry, toFilename, forceReinitializeRegistry, resetRegistry } from '../db-registry';
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
    const isNotFound = message.includes('NotFoundError') ||
      message.includes('not found') ||
      message.includes('SQLITE_CANTOPEN') ||
      (err instanceof Error && err.name === 'NotFoundError');

    // If file not found, try to clean up stale registry entry
    if (isNotFound) {
      try {
        const registry = getRegistry();
        const entry = registry.getDatabaseByName(request.dbName);
        if (entry) {
          console.warn(
            `[handleOpenRequest] Database file not found for "${request.dbName}", removing stale registry entry`
          );
          await registry.removeDatabase(entry.id);
        }
      } catch (cleanupErr) {
        console.error('[handleOpenRequest] Failed to clean up stale entry:', cleanupErr);
      }
    }

    postResponse({
      type: 'error',
      message: `Failed to open database: ${message}`,
      code: isNotFound ? 'NOT_FOUND' : 'UNKNOWN',
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

/**
 * Handle resetApp request - clear all storage and reset registry.
 * This is a destructive operation that wipes all databases.
 */
export async function handleResetAppRequest(
  _request: Extract<WorkerRequest, { type: 'resetApp' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    // Shutdown the engine completely to release file handles, VFS, and IDB connections
    // This is more thorough than just close() as it also closes the VFS
    const engine = getEngine();
    await engine.shutdown();
    resetSessionTracker();

    // Reset engine singleton to ensure a fresh instance on next use
    // This is critical because shutdown() clears internal state but the singleton
    // reference remains, and reinitializing an engine after VFS was closed can
    // cause errors like "SES Removing unpermitted intrinsics" due to stale state
    resetEngine();

    // Reset registry singleton BEFORE clearing storage
    // This ensures no new connections are opened during cleanup
    resetRegistry();

    // Small delay to allow any pending IDB transactions to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Clear OPFS
    try {
      const root = await navigator.storage.getDirectory();
      try {
        await root.removeEntry('wasm-sqlite-editor', { recursive: true });
      } catch {
        // Directory might not exist
      }
      // Also clear legacy directory
      try {
        await root.removeEntry('sqlite-editor', { recursive: true });
      } catch {
        // Directory might not exist
      }
    } catch (err) {
      console.warn('[resetApp] Failed to clear OPFS:', err);
    }

    // Recreate OPFS app directories immediately after clearing
    // This ensures the directory structure exists before page reload and any
    // subsequent operations. Without this, importing a database after reset
    // could fail with NotFoundError because the directories don't exist.
    try {
      await ensureAppDirectories();
    } catch (err) {
      console.warn('[resetApp] Failed to recreate OPFS directories:', err);
    }

    // Helper to delete an IndexedDB - non-blocking approach
    // If deletion is blocked, we log and continue. The next page load will
    // find an empty registry and won't discover these databases anyway.
    const deleteIdb = async (name: string): Promise<void> => {
      try {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          req.onblocked = () => {
            // Database is blocked by open connections
            // This is OK - the page will reload and the database will be
            // orphaned (no registry entry). The user can try again if needed.
            console.warn(`[resetApp] IDB delete blocked for "${name}", proceeding anyway`);
            resolve();
          };
        });
      } catch (err) {
        // Log but don't fail the overall reset
        console.warn(`[resetApp] Failed to delete IDB "${name}":`, err);
      }
    };

    // Clear all known IndexedDB databases
    const idbNames = [
      'sqlite-editor-registry',
      'idb-batch-atomic',
      'idb-sqlite',
    ];

    // Delete all IDBs in parallel for faster cleanup
    await Promise.all(idbNames.map((name) => deleteIdb(name)));

    postResponse({ type: 'success' }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to reset app: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}

/**
 * Handle forceReinitRegistry request - reload registry from storage.
 * Use this after storage has been modified externally.
 */
export async function handleForceReinitRegistryRequest(
  _request: Extract<WorkerRequest, { type: 'forceReinitRegistry' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    await forceReinitializeRegistry();
    postResponse({ type: 'success' }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to reinitialize registry: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}
