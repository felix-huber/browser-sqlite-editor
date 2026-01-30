/**
 * OPFS VFS Integration for wa-sqlite
 *
 * Provides Origin Private File System (OPFS) based persistence for SQLite databases.
 * Falls back to IndexedDB VFS when OPFS is unavailable.
 */

import * as SQLite from '@journeyapps/wa-sqlite';
// @ts-expect-error - wa-sqlite example VFS has no type declarations
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js';
import { IDBBatchAtomicVFS } from '@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js';

import type { StorageMode } from '../../types';

// =============================================================================
// Web Worker type augmentation for OPFS sync access handles
// =============================================================================

/**
 * FileSystemSyncAccessHandle interface for OPFS in Worker context
 * @see https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle
 */
interface FileSystemSyncAccessHandle {
  close(): void;
  flush(): void;
  getSize(): number;
  read(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
  truncate(newSize: number): void;
  write(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
}

/**
 * Extended FileSystemFileHandle with sync access handle support
 */
interface FileSystemFileHandleWithSync extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
}

// =============================================================================
// Constants
// =============================================================================

/** Application directory within OPFS root */
const APP_DIR = 'sqlite-editor';
/** VFS name for OPFS */
export const OPFS_VFS_NAME = 'opfs-coop-sync';

/** VFS name for IDB fallback */
export const IDB_VFS_NAME = 'idb-batch-atomic';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of VFS initialization
 */
export interface VFSInitResult {
  /** The initialized VFS instance */
  vfs: OPFSCoopSyncVFS | IDBBatchAtomicVFS;
  /** Which storage mode was activated */
  mode: StorageMode;
  /** Base path for database files (within OPFS or empty for IDB) */
  basePath: string;
}

/**
 * OPFS availability check result
 */
export interface OPFSAvailability {
  /** Whether OPFS is available */
  available: boolean;
  /** Reason for unavailability (if not available) */
  reason?: string;
}

// =============================================================================
// OPFS Availability Detection
// =============================================================================

/**
 * Check if OPFS is available in the current context
 *
 * OPFS requires:
 * - navigator.storage.getDirectory() API
 * - FileSystemSyncAccessHandle support (Worker context only)
 *
 * @returns Availability status with reason if unavailable
 */
export async function checkOPFSAvailability(): Promise<OPFSAvailability> {
  // Check for navigator.storage API
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return {
      available: false,
      reason: 'navigator.storage API not available',
    };
  }

  // OPFS sync access handles require cross-origin isolation
  if (typeof crossOriginIsolated !== 'boolean' || !crossOriginIsolated) {
    return {
      available: false,
      reason: 'crossOriginIsolated is not true',
    };
  }

  // Check for getDirectory method
  if (typeof navigator.storage.getDirectory !== 'function') {
    return {
      available: false,
      reason: 'navigator.storage.getDirectory not supported',
    };
  }

  // Try to actually access OPFS
  try {
    const root = await navigator.storage.getDirectory();

    // Verify we can create a directory (write access)
    const testDirName = `.opfs-test-${Date.now()}`;
    const testDir = await root.getDirectoryHandle(testDirName, { create: true });

    // Verify we can create a file with sync access handle
    const testFileName = 'test.tmp';
    const testFile = await testDir.getFileHandle(testFileName, { create: true });

    // This is the critical check - sync access handles are only available in Workers
    try {
      const fileWithSync = testFile as FileSystemFileHandleWithSync;
      const accessHandle = await fileWithSync.createSyncAccessHandle();
      accessHandle.close();
    } catch (syncErr) {
      // Clean up test directory
      await root.removeEntry(testDirName, { recursive: true });

      return {
        available: false,
        reason: `FileSystemSyncAccessHandle not available: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
      };
    }

    // Clean up test directory
    await root.removeEntry(testDirName, { recursive: true });

    return { available: true };
  } catch (err) {
    return {
      available: false,
      reason: `OPFS access failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// =============================================================================
// Directory Management
// =============================================================================

/**
 * Ensure the application directory structure exists in OPFS
 *
 * Creates: /sqlite-editor/
 *
 * @returns The app directory handle
 * @throws Error if directory creation fails
 */
export async function ensureAppDirectories(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();

  // Create app directory
  const appDir = await root.getDirectoryHandle(APP_DIR, { create: true });

  return appDir;
}

/**
 * Get the full OPFS path for a database file
 *
 * @param dbName Database filename (with extension)
 * @returns Full path within OPFS
 */
export function getOPFSPath(dbName: string): string {
  // Ensure consistent path format for OPFSCoopSyncVFS
  return `/${APP_DIR}/${dbName}`;
}

/**
 * List all database files in the OPFS app directory
 *
 * @returns Array of database filenames
 */
export async function listOPFSDatabases(): Promise<string[]> {
  try {
    const dbDir = await ensureAppDirectories();
    const databases: string[] = [];

    // @ts-expect-error - TypeScript doesn't know about async iterator on FileSystemDirectoryHandle
    for await (const entry of dbDir.values()) {
      if (entry.kind === 'file' && !entry.name.startsWith('.')) {
        if (entry.name === 'registry.json' || entry.name.endsWith('.erd.json')) {
          continue;
        }
        // Skip journal and WAL files
        if (
          !entry.name.endsWith('-journal') &&
          !entry.name.endsWith('-wal') &&
          !entry.name.endsWith('-shm')
        ) {
          databases.push(entry.name);
        }
      }
    }

    return databases;
  } catch {
    return [];
  }
}

/**
 * Delete a database and its related files from OPFS
 *
 * @param dbName Database name
 */
export async function deleteOPFSDatabase(dbName: string): Promise<void> {
  const dbDir = await ensureAppDirectories();

  // Delete main file and related journal/wal files
  const suffixes = ['', '-journal', '-wal', '-shm'];

  for (const suffix of suffixes) {
    try {
      await dbDir.removeEntry(dbName + suffix);
    } catch {
      // File might not exist, ignore
    }
  }
}

// =============================================================================
// VFS Initialization
// =============================================================================

/**
 * Initialize the VFS layer for wa-sqlite
 *
 * Attempts to use OPFS with OPFSCoopSyncVFS for best performance.
 * Falls back to IndexedDB with IDBBatchAtomicVFS if OPFS is unavailable.
 *
 * @param module The wa-sqlite WASM module
 * @param sqlite The SQLite API from wa-sqlite
 * @returns VFS init result with mode and base path
 */
export async function initializeVFS(
  module: unknown,
  sqlite: ReturnType<typeof SQLite.Factory>,
): Promise<VFSInitResult> {
  // Check OPFS availability
  const opfsCheck = await checkOPFSAvailability();

  if (opfsCheck.available) {
    try {
      // Ensure app directories exist before VFS initialization
      await ensureAppDirectories();

      // Create OPFS VFS
      const vfs = await OPFSCoopSyncVFS.create(OPFS_VFS_NAME, module);

      // Register as default VFS
      sqlite.vfs_register(vfs as unknown as Parameters<typeof sqlite.vfs_register>[0], true);

      // Register IDB VFS as non-default fallback (enables opening IDB-backed DBs)
      try {
        // @ts-expect-error - runtime constructor accepts module param (types are stale)
        const idbVfs = new IDBBatchAtomicVFS(IDB_VFS_NAME, module);
        const ready = (idbVfs as unknown as { isReady?: () => Promise<void> }).isReady;
        if (typeof ready === 'function') {
          await ready.call(idbVfs);
        }
        sqlite.vfs_register(
          idbVfs as unknown as Parameters<typeof sqlite.vfs_register>[0],
          false
        );
      } catch (err) {
        console.warn(
          'IDB VFS registration failed:',
          err instanceof Error ? err.message : String(err),
        );
      }

      return {
        vfs,
        mode: 'opfs',
        basePath: `/${APP_DIR}`,
      };
    } catch (err) {
      // OPFS VFS creation failed, fall back to IDB
      console.warn(
        'OPFS VFS initialization failed, falling back to IndexedDB:',
        err instanceof Error ? err.message : String(err),
      );
    }
  } else {
    console.info('OPFS not available:', opfsCheck.reason);
  }

  // Fall back to IndexedDB VFS
  return initializeIDBFallback(sqlite, module);
}

/**
 * Initialize IndexedDB VFS as fallback
 *
 * @param sqlite The SQLite API from wa-sqlite
 * @returns VFS init result
 */
async function initializeIDBFallback(
  sqlite: ReturnType<typeof SQLite.Factory>,
  module: unknown,
): Promise<VFSInitResult> {
  // @ts-expect-error - runtime constructor accepts module param (types are stale)
  const vfs = new IDBBatchAtomicVFS(IDB_VFS_NAME, module);
  const ready = (vfs as unknown as { isReady?: () => Promise<void> }).isReady;
  if (typeof ready === 'function') {
    await ready.call(vfs);
  }

  // Register as default VFS
  sqlite.vfs_register(vfs as unknown as Parameters<typeof sqlite.vfs_register>[0], true);

  return {
    vfs,
    mode: 'idb',
    basePath: '', // IDB doesn't use file paths
  };
}

// =============================================================================
// File Handle Management
// =============================================================================

/**
 * Check if a database file exists in OPFS
 *
 * @param dbName Database name
 * @returns True if the database file exists
 */
export async function databaseExistsInOPFS(dbName: string): Promise<boolean> {
  try {
    const dbDir = await ensureAppDirectories();
    await dbDir.getFileHandle(dbName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the size of a database file in OPFS
 *
 * @param dbName Database name
 * @returns File size in bytes, or null if file doesn't exist
 */
export async function getOPFSDatabaseSize(dbName: string): Promise<number | null> {
  try {
    const dbDir = await ensureAppDirectories();
    const fileHandle = await dbDir.getFileHandle(dbName);
    const file = await fileHandle.getFile();
    return file.size;
  } catch {
    return null;
  }
}

/**
 * Read a database file from OPFS as bytes
 *
 * Useful for exporting databases.
 *
 * @param dbName Database name
 * @returns File contents as Uint8Array, or null if file doesn't exist
 */
export async function readOPFSDatabase(dbName: string): Promise<Uint8Array | null> {
  try {
    const dbDir = await ensureAppDirectories();
    const fileHandle = await dbDir.getFileHandle(dbName);
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/**
 * Write database bytes to OPFS
 *
 * Useful for importing databases. The database must not be open.
 *
 * @param dbName Database name
 * @param data Database file contents
 */
export async function writeOPFSDatabase(dbName: string, data: Uint8Array): Promise<void> {
  const dbDir = await ensureAppDirectories();
  const fileHandle = await dbDir.getFileHandle(dbName, { create: true });

  // Use sync access handle for atomic write
  const fileWithSync = fileHandle as FileSystemFileHandleWithSync;
  const accessHandle = await fileWithSync.createSyncAccessHandle();

  try {
    accessHandle.truncate(0);
    accessHandle.write(data, { at: 0 });
    accessHandle.flush();
  } finally {
    accessHandle.close();
  }
}

// =============================================================================
// Storage Quota
// =============================================================================

/**
 * Get OPFS storage quota information
 *
 * @returns Quota info with usage and quota, or null if unavailable
 */
export async function getStorageQuota(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage ?? 0,
        quota: estimate.quota ?? 0,
      };
    }
  } catch {
    // Storage estimate not available
  }
  return null;
}

/**
 * Request persistent storage (prevents browser from evicting data)
 *
 * @returns True if persistent storage was granted
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // Persist request failed
  }
  return false;
}
