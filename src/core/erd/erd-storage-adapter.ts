/**
 * ERD Layout Storage Adapter
 *
 * Provides OPFS sidecar storage for ERD layouts.
 * Path: /wasm-sqlite-editor/databases/<db>.erd.json
 */

import { checkOPFSAvailability } from '../engine/opfs-vfs';

/** OPFS root directory */
const OPFS_DIR = 'wasm-sqlite-editor';

/** Databases subdirectory */
const DATABASES_SUBDIR = 'databases';

/**
 * Convert database name to ERD sidecar filename
 * Matches db-registry's toFilename normalization
 */
export function toErdFilename(dbName: string): string {
  const sanitized = dbName
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .toLowerCase();
  return `${sanitized}.erd.json`;
}

/**
 * Storage adapter interface for ERD layouts
 */
export interface ErdStorageAdapter {
  isOpfsAvailable: () => Promise<boolean>;
  readSidecar: (dbName: string) => Promise<string | null>;
  writeSidecar: (dbName: string, content: string) => Promise<void>;
  deleteSidecar: (dbName: string) => Promise<void>;
}

/**
 * Get the OPFS databases directory handle
 */
async function getOpfsDatabasesDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const wsDir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
  return wsDir.getDirectoryHandle(DATABASES_SUBDIR, { create: true });
}

/**
 * Default OPFS storage adapter implementation
 */
const defaultAdapter: ErdStorageAdapter = {
  isOpfsAvailable: async () => {
    try {
      const availability = await checkOPFSAvailability();
      return availability.available;
    } catch {
      return false;
    }
  },

  readSidecar: async (dbName: string) => {
    try {
      const dir = await getOpfsDatabasesDir();
      const filename = toErdFilename(dbName);
      const fileHandle = await dir.getFileHandle(filename);
      const file = await fileHandle.getFile();
      return file.text();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        return null;
      }
      throw err;
    }
  },

  writeSidecar: async (dbName: string, content: string) => {
    const dir = await getOpfsDatabasesDir();
    const filename = toErdFilename(dbName);
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(content);
    } finally {
      await writable.close();
    }
  },

  deleteSidecar: async (dbName: string) => {
    try {
      const dir = await getOpfsDatabasesDir();
      const filename = toErdFilename(dbName);
      await dir.removeEntry(filename);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        return; // File doesn't exist, that's fine
      }
      throw err;
    }
  },
};

let _adapter: ErdStorageAdapter = defaultAdapter;

/**
 * Get the current storage adapter
 */
export function getStorageAdapter(): ErdStorageAdapter {
  return _adapter;
}

/**
 * Set a custom storage adapter (for testing)
 */
export function setStorageAdapter(adapter: ErdStorageAdapter): void {
  _adapter = adapter;
}

/**
 * Reset to default adapter (for testing)
 */
export function resetStorageAdapter(): void {
  _adapter = defaultAdapter;
}
