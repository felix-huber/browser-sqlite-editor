/**
 * Database Registry Management
 *
 * Manages a registry of all known databases with CRUD operations and self-healing.
 *
 * Storage:
 * - Primary: OPFS /sqlite-editor/registry.json
 * - Fallback: IndexedDB "sqlite-editor-registry" store
 *
 * Schema: { databases: [{ id, name, createdAt, lastOpenedAt, storageType }] }
 *
 * Self-healing:
 * - Validates registry against actual OPFS/IDB contents on load
 * - Removes orphaned entries (registry entry but no actual file)
 * - Discovers unregistered files (file exists but not in registry)
 * - Repairs corrupted JSON by resetting to empty array
 */

import type { StorageMode } from '../types';
import { checkOPFSAvailability, IDB_VFS_NAME } from '../core/engine/opfs-vfs';

// =============================================================================
// Constants
// =============================================================================

/** OPFS root directory for SQLite editor */
const OPFS_DIR = '/wasm-sqlite-editor';

/** OPFS subdirectory for database files */
const DATABASES_SUBDIR = 'databases';

/** OPFS registry file path */
const OPFS_REGISTRY_PATH = `${OPFS_DIR}/registry.json`;

/** IndexedDB database name for registry fallback */
const IDB_REGISTRY_DB = 'sqlite-editor-registry';

/** IndexedDB store name for registry */
const IDB_REGISTRY_STORE = 'registry';

/** IndexedDB version */
const IDB_VERSION = 1;

/** IndexedDB database name for IDB VFS storage */
const IDB_VFS_DB = IDB_VFS_NAME;

/** IndexedDB schema version for IDB VFS */
const IDB_VFS_VERSION = 6;

/** IDB VFS store names */
const IDB_VFS_METADATA_STORE = 'metadata';
const IDB_VFS_BLOCKS_STORE = 'blocks';

// =============================================================================
// Types
// =============================================================================

/**
 * Registry entry for a database
 */
export interface RegistryEntry {
  /** Unique identifier for the database */
  id: string;
  /** Display name of the database */
  name: string;
  /** ISO 8601 timestamp when the database was created */
  createdAt: string;
  /** ISO 8601 timestamp when the database was last opened */
  lastOpenedAt: string;
  /** Storage type: 'opfs' or 'idb' */
  storageType: StorageMode;
}

/**
 * Registry data structure
 */
export interface RegistryData {
  databases: RegistryEntry[];
}

/**
 * Patch for updating a database entry
 */
export type RegistryPatch = Partial<Pick<RegistryEntry, 'name' | 'lastOpenedAt'>>;

/**
 * Result of self-healing operation
 */
export interface HealingResult {
  /** Orphaned entries removed (registry had entry, no file existed) */
  orphansRemoved: string[];
  /** Discovered entries added (file existed, no registry entry) */
  discovered: string[];
  /** Whether JSON was corrupted and reset */
  wasCorrupted: boolean;
}

/**
 * Storage adapter interface for dependency injection
 */
export interface StorageAdapter {
  isOpfsAvailable: () => Promise<boolean>;
  readRegistry: (mode: StorageMode) => Promise<RegistryData | null>;
  writeRegistry: (mode: StorageMode, data: RegistryData) => Promise<void>;
  listFiles: (mode: StorageMode) => Promise<string[]>;
  renameFile?: (mode: StorageMode, oldName: string, newName: string) => Promise<void>;
  fileExists?: (mode: StorageMode, name: string) => Promise<boolean>;
  deleteFile?: (mode: StorageMode, name: string) => Promise<void>;
}

// =============================================================================
// Name Validation
// =============================================================================

/** Windows reserved names (case-insensitive) */
const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/** Maximum name length (filesystem limit) */
const MAX_NAME_LENGTH = 255;

/**
 * Validation error codes for rename operations
 */
export type RenameErrorCode =
  | 'INVALID_NAME'
  | 'NAME_EXISTS'
  | 'NAME_EMPTY'
  | 'NAME_TOO_LONG'
  | 'PATH_SEPARATOR'
  | 'HIDDEN_FILE'
  | 'RESERVED_NAME'
  | 'PATH_TRAVERSAL'
  | 'NOT_FOUND'
  | 'RENAME_FAILED';

/**
 * Result of a rename operation
 */
export interface RenameResult {
  success: boolean;
  error?: {
    code: RenameErrorCode;
    message: string;
  };
}

/**
 * Error codes for delete operations
 */
export type DeleteErrorCode = 'NOT_FOUND' | 'DELETE_FAILED';

/**
 * Result of a delete operation
 */
export interface DeleteResult {
  success: boolean;
  error?: {
    code: DeleteErrorCode;
    message: string;
  };
  /** Warnings for partial failures (e.g., file deletion failed but registry updated) */
  warnings?: string[];
}

/**
 * Validate a database name for rename operations
 *
 * Rules:
 * - Reject empty or whitespace-only names
 * - Reject names with path separators: / and \
 * - Reject names starting with . (hidden files)
 * - Reject reserved names: CON, PRN, NUL, AUX, COM1-9, LPT1-9 (Windows)
 * - Reject names with .. (path traversal)
 * - Max length: 255 characters
 *
 * @param name - Name to validate
 * @returns Validation result with error details if invalid
 */
export function validateDatabaseName(name: string): RenameResult {
  // Trim the name for validation
  const trimmed = name.trim();

  // Check for empty or whitespace-only
  if (!trimmed || trimmed.length === 0) {
    return {
      success: false,
      error: {
        code: 'NAME_EMPTY',
        message: 'Database name cannot be empty or whitespace-only',
      },
    };
  }

  // Check max length
  if (trimmed.length > MAX_NAME_LENGTH) {
    return {
      success: false,
      error: {
        code: 'NAME_TOO_LONG',
        message: `Database name cannot exceed ${MAX_NAME_LENGTH} characters`,
      },
    };
  }

  // Check for path separators
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return {
      success: false,
      error: {
        code: 'PATH_SEPARATOR',
        message: 'Database name cannot contain path separators (/ or \\)',
      },
    };
  }

  // Check for path traversal sequences (check before hidden file check)
  if (trimmed.includes('..')) {
    return {
      success: false,
      error: {
        code: 'PATH_TRAVERSAL',
        message: 'Database name cannot contain ".." sequences',
      },
    };
  }

  // Check for hidden file (starts with .)
  if (trimmed.startsWith('.')) {
    return {
      success: false,
      error: {
        code: 'HIDDEN_FILE',
        message: 'Database name cannot start with a dot',
      },
    };
  }

  // Check for Windows reserved names (case-insensitive)
  // Also check with common extensions like .sqlite
  const baseName = trimmed.split('.')[0].toLowerCase();
  if (WINDOWS_RESERVED_NAMES.has(baseName)) {
    return {
      success: false,
      error: {
        code: 'RESERVED_NAME',
        message: `"${baseName.toUpperCase()}" is a reserved name and cannot be used`,
      },
    };
  }

  return { success: true };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a unique ID for a new database entry
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Get current ISO 8601 timestamp
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Derive filename from database name
 */
export function toFilename(name: string): string {
  // Sanitize name for filesystem
  const sanitized = name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .toLowerCase();
  return `${sanitized}.sqlite`;
}

// =============================================================================
// OPFS Operations
// =============================================================================

/**
 * Check if OPFS is available
 */
async function isOpfsAvailable(): Promise<boolean> {
  try {
    const availability = await checkOPFSAvailability();
    return availability.available;
  } catch {
    return false;
  }
}

/**
 * Get or create the OPFS root directory for wasm-sqlite-editor
 */
async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('wasm-sqlite-editor', { create: true });
}

/**
 * Get or create the OPFS databases subdirectory
 */
async function getOpfsDatabasesDir(): Promise<FileSystemDirectoryHandle> {
  const root = await getOpfsRoot();
  return root.getDirectoryHandle(DATABASES_SUBDIR, { create: true });
}

/**
 * Construct the full OPFS path for a database file
 */
function getOpfsDatabasePath(name: string): string {
  const filename = toFilename(name);
  return `${OPFS_DIR}/${DATABASES_SUBDIR}/${filename}`;
}

/**
 * Construct the full OPFS path for an ERD sidecar file
 */
function getOpfsErdPath(name: string): string {
  const basename = toFilename(name).replace(/\.sqlite$/, '');
  return `${OPFS_DIR}/${DATABASES_SUBDIR}/${basename}.erd.json`;
}

/**
 * Read registry from OPFS
 */
async function readOpfsRegistry(): Promise<RegistryData | null> {
  try {
    const dir = await getOpfsRoot();
    const file = await dir.getFileHandle('registry.json');
    const blob = await file.getFile();
    const text = await blob.text();
    return JSON.parse(text) as RegistryData;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return null;
    }
    throw err;
  }
}

/**
 * Write registry to OPFS
 */
async function writeOpfsRegistry(data: RegistryData): Promise<void> {
  const dir = await getOpfsRoot();
  const file = await dir.getFileHandle('registry.json', { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(JSON.stringify(data, null, 2));
  } finally {
    await writable.close();
  }
}

/**
 * List all database files in OPFS databases/ subdirectory
 */
async function listOpfsFiles(): Promise<string[]> {
  const files: string[] = [];
  try {
    const dir = await getOpfsDatabasesDir();
    // Cast to AsyncIterable to work with the iterator
    const entries = (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)[Symbol.asyncIterator]();
    for await (const [name, handle] of { [Symbol.asyncIterator]: () => entries }) {
      if (handle.kind === 'file' && name.endsWith('.sqlite')) {
        files.push(name);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  return files;
}

/**
 * Check if a database file exists in OPFS databases/ subdirectory
 */
async function opfsFileExists(filename: string): Promise<boolean> {
  try {
    const dir = await getOpfsDatabasesDir();
    await dir.getFileHandle(filename);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rename a file in OPFS databases/ subdirectory
 *
 * Since OPFS doesn't have a native rename API, we:
 * 1. Read the old file
 * 2. Write to the new file
 * 3. Delete the old file
 */
async function renameOpfsFile(oldFilename: string, newFilename: string): Promise<void> {
  const dir = await getOpfsDatabasesDir();

  // Get the old file
  const oldHandle = await dir.getFileHandle(oldFilename);
  const file = await oldHandle.getFile();
  const data = await file.arrayBuffer();

  // Create the new file and write data
  const newHandle = await dir.getFileHandle(newFilename, { create: true });
  const writable = await newHandle.createWritable();
  try {
    await writable.write(data);
  } finally {
    await writable.close();
  }

  // Delete the old file
  await dir.removeEntry(oldFilename);
}

/**
 * Rename the .erd.json sidecar file in OPFS databases/ subdirectory (if it exists)
 */
async function renameOpfsSidecar(oldBasename: string, newBasename: string): Promise<void> {
  const dir = await getOpfsDatabasesDir();
  const oldSidecar = `${oldBasename}.erd.json`;
  const newSidecar = `${newBasename}.erd.json`;

  try {
    // Check if sidecar exists
    const oldHandle = await dir.getFileHandle(oldSidecar);
    const file = await oldHandle.getFile();
    const data = await file.arrayBuffer();

    // Create new sidecar
    const newHandle = await dir.getFileHandle(newSidecar, { create: true });
    const writable = await newHandle.createWritable();
    try {
      await writable.write(data);
    } finally {
      await writable.close();
    }

    // Delete old sidecar
    await dir.removeEntry(oldSidecar);
  } catch {
    // Sidecar doesn't exist, that's fine
  }
}

/**
 * Delete a database file from OPFS databases/ subdirectory
 */
async function deleteOpfsFile(filename: string): Promise<void> {
  const dir = await getOpfsDatabasesDir();
  try {
    await dir.removeEntry(filename);
  } catch (err) {
    // If file doesn't exist, that's okay
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return;
    }
    throw err;
  }
}

/**
 * Delete the .erd.json sidecar file in OPFS databases/ subdirectory (if it exists)
 */
async function deleteOpfsSidecar(basename: string): Promise<void> {
  const dir = await getOpfsDatabasesDir();
  const sidecar = `${basename}.erd.json`;

  try {
    await dir.removeEntry(sidecar);
  } catch {
    // Sidecar doesn't exist, that's fine
  }
}

// =============================================================================
// IndexedDB Operations
// =============================================================================

/**
 * Open the IndexedDB registry database
 */
function openIdbRegistry(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_REGISTRY_DB, IDB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_REGISTRY_STORE)) {
        db.createObjectStore(IDB_REGISTRY_STORE, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Read registry from IndexedDB
 */
async function readIdbRegistry(): Promise<RegistryData | null> {
  const db = await openIdbRegistry();
  try {
    const tx = db.transaction(IDB_REGISTRY_STORE, 'readonly');
    const store = tx.objectStore(IDB_REGISTRY_STORE);

    return new Promise((resolve, reject) => {
      const request = store.get('registry');
      request.onsuccess = () => {
        const result = request.result as { key: string; data: RegistryData } | undefined;
        resolve(result?.data ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Write registry to IndexedDB
 */
async function writeIdbRegistry(data: RegistryData): Promise<void> {
  const db = await openIdbRegistry();
  try {
    const tx = db.transaction(IDB_REGISTRY_STORE, 'readwrite');
    const store = tx.objectStore(IDB_REGISTRY_STORE);

    await new Promise<void>((resolve, reject) => {
      const request = store.put({ key: 'registry', data });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function toIdbVfsPath(name: string): string {
  return new URL(name, 'file://').pathname;
}

function fromIdbVfsPath(path: string): string | null {
  const trimmed = path.startsWith('/') ? path.slice(1) : path;
  if (!trimmed) return null;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function isAuxiliaryDbFile(name: string): boolean {
  return name.endsWith('-journal') || name.endsWith('-wal') || name.endsWith('-shm');
}

async function openIdbVfsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_VFS_DB, IDB_VFS_VERSION);
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

/**
 * List database entries from IDB VFS metadata store
 */
async function listIdbVfsDatabases(): Promise<string[]> {
  try {
    const db = await openIdbVfsDatabase();
    try {
      const tx = db.transaction(IDB_VFS_METADATA_STORE, 'readonly');
      const store = tx.objectStore(IDB_VFS_METADATA_STORE);
      const keys = await new Promise<string[]>((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result as string[]);
        request.onerror = () => reject(request.error);
      });
      const names = new Set<string>();
      for (const key of keys) {
        const decoded = fromIdbVfsPath(String(key));
        if (!decoded) continue;
        if (decoded.startsWith('.')) continue;
        if (isAuxiliaryDbFile(decoded)) continue;
        names.add(decoded);
      }
      return [...names];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
 * List all database keys in the legacy IDB databases store
 */
async function listLegacyIdbDatabases(): Promise<string[]> {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('idb-sqlite', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        if (!database.objectStoreNames.contains('databases')) {
          database.createObjectStore('databases', { keyPath: 'name' });
        }
      };
    });

    try {
      const tx = db.transaction('databases', 'readonly');
      const store = tx.objectStore('databases');

      const names = await new Promise<string[]>((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result as string[]);
        request.onerror = () => reject(request.error);
      });

      return names;
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
 * List all database keys in IDB (VFS + legacy snapshots)
 */
async function listIdbDatabases(): Promise<string[]> {
  const [vfsNames, legacyNames] = await Promise.all([
    listIdbVfsDatabases(),
    listLegacyIdbDatabases(),
  ]);
  const names = new Set<string>();
  for (const name of vfsNames) names.add(name);
  for (const name of legacyNames) names.add(name);
  return [...names];
}

/**
 * Check if a database exists in IDB
 */
async function idbDatabaseExists(name: string): Promise<boolean> {
  const path = toIdbVfsPath(name);
  try {
    const db = await openIdbVfsDatabase();
    try {
      const tx = db.transaction(IDB_VFS_METADATA_STORE, 'readonly');
      const store = tx.objectStore(IDB_VFS_METADATA_STORE);
      const exists = await new Promise<boolean>((resolve, reject) => {
        const request = store.getKey(path);
        request.onsuccess = () => resolve(request.result !== undefined);
        request.onerror = () => reject(request.error);
      });
      if (exists) return true;
    } finally {
      db.close();
    }
  } catch {
    // Ignore and fall back to legacy check
  }

  const databases = await listLegacyIdbDatabases();
  return databases.includes(name);
}

/**
 * Rename a database in IDB
 *
 * IndexedDB stores databases with a 'name' keyPath, so we:
 * 1. Read the old entry
 * 2. Create a new entry with the new name
 * 3. Delete the old entry
 */
async function renameIdbDatabase(oldName: string, newName: string): Promise<void> {
  const oldPath = toIdbVfsPath(oldName);
  const newPath = toIdbVfsPath(newName);

  try {
    const db = await openIdbVfsDatabase();
    try {
      const tx = db.transaction([IDB_VFS_METADATA_STORE, IDB_VFS_BLOCKS_STORE], 'readwrite');
      const metadata = tx.objectStore(IDB_VFS_METADATA_STORE);
      const blocks = tx.objectStore(IDB_VFS_BLOCKS_STORE);

      const oldEntry = await new Promise<{ name: string; fileSize: number; version: number; pendingVersion?: number } | undefined>(
        (resolve, reject) => {
          const request = metadata.get(oldPath);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }
      );

      if (!oldEntry) {
        throw new Error(`Database "${oldName}" not found`);
      }

      await new Promise<void>((resolve, reject) => {
        const request = metadata.put({ ...oldEntry, name: newPath });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      await new Promise<void>((resolve, reject) => {
        const request = metadata.delete(oldPath);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      await new Promise<void>((resolve, reject) => {
        const range = IDBKeyRange.bound([oldPath, -Infinity], [oldPath, Infinity]);
        const request = blocks.openCursor(range);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          const value = cursor.value as { path: string; offset: number; version: number; data: Uint8Array };
          const putRequest = blocks.put({ ...value, path: newPath });
          putRequest.onerror = () => reject(putRequest.error);
          putRequest.onsuccess = () => {
            const deleteRequest = cursor.delete();
            deleteRequest.onerror = () => reject(deleteRequest.error);
            deleteRequest.onsuccess = () => cursor.continue();
          };
        };
      });

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return;
    } finally {
      db.close();
    }
  } catch {
    // Fall back to legacy snapshot rename
  }

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('idb-sqlite', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains('databases')) {
        database.createObjectStore('databases', { keyPath: 'name' });
      }
    };
  });

  try {
    const tx = db.transaction('databases', 'readwrite');
    const store = tx.objectStore('databases');

    const oldEntry = await new Promise<{ name: string; blob: Blob; updatedAt: string } | undefined>(
      (resolve, reject) => {
        const request = store.get(oldName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );

    if (!oldEntry) {
      throw new Error(`Database "${oldName}" not found`);
    }

    await new Promise<void>((resolve, reject) => {
      const request = store.put({
        name: newName,
        blob: oldEntry.blob,
        updatedAt: new Date().toISOString(),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(oldName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Delete a database from IDB
 */
async function deleteIdbDatabase(name: string): Promise<void> {
  const path = toIdbVfsPath(name);

  try {
    const db = await openIdbVfsDatabase();
    try {
      const tx = db.transaction([IDB_VFS_METADATA_STORE, IDB_VFS_BLOCKS_STORE], 'readwrite');
      const metadata = tx.objectStore(IDB_VFS_METADATA_STORE);
      const blocks = tx.objectStore(IDB_VFS_BLOCKS_STORE);

      await new Promise<void>((resolve, reject) => {
        const range = IDBKeyRange.bound([path, -Infinity], [path, Infinity]);
        const request = blocks.delete(range);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      await new Promise<void>((resolve, reject) => {
        const request = metadata.delete(path);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return;
    } finally {
      db.close();
    }
  } catch {
    // Fall back to legacy snapshot delete
  }

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('idb-sqlite', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains('databases')) {
        database.createObjectStore('databases', { keyPath: 'name' });
      }
    };
  });

  try {
    const tx = db.transaction('databases', 'readwrite');
    const store = tx.objectStore('databases');

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// =============================================================================
// Default Storage Adapter
// =============================================================================

/**
 * Default storage adapter using real OPFS/IDB
 */
const defaultStorageAdapter: StorageAdapter = {
  isOpfsAvailable,
  readRegistry: async (mode) => {
    return mode === 'opfs' ? readOpfsRegistry() : readIdbRegistry();
  },
  writeRegistry: async (mode, data) => {
    if (mode === 'opfs') {
      await writeOpfsRegistry(data);
    } else {
      await writeIdbRegistry(data);
    }
  },
  listFiles: async (mode) => {
    return mode === 'opfs' ? listOpfsFiles() : listIdbDatabases();
  },
  renameFile: async (mode, oldName, newName) => {
    if (mode === 'opfs') {
      // For OPFS, we need to rename the .sqlite file
      const oldFilename = toFilename(oldName);
      const newFilename = toFilename(newName);
      await renameOpfsFile(oldFilename, newFilename);
      // Also rename the sidecar
      await renameOpfsSidecar(
        oldFilename.replace(/\.sqlite$/, ''),
        newFilename.replace(/\.sqlite$/, '')
      );
    } else {
      await renameIdbDatabase(oldName, newName);
    }
  },
  fileExists: async (mode, name) => {
    if (mode === 'opfs') {
      return opfsFileExists(toFilename(name));
    } else {
      return idbDatabaseExists(name);
    }
  },
  deleteFile: async (mode, name) => {
    if (mode === 'opfs') {
      // For OPFS, delete the .sqlite file and sidecar
      const filename = toFilename(name);
      await deleteOpfsFile(filename);
      // Also delete the sidecar
      await deleteOpfsSidecar(filename.replace(/\.sqlite$/, ''));
    } else {
      await deleteIdbDatabase(name);
    }
  },
};

// =============================================================================
// DatabaseRegistry Class
// =============================================================================

/**
 * Database Registry Manager
 *
 * Provides CRUD operations for database metadata and self-healing on load.
 */
export class DatabaseRegistry {
  private data: RegistryData = { databases: [] };
  private storageMode: StorageMode = 'idb';
  private initialized = false;
  private adapter: StorageAdapter;

  constructor(adapter?: StorageAdapter) {
    this.adapter = adapter ?? defaultStorageAdapter;
  }

  /**
   * Initialize the registry
   *
   * - Detects storage mode (OPFS or IDB)
   * - Loads registry from storage
   * - Runs self-healing
   */
  async init(): Promise<HealingResult> {
    const opfsAvailable = await this.adapter.isOpfsAvailable();
    this.storageMode = opfsAvailable ? 'opfs' : 'idb';

    const healingResult = await this.loadAndHeal();
    this.initialized = true;
    return healingResult;
  }

  /**
   * Get current storage mode
   */
  getStorageMode(): StorageMode {
    return this.storageMode;
  }

  /**
   * Load registry and run self-healing
   */
  private async loadAndHeal(): Promise<HealingResult> {
    const result: HealingResult = {
      orphansRemoved: [],
      discovered: [],
      wasCorrupted: false,
    };

    // Load registry data
    try {
      const rawData = await this.adapter.readRegistry(this.storageMode);

      if (rawData) {
        this.data = rawData;
      } else {
        this.data = { databases: [] };
      }
    } catch {
      // JSON parse error or other corruption
      result.wasCorrupted = true;
      this.data = { databases: [] };
    }

    // Validate registry structure
    if (!this.data || !Array.isArray(this.data.databases)) {
      result.wasCorrupted = true;
      this.data = { databases: [] };
    }

    // Get actual files
    const actualFiles = await this.adapter.listFiles(this.storageMode);

    // Find orphans (registry has entry, no file)
    const validEntries: RegistryEntry[] = [];
    for (const entry of this.data.databases) {
      const filename = this.storageMode === 'opfs'
        ? toFilename(entry.name)
        : entry.name;

      const exists = actualFiles.includes(filename);
      if (exists) {
        validEntries.push(entry);
      } else {
        result.orphansRemoved.push(entry.id);
      }
    }

    // Find discovered files (file exists, no registry entry)
    const registeredNames = new Set(
      this.data.databases.map((e) =>
        this.storageMode === 'opfs' ? toFilename(e.name) : e.name
      )
    );

    for (const filename of actualFiles) {
      if (!registeredNames.has(filename)) {
        // Derive name from filename (only transform for OPFS)
        const name = this.storageMode === 'opfs'
          ? filename.replace(/\.sqlite$/, '').replace(/_/g, ' ')
          : filename;
        const newEntry: RegistryEntry = {
          id: generateId(),
          name,
          createdAt: now(),
          lastOpenedAt: now(),
          storageType: this.storageMode,
        };
        validEntries.push(newEntry);
        result.discovered.push(newEntry.id);
      }
    }

    // Update registry with healed data
    this.data.databases = validEntries;

    // Persist if any changes were made
    if (result.wasCorrupted || result.orphansRemoved.length > 0 || result.discovered.length > 0) {
      await this.save();
    }

    return result;
  }

  /**
   * Save registry to storage
   */
  private async save(): Promise<void> {
    await this.adapter.writeRegistry(this.storageMode, this.data);
  }

  /**
   * List all registered databases
   */
  listDatabases(): RegistryEntry[] {
    return [...this.data.databases];
  }

  /**
   * Register a new database
   *
   * @param name Display name for the database
   * @param storageType Storage mode (defaults to current mode)
   * @returns The new database ID
   */
  async registerDatabase(name: string, storageType?: StorageMode): Promise<string> {
    const id = generateId();
    const timestamp = now();

    const entry: RegistryEntry = {
      id,
      name,
      createdAt: timestamp,
      lastOpenedAt: timestamp,
      storageType: storageType ?? this.storageMode,
    };

    this.data.databases.push(entry);
    await this.save();

    return id;
  }

  /**
   * Update a database entry
   *
   * @param id Database ID to update
   * @param patch Fields to update
   * @returns true if updated, false if not found
   */
  async updateDatabase(id: string, patch: RegistryPatch): Promise<boolean> {
    const entry = this.data.databases.find((e) => e.id === id);
    if (!entry) {
      return false;
    }

    if (patch.name !== undefined) {
      entry.name = patch.name;
    }
    if (patch.lastOpenedAt !== undefined) {
      entry.lastOpenedAt = patch.lastOpenedAt;
    }

    await this.save();
    return true;
  }

  /**
   * Remove a database from the registry
   *
   * @param id Database ID to remove
   * @returns true if removed, false if not found
   */
  async removeDatabase(id: string): Promise<boolean> {
    const index = this.data.databases.findIndex((e) => e.id === id);
    if (index === -1) {
      return false;
    }

    this.data.databases.splice(index, 1);
    await this.save();
    return true;
  }

  /**
   * Delete a database completely
   *
   * This operation:
   * 1. Removes the entry from the registry
   * 2. Deletes the .erd.json sidecar file (if exists)
   * 3. Deletes the database file from OPFS/IDB
   *
   * Note: The caller is responsible for:
   * - Closing the database connection first if open
   * - Releasing any Web Locks held for this database
   * - Clearing pending write operations
   * - Deleting query history (qh:<db> key)
   *
   * @param name Database name to delete
   * @returns Result with success/error
   */
  async deleteDatabase(name: string): Promise<DeleteResult> {
    // Step 1: Find the entry by name
    const entry = this.data.databases.find((e) => e.name === name);
    if (!entry) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Database "${name}" not found in registry`,
        },
      };
    }

    const errors: string[] = [];

    // Step 2: Remove from registry first (so it doesn't show up even if file deletion fails)
    const index = this.data.databases.findIndex((e) => e.name === name);
    if (index !== -1) {
      this.data.databases.splice(index, 1);
      await this.save();
    }

    // Step 3: Delete the file and sidecar via adapter
    if (this.adapter.deleteFile) {
      try {
        await this.adapter.deleteFile(this.storageMode, name);
      } catch (err) {
        // Log but don't fail - registry entry is already removed
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`File deletion failed: ${message}`);
        console.warn(`[DatabaseRegistry] Failed to delete file for "${name}":`, err);
      }
    }

    // If there were errors, mark as partially failed (for potential self-healing)
    if (errors.length > 0) {
      return {
        success: true, // Registry updated, so technically succeeded
        warnings: errors,
      };
    }

    return { success: true };
  }

  /**
   * Get a database entry by ID
   *
   * @param id Database ID
   * @returns The entry or null if not found
   */
  getDatabaseById(id: string): RegistryEntry | null {
    return this.data.databases.find((e) => e.id === id) ?? null;
  }

  /**
   * Get a database entry by name
   *
   * @param name Database name
   * @returns The entry or null if not found
   */
  getDatabaseByName(name: string): RegistryEntry | null {
    return this.data.databases.find((e) => e.name === name) ?? null;
  }

  /**
   * Update last opened timestamp for a database
   *
   * @param id Database ID
   */
  async touchDatabase(id: string): Promise<void> {
    await this.updateDatabase(id, { lastOpenedAt: now() });
  }

  /**
   * Check if a database name is already registered
   */
  hasDatabase(name: string): boolean {
    return this.data.databases.some((e) => e.name === name);
  }

  /**
   * Get count of registered databases
   */
  count(): number {
    return this.data.databases.length;
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Force reload registry from storage
   */
  async reload(): Promise<HealingResult> {
    return this.loadAndHeal();
  }

  /**
   * Clear all entries (for testing)
   */
  async clear(): Promise<void> {
    this.data.databases = [];
    await this.save();
  }

  /**
   * Rename a database
   *
   * This operation:
   * 1. Validates the new name
   * 2. Checks the new name doesn't already exist
   * 3. Renames the storage file (OPFS) or entry (IDB)
   * 4. Updates the registry entry
   * 5. Triggers query history migration
   *
   * @param id Database ID to rename
   * @param newName New name for the database
   * @returns Result with success/error
   */
  async renameDatabase(id: string, newName: string): Promise<RenameResult> {
    // Step 1: Find the entry
    const entry = this.data.databases.find((e) => e.id === id);
    if (!entry) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Database with ID "${id}" not found`,
        },
      };
    }

    const oldName = entry.name;

    // Same name? No-op success
    if (oldName === newName.trim()) {
      return { success: true };
    }

    // Step 2: Validate the new name
    const validation = validateDatabaseName(newName);
    if (!validation.success) {
      return validation;
    }

    const trimmedNewName = newName.trim();

    // Step 3: Check if new name already exists
    const existingEntry = this.data.databases.find(
      (e) => e.name.toLowerCase() === trimmedNewName.toLowerCase() && e.id !== id
    );
    if (existingEntry) {
      return {
        success: false,
        error: {
          code: 'NAME_EXISTS',
          message: `A database named "${trimmedNewName}" already exists`,
        },
      };
    }

    // Step 4: Check if the target file already exists in storage
    if (this.adapter.fileExists) {
      const fileExists = await this.adapter.fileExists(this.storageMode, trimmedNewName);
      if (fileExists) {
        return {
          success: false,
          error: {
            code: 'NAME_EXISTS',
            message: `A file named "${trimmedNewName}" already exists in storage`,
          },
        };
      }
    }

    // Step 5: Rename the storage file
    if (this.adapter.renameFile) {
      try {
        await this.adapter.renameFile(this.storageMode, oldName, trimmedNewName);
      } catch (err) {
        return {
          success: false,
          error: {
            code: 'RENAME_FAILED',
            message: `Failed to rename file: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
    }

    // Step 6: Update the registry entry
    entry.name = trimmedNewName;
    await this.save();

    return { success: true };
  }
}

// =============================================================================
// Module-level Singleton
// =============================================================================

let _registryInstance: DatabaseRegistry | null = null;

/**
 * Get the singleton registry instance
 */
export function getRegistry(): DatabaseRegistry {
  if (!_registryInstance) {
    _registryInstance = new DatabaseRegistry();
  }
  return _registryInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetRegistry(): void {
  _registryInstance = null;
}

// =============================================================================
// Exports for testing
// =============================================================================

export const _testing = {
  OPFS_DIR,
  DATABASES_SUBDIR,
  OPFS_REGISTRY_PATH,
  IDB_REGISTRY_DB,
  IDB_REGISTRY_STORE,
  IDB_VERSION,
  MAX_NAME_LENGTH,
  WINDOWS_RESERVED_NAMES,
  generateId,
  now,
  toFilename,
  getOpfsDatabasePath,
  getOpfsErdPath,
  isOpfsAvailable,
  readOpfsRegistry,
  writeOpfsRegistry,
  listOpfsFiles,
  opfsFileExists,
  renameOpfsFile,
  renameOpfsSidecar,
  deleteOpfsFile,
  deleteOpfsSidecar,
  readIdbRegistry,
  writeIdbRegistry,
  listIdbDatabases,
  idbDatabaseExists,
  renameIdbDatabase,
  deleteIdbDatabase,
  defaultStorageAdapter,
};
