/**
 * Storage utilities for worker operations.
 */

import { getEngine } from '../core/engine/db-engine';
import {
  checkOPFSAvailability,
  databaseExistsInOPFS,
  getOPFSPath,
  OPFS_VFS_NAME,
  IDB_VFS_NAME,
  readOPFSDatabase,
  deleteOPFSDatabase,
} from '../core/engine/opfs-vfs';
import { getIDBStorage } from './idb-storage';
import { getRegistry, toFilename } from './db-registry';

const IDB_VFS_VERSION = 6;
const IDB_VFS_METADATA_STORE = 'metadata';
const IDB_VFS_BLOCKS_STORE = 'blocks';

/**
 * Resolve database path based on storage mode.
 */
export async function resolveDbPath(
  dbName: string,
  options: { allowCreate?: boolean } = {}
): Promise<{ path: string; vfsName?: string }> {
  const registry = getRegistry();
  if (!registry.isInitialized()) {
    await registry.init();
  }
  const entry = registry.getDatabaseByName(dbName);
  let storageMode = entry?.storageType ?? registry.getStorageMode();
  if (storageMode === 'opfs') {
    const availability = await checkOPFSAvailability();
    if (!availability.available) {
      storageMode = 'idb';
    } else if (!options.allowCreate) {
      const exists = await databaseExistsInOPFS(toFilename(dbName));
      if (!exists) {
        storageMode = 'idb';
      }
    }
  }
  if (storageMode === 'opfs') {
    return { path: getOPFSPath(toFilename(dbName)), vfsName: OPFS_VFS_NAME };
  }
  if (storageMode === 'idb') {
    return { path: dbName, vfsName: IDB_VFS_NAME };
  }
  return { path: dbName };
}

function toIdbVfsPath(name: string): string {
  return new URL(name, 'file://').pathname;
}

async function openIdbVfsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_VFS_NAME, IDB_VFS_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_VFS_BLOCKS_STORE)) {
        db.createObjectStore(IDB_VFS_BLOCKS_STORE, { keyPath: ['path', 'offset', 'version'] });
      } else {
        const tx = request.transaction;
        const blocks = tx?.objectStore(IDB_VFS_BLOCKS_STORE);
        if (blocks && blocks.indexNames.contains('version')) {
          blocks.deleteIndex('version');
        }
      }
      if (!db.objectStoreNames.contains(IDB_VFS_METADATA_STORE)) {
        db.createObjectStore(IDB_VFS_METADATA_STORE, { keyPath: 'name' });
      }
    };
  });
}

async function readIdbVfsDatabase(dbName: string): Promise<Uint8Array | null> {
  const db = await openIdbVfsDatabase();
  try {
    const path = toIdbVfsPath(dbName);
    const tx = db.transaction([IDB_VFS_METADATA_STORE, IDB_VFS_BLOCKS_STORE], 'readonly');
    const metadata = tx.objectStore(IDB_VFS_METADATA_STORE);
    const blocks = tx.objectStore(IDB_VFS_BLOCKS_STORE);

    const meta = await new Promise<{ name: string; fileSize: number; version: number } | undefined>(
      (resolve, reject) => {
        const request = metadata.get(path);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );

    if (!meta) {
      return null;
    }

    const fileSize = Math.max(0, meta.fileSize ?? 0);
    const output = new Uint8Array(fileSize);

    const range = IDBKeyRange.bound([path, -Infinity], [path, Infinity]);
    const entries = await new Promise<{ path: string; offset: number; version: number; data: Uint8Array }[]>(
      (resolve, reject) => {
        const results: { path: string; offset: number; version: number; data: Uint8Array }[] = [];
        const request = blocks.openCursor(range);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(results);
            return;
          }
          results.push(cursor.value as { path: string; offset: number; version: number; data: Uint8Array });
          cursor.continue();
        };
      }
    );

    for (const block of entries) {
      if (block.version !== meta.version) {
        continue;
      }
      const start = Math.max(0, -block.offset);
      if (start >= fileSize) {
        continue;
      }
      const sliceLength = Math.min(block.data.byteLength, fileSize - start);
      output.set(block.data.subarray(0, sliceLength), start);
    }

    return output;
  } finally {
    db.close();
  }
}

/**
 * Export a database as a Blob based on storage mode.
 */
export async function exportDatabaseBlob(dbName: string): Promise<Blob> {
  const registry = getRegistry();
  if (!registry.isInitialized()) {
    await registry.init();
  }

  const entry = registry.getDatabaseByName(dbName);
  if (!entry) {
    throw new Error(`Database "${dbName}" not found`);
  }

  const storageMode = entry.storageType ?? registry.getStorageMode();

  // If this DB is currently open, attempt a checkpoint to include WAL changes.
  try {
    const engine = getEngine();
    if (engine.isReady() && engine.getDbName()) {
      const { path } = await resolveDbPath(dbName);
      if (engine.getDbName() === path) {
        await engine.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      }
    }
  } catch {
    // Best-effort: export can still proceed without checkpoint
  }

  if (storageMode === 'opfs') {
    const engine = getEngine();
    const exportFile = `__export_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`;
    let vacuumed = false;

    try {
      if (engine.isReady() && engine.getDbName()) {
        const { path } = await resolveDbPath(dbName);
        if (engine.getDbName() === path) {
          try {
            await engine.exec(`VACUUM INTO '${getOPFSPath(exportFile)}'`);
            vacuumed = true;
          } catch {
            // Fall back to reading the live file
          }
        }
      }

      const bytes = await readOPFSDatabase(vacuumed ? exportFile : toFilename(entry.name));
      if (!bytes) {
        throw new Error(`Database file for "${dbName}" not found in OPFS`);
      }
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return new Blob([copy.buffer], { type: 'application/x-sqlite3' });
    } finally {
      if (vacuumed) {
        try {
          await deleteOPFSDatabase(exportFile);
        } catch {
          // Best-effort cleanup
        }
      }
    }
  }

  // IDB mode: read from IDB VFS, fall back to legacy snapshot storage
  const idbBytes = await readIdbVfsDatabase(entry.name);
  if (idbBytes) {
    const copy = new Uint8Array(idbBytes.byteLength);
    copy.set(idbBytes);
    return new Blob([copy.buffer], { type: 'application/x-sqlite3' });
  }

  const storage = getIDBStorage();
  try {
    await storage.flush();
  } catch {
    // Ignore flush failures here; try to export the last good snapshot
  }

  const blob = await storage.load(entry.name);
  if (!blob) {
    throw new Error(`Database file for "${dbName}" not found in IndexedDB`);
  }
  return blob.type ? blob : blob.slice(0, blob.size, 'application/x-sqlite3');
}
