/**
 * Database Registry Management
 *
 * Manages a registry of all known databases with CRUD operations and self-healing.
 *
 * Storage:
 * - Primary: OPFS /wasm-sqlite-editor/registry.json
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

/** Legacy OPFS root directory (pre-migration layout) */
const LEGACY_OPFS_DIR = 'sqlite-editor';

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
  /** Number of case collisions resolved */
  caseCollisionsResolved: number;
  /** Orphaned .erd.json sidecar files removed */
  orphanedSidecarsRemoved: string[];
  /** Orphaned journal files removed (-wal, -shm, -journal) */
  orphanedJournalsRemoved: string[];
  /** Files migrated from legacy layout (/sqlite-editor/ → /wasm-sqlite-editor/databases/) */
  migratedFiles: string[];
  /** Whether registry was migrated from legacy layout */
  migratedRegistry: boolean;
}

/**
 * Result of WAL/SHM file verification
 */
export interface WalVerificationResult {
  /** Whether verification passed (no WAL/SHM files found) */
  success: boolean;
  /** List of WAL/SHM files found (if any) */
  walFilesFound: string[];
  /** Error message if verification could not be performed */
  error?: string;
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
  /** Get the lastModified timestamp of a file (for case collision resolution) */
  getFileLastModified?: (mode: StorageMode, filename: string) => Promise<number>;
  /** List ALL files in the databases directory (including sidecars, journals) */
  listAllFiles?: () => Promise<string[]>;
  /** Delete a raw file by filename (for orphan cleanup) */
  deleteRawFile?: (filename: string) => Promise<void>;
  /** Rename a raw file by filename (for case collision resolution) */
  renameRawFile?: (oldFilename: string, newFilename: string) => Promise<void>;
  /** Check if legacy /sqlite-editor/ directory exists (for migration) */
  checkLegacyLayout?: () => Promise<boolean>;
  /** Read registry from legacy /sqlite-editor/registry.json */
  readLegacyRegistry?: () => Promise<RegistryData | null>;
  /** List files in legacy /sqlite-editor/ directory */
  listLegacyFiles?: () => Promise<string[]>;
  /** Copy a file from legacy to new layout (preserves original for rollback) */
  copyLegacyFile?: (filename: string) => Promise<void>;
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

/** Maximum name length per PRD (1-64 chars) */
const MAX_NAME_LENGTH = 64;

/**
 * Allowed characters per PRD: alphanumeric, spaces, hyphens, underscores, dots, parentheses
 * No path separators or control characters
 */
const PRD_ALLOWED_CHARS_REGEX = /^[a-zA-Z0-9 \-_().]+$/;

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
  | 'INVALID_CHARS'
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
 * Validate a database name per PRD requirements (US-002)
 *
 * Rules:
 * - Names must be 1–64 characters, trimmed of leading/trailing whitespace
 * - Allowed characters: alphanumeric, spaces, hyphens, underscores, dots, parentheses
 * - No path separators or control characters
 * - Reject names starting with . (hidden files)
 * - Reject reserved names: CON, PRN, NUL, AUX, COM1-9, LPT1-9 (Windows)
 * - Reject names with .. (path traversal)
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

  // Check max length (64 chars per PRD)
  if (trimmed.length > MAX_NAME_LENGTH) {
    return {
      success: false,
      error: {
        code: 'NAME_TOO_LONG',
        message: `Database name cannot exceed ${MAX_NAME_LENGTH} characters`,
      },
    };
  }

  // Check for path separators (before general char check for specific error)
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

  // Check for PRD-allowed characters only
  // Allowed: alphanumeric, spaces, hyphens, underscores, dots, parentheses
  if (!PRD_ALLOWED_CHARS_REGEX.test(trimmed)) {
    return {
      success: false,
      error: {
        code: 'INVALID_CHARS',
        message: 'Database name contains invalid characters. Allowed: letters, numbers, spaces, hyphens, underscores, dots, parentheses',
      },
    };
  }

  return { success: true };
}

/**
 * Generate a unique import name with suffix on collision
 * Per PRD: duplicate names are auto-suffixed with (1), (2), etc. on import
 *
 * @param baseName - The original name from the imported file
 * @param existingNames - List of existing database names
 * @returns A unique name, possibly with suffix
 */
export function generateImportName(baseName: string, existingNames: string[]): string {
  const trimmedBase = baseName.trim();
  const lowerExisting = existingNames.map((n) => n.toLowerCase());

  // Check if base name is available (case-insensitive)
  if (!lowerExisting.includes(trimmedBase.toLowerCase())) {
    return trimmedBase;
  }

  // Find next available suffix
  let suffix = 1;
  while (suffix < 10000) { // Safety limit
    const candidate = `${trimmedBase}(${suffix})`;
    if (!lowerExisting.includes(candidate.toLowerCase())) {
      // Validate length constraint
      if (candidate.length <= MAX_NAME_LENGTH) {
        return candidate;
      }
      // If too long, truncate base name to fit
      const suffixStr = `(${suffix})`;
      const maxBaseLen = MAX_NAME_LENGTH - suffixStr.length;
      const truncatedBase = trimmedBase.substring(0, maxBaseLen);
      return `${truncatedBase}${suffixStr}`;
    }
    suffix++;
  }

  // Fallback (should never reach here)
  return `${trimmedBase}_${Date.now()}`;
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
  // Include () to handle collision resolution suffixes like "(2)"
  const sanitized = name
    .replace(/[<>:"/\\|?*()]/g, '_')
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

/**
 * Get the lastModified timestamp of a file in OPFS databases/ subdirectory
 */
async function getOpfsFileLastModified(filename: string): Promise<number> {
  try {
    const dir = await getOpfsDatabasesDir();
    const fileHandle = await dir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return file.lastModified;
  } catch {
    return 0;
  }
}

/**
 * List ALL files in OPFS databases/ subdirectory (including sidecars, journals)
 */
async function listOpfsAllFiles(): Promise<string[]> {
  const files: string[] = [];
  try {
    const dir = await getOpfsDatabasesDir();
    const entries = (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)[Symbol.asyncIterator]();
    for await (const [name, handle] of { [Symbol.asyncIterator]: () => entries }) {
      if (handle.kind === 'file') {
        files.push(name);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  return files;
}

/**
 * Delete a raw file in OPFS databases/ subdirectory by filename
 */
async function deleteOpfsRawFile(filename: string): Promise<void> {
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
 * Rename a raw file in OPFS databases/ subdirectory
 */
async function renameOpfsRawFile(oldFilename: string, newFilename: string): Promise<void> {
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

// =============================================================================
// Legacy Layout Migration (OPFS)
// =============================================================================

/**
 * Check if legacy /sqlite-editor/ directory exists
 */
async function checkLegacyLayoutExists(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.getDirectoryHandle(LEGACY_OPFS_DIR);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read registry from legacy /sqlite-editor/registry.json
 */
async function readLegacyRegistry(): Promise<RegistryData | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const legacyDir = await root.getDirectoryHandle(LEGACY_OPFS_DIR);
    const file = await legacyDir.getFileHandle('registry.json');
    const blob = await file.getFile();
    const text = await blob.text();
    return JSON.parse(text) as RegistryData;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return null;
    }
    // Log but don't throw - registry might not exist in old layout
    console.warn('[DatabaseRegistry] Failed to read legacy registry:', err);
    return null;
  }
}

/**
 * List all .sqlite files in legacy /sqlite-editor/ directory
 */
async function listLegacyFiles(): Promise<string[]> {
  const files: string[] = [];
  try {
    const root = await navigator.storage.getDirectory();
    const legacyDir = await root.getDirectoryHandle(LEGACY_OPFS_DIR);
    const entries = (legacyDir as unknown as AsyncIterable<[string, FileSystemHandle]>)[Symbol.asyncIterator]();
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
 * Copy a file from legacy /sqlite-editor/ to new /wasm-sqlite-editor/databases/
 * Note: Does NOT delete the original (kept for rollback during one release cycle)
 */
async function copyLegacyFile(filename: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const legacyDir = await root.getDirectoryHandle(LEGACY_OPFS_DIR);
  const newDir = await getOpfsDatabasesDir();

  // Read from legacy location
  const oldHandle = await legacyDir.getFileHandle(filename);
  const file = await oldHandle.getFile();
  const data = await file.arrayBuffer();

  // Write to new location
  const newHandle = await newDir.getFileHandle(filename, { create: true });
  const writable = await newHandle.createWritable();
  try {
    await writable.write(data);
  } finally {
    await writable.close();
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
  getFileLastModified: async (mode, filename) => {
    if (mode === 'opfs') {
      return getOpfsFileLastModified(filename);
    }
    // IDB doesn't have lastModified in the same way; return 0
    return 0;
  },
  listAllFiles: async () => {
    return listOpfsAllFiles();
  },
  deleteRawFile: async (filename) => {
    await deleteOpfsRawFile(filename);
  },
  renameRawFile: async (oldFilename, newFilename) => {
    await renameOpfsRawFile(oldFilename, newFilename);
  },
  checkLegacyLayout: checkLegacyLayoutExists,
  readLegacyRegistry: readLegacyRegistry,
  listLegacyFiles: listLegacyFiles,
  copyLegacyFile: copyLegacyFile,
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
      caseCollisionsResolved: 0,
      orphanedSidecarsRemoved: [],
      orphanedJournalsRemoved: [],
      migratedFiles: [],
      migratedRegistry: false,
    };

    // === LEGACY LAYOUT MIGRATION (OPFS only) ===
    // Check for legacy /sqlite-editor/ directory and migrate to new layout
    if (this.storageMode === 'opfs') {
      await this.migrateLegacyLayout(result);
    }

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

    // Get actual database files
    let actualFiles = await this.adapter.listFiles(this.storageMode);

    // === CASE COLLISION RESOLUTION (OPFS only) ===
    if (this.storageMode === 'opfs' && this.adapter.getFileLastModified && this.adapter.renameRawFile) {
      actualFiles = await this.resolveCaseCollisions(actualFiles, result);
    }

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
        console.log(
          `[DatabaseRegistry] Orphan DB detected: id="${entry.id}", name="${entry.name}" (no corresponding file found)`
        );
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

    // === ORPHANED SIDECAR AND JOURNAL CLEANUP (OPFS only) ===
    if (this.storageMode === 'opfs' && this.adapter.listAllFiles && this.adapter.deleteRawFile) {
      await this.cleanOrphanedFiles(actualFiles, result);
    }

    // Persist if any changes were made
    const hasChanges = result.wasCorrupted ||
      result.orphansRemoved.length > 0 ||
      result.discovered.length > 0 ||
      result.caseCollisionsResolved > 0 ||
      result.orphanedSidecarsRemoved.length > 0 ||
      result.orphanedJournalsRemoved.length > 0 ||
      result.migratedFiles.length > 0 ||
      result.migratedRegistry;

    if (hasChanges) {
      await this.save();
    }

    return result;
  }

  /**
   * Migrate legacy /sqlite-editor/ layout to new /wasm-sqlite-editor/databases/ layout.
   *
   * Migration logic:
   * 1. Check for legacy /sqlite-editor/ directory
   * 2. If found, copy files to new layout (preserving originals for rollback)
   * 3. Copy registry if new one doesn't exist
   * 4. Migration is idempotent - safe to re-run
   * 5. Old directory is NOT deleted (kept for one release cycle)
   */
  private async migrateLegacyLayout(result: HealingResult): Promise<void> {
    // Check if adapter supports migration
    if (!this.adapter.checkLegacyLayout || !this.adapter.listLegacyFiles || !this.adapter.copyLegacyFile) {
      console.log('[DatabaseRegistry] Migration: adapter does not support migration');
      return;
    }

    // Check if legacy directory exists
    const legacyExists = await this.adapter.checkLegacyLayout();
    console.log('[DatabaseRegistry] Migration: legacy layout exists =', legacyExists);
    if (!legacyExists) {
      return;
    }

    console.log('[DatabaseRegistry] Legacy layout detected at /sqlite-editor/, starting migration...');

    // Get list of files in legacy directory
    const legacyFiles = await this.adapter.listLegacyFiles();

    // Get list of files already in new location
    const existingFiles = new Set(await this.adapter.listFiles(this.storageMode));

    // Migrate each file if not already present
    for (const filename of legacyFiles) {
      if (existingFiles.has(filename)) {
        // File already migrated, skip
        continue;
      }

      try {
        await this.adapter.copyLegacyFile(filename);
        result.migratedFiles.push(filename);
        console.log(`[DatabaseRegistry] Migrated: ${filename}`);
      } catch (err) {
        console.warn(`[DatabaseRegistry] Failed to migrate "${filename}":`, err);
      }
    }

    // Migrate registry if new one doesn't exist
    if (this.adapter.readLegacyRegistry) {
      try {
        const newRegistry = await this.adapter.readRegistry(this.storageMode);
        if (!newRegistry) {
          const legacyRegistry = await this.adapter.readLegacyRegistry();
          if (legacyRegistry && Array.isArray(legacyRegistry.databases)) {
            await this.adapter.writeRegistry(this.storageMode, legacyRegistry);
            result.migratedRegistry = true;
            console.log('[DatabaseRegistry] Migrated registry.json');
          }
        }
      } catch (err) {
        console.warn('[DatabaseRegistry] Failed to migrate registry:', err);
      }
    }

    if (result.migratedFiles.length > 0 || result.migratedRegistry) {
      console.log(
        `[DatabaseRegistry] Migration complete: ${result.migratedFiles.length} files, ` +
        `registry: ${result.migratedRegistry ? 'yes' : 'no'}`
      );
    }
  }

  /**
   * Resolve case collisions among database files.
   * Groups files by lowercase name and renames all but the most recently modified
   * (or lexicographically first on tie) to include a "(conflict)" suffix.
   */
  private async resolveCaseCollisions(
    files: string[],
    result: HealingResult
  ): Promise<string[]> {
    // Group files by their lowercase name
    const groups = new Map<string, string[]>();
    for (const filename of files) {
      const key = filename.toLowerCase();
      const group = groups.get(key) ?? [];
      group.push(filename);
      groups.set(key, group);
    }

    const updatedFiles: string[] = [];

    for (const [, group] of groups) {
      if (group.length === 1) {
        // No collision
        updatedFiles.push(group[0]);
        continue;
      }

      // Get lastModified for each file
      const filesWithMtime: Array<{ filename: string; mtime: number }> = [];
      for (const filename of group) {
        const mtime = await this.adapter.getFileLastModified!(this.storageMode, filename);
        filesWithMtime.push({ filename, mtime });
      }

      // Sort: most recent first, then lexicographically first as tie-breaker
      filesWithMtime.sort((a, b) => {
        if (b.mtime !== a.mtime) {
          return b.mtime - a.mtime; // Most recent first
        }
        // Locale-independent byte-wise comparison for deterministic ordering
        return a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0;
      });

      // Keep the first one (winner), rename the rest
      const winner = filesWithMtime[0];
      updatedFiles.push(winner.filename);

      // Build set of already-used filenames (case-insensitive) for conflict checks
      const usedFilenames = new Set(files.map(f => f.toLowerCase()));
      for (const f of updatedFiles) {
        usedFilenames.add(f.toLowerCase());
      }

      for (let i = 1; i < filesWithMtime.length; i++) {
        const loser = filesWithMtime[i];
        // Generate conflict name: mydb.sqlite -> mydb (conflict-1).sqlite
        // Find a unique suffix to avoid overwriting existing files
        const baseName = loser.filename.replace(/\.sqlite$/, '');
        let conflictIndex = i;
        let conflictName = `${baseName} (conflict-${conflictIndex}).sqlite`;
        while (usedFilenames.has(conflictName.toLowerCase())) {
          conflictIndex++;
          conflictName = `${baseName} (conflict-${conflictIndex}).sqlite`;
        }

        try {
          await this.adapter.renameRawFile!(loser.filename, conflictName);
          updatedFiles.push(conflictName);
          usedFilenames.add(conflictName.toLowerCase());
          result.caseCollisionsResolved++;

          console.log(
            `[DatabaseRegistry] Case collision resolved: kept "${winner.filename}" (mtime: ${winner.mtime}), ` +
            `renamed "${loser.filename}" → "${conflictName}"`
          );
        } catch (err) {
          // If rename fails, keep original file in list
          updatedFiles.push(loser.filename);
          console.warn(
            `[DatabaseRegistry] Failed to resolve case collision for "${loser.filename}":`,
            err
          );
        }
      }
    }

    return updatedFiles;
  }

  /**
   * Clean orphaned sidecar and journal files.
   * Deletes .erd.json files and -wal/-shm/-journal files that don't have
   * a corresponding .sqlite file.
   */
  private async cleanOrphanedFiles(
    sqliteFiles: string[],
    result: HealingResult
  ): Promise<void> {
    const allFiles = await this.adapter.listAllFiles!();

    // Build a set of base names from sqlite files (case-insensitive)
    const sqliteBaseNames = new Set(
      sqliteFiles.map((f) => f.replace(/\.sqlite$/, '').toLowerCase())
    );

    for (const filename of allFiles) {
      // Check for orphaned .erd.json sidecars
      if (filename.endsWith('.erd.json')) {
        const baseName = filename.replace(/\.erd\.json$/, '').toLowerCase();
        if (!sqliteBaseNames.has(baseName)) {
          try {
            await this.adapter.deleteRawFile!(filename);
            result.orphanedSidecarsRemoved.push(filename);
          } catch (err) {
            console.warn(`[DatabaseRegistry] Failed to delete orphaned sidecar "${filename}":`, err);
          }
        }
        continue;
      }

      // Check for orphaned journal files (-wal, -shm, -journal)
      const journalSuffixes = ['-wal', '-shm', '-journal'];
      for (const suffix of journalSuffixes) {
        if (filename.endsWith(`.sqlite${suffix}`)) {
          const baseName = filename.replace(new RegExp(`\\.sqlite${suffix}$`), '').toLowerCase();
          if (!sqliteBaseNames.has(baseName)) {
            try {
              await this.adapter.deleteRawFile!(filename);
              result.orphanedJournalsRemoved.push(filename);
            } catch (err) {
              console.warn(`[DatabaseRegistry] Failed to delete orphaned journal "${filename}":`, err);
            }
          }
          break;
        }
      }
    }
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
   * Check if a database name is already registered (exact match)
   */
  hasDatabase(name: string): boolean {
    return this.data.databases.some((e) => e.name === name);
  }

  /**
   * Check if a database name exists (case-insensitive)
   * Per PRD: names are case-preserving but collision-checked case-insensitively
   *
   * @param name Database name to check
   * @returns true if a database with this name exists (ignoring case)
   */
  hasDatabaseCaseInsensitive(name: string): boolean {
    const lowerName = name.trim().toLowerCase();
    return this.data.databases.some((e) => e.name.toLowerCase() === lowerName);
  }

  /**
   * Get all database names for collision checking
   */
  getDatabaseNames(): string[] {
    return this.data.databases.map((e) => e.name);
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
   * Self-heal after file operation failures
   *
   * Call this method after operations that return warnings (e.g., deleteDatabase
   * with file deletion failure). It will attempt to clean up orphaned files
   * that couldn't be deleted previously.
   *
   * @returns HealingResult with cleanup details
   */
  async healFileOperationFailures(): Promise<HealingResult> {
    const result: HealingResult = {
      orphansRemoved: [],
      discovered: [],
      wasCorrupted: false,
      caseCollisionsResolved: 0,
      orphanedSidecarsRemoved: [],
      orphanedJournalsRemoved: [],
      migratedFiles: [],
      migratedRegistry: false,
    };

    // Only run on OPFS mode where file cleanup is applicable
    if (this.storageMode !== 'opfs' || !this.adapter.listAllFiles || !this.adapter.deleteRawFile) {
      return result;
    }

    // Get current registered database filenames
    const registeredFilenames = new Set(
      this.data.databases.map((e) => _testing.toFilename(e.name).toLowerCase())
    );

    // List all files and find orphans
    const allFiles = await this.adapter.listAllFiles();

    for (const filename of allFiles) {
      // Check for orphaned .sqlite files (file exists but not in registry)
      if (filename.endsWith('.sqlite')) {
        const lowerFilename = filename.toLowerCase();
        if (!registeredFilenames.has(lowerFilename)) {
          try {
            await this.adapter.deleteRawFile(filename);
            result.orphansRemoved.push(filename);
            console.log(
              `[DatabaseRegistry] Self-heal: deleted orphaned database file "${filename}"`
            );
          } catch (err) {
            console.warn(
              `[DatabaseRegistry] Self-heal: failed to delete orphaned file "${filename}":`,
              err
            );
          }
        }
        continue;
      }

      // Check for orphaned sidecars
      if (filename.endsWith('.erd.json')) {
        const baseName = filename.replace(/\.erd\.json$/, '').toLowerCase();
        const expectedSqlite = `${baseName}.sqlite`;
        if (!registeredFilenames.has(expectedSqlite)) {
          try {
            await this.adapter.deleteRawFile(filename);
            result.orphanedSidecarsRemoved.push(filename);
            console.log(
              `[DatabaseRegistry] Self-heal: deleted orphaned sidecar "${filename}"`
            );
          } catch (err) {
            console.warn(
              `[DatabaseRegistry] Self-heal: failed to delete orphaned sidecar "${filename}":`,
              err
            );
          }
        }
        continue;
      }

      // Check for orphaned journal files
      const journalSuffixes = ['-wal', '-shm', '-journal'];
      for (const suffix of journalSuffixes) {
        if (filename.endsWith(`.sqlite${suffix}`)) {
          const baseName = filename.replace(new RegExp(`\\.sqlite${suffix}$`), '').toLowerCase();
          const expectedSqlite = `${baseName}.sqlite`;
          if (!registeredFilenames.has(expectedSqlite)) {
            try {
              await this.adapter.deleteRawFile(filename);
              result.orphanedJournalsRemoved.push(filename);
              console.log(
                `[DatabaseRegistry] Self-heal: deleted orphaned journal "${filename}"`
              );
            } catch (err) {
              console.warn(
                `[DatabaseRegistry] Self-heal: failed to delete orphaned journal "${filename}":`,
                err
              );
            }
          }
          break;
        }
      }
    }

    return result;
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

  /**
   * Verify no WAL or SHM files exist for a database
   *
   * This verifies that journal_mode=DELETE is working correctly and no WAL-mode
   * files have been created. Per PRD requirements, OPFS mode should not create
   * WAL/SHM files.
   *
   * Note: This method only verifies - it does NOT clean up orphaned files.
   * Cleanup is owned by the self-healing mechanism (bd-lx0).
   *
   * @param name Database name to check
   * @returns Verification result with list of any WAL/SHM files found
   */
  async verifyNoWalFiles(name: string): Promise<WalVerificationResult> {
    // Find the entry
    const entry = this.data.databases.find((e) => e.name === name);
    if (!entry) {
      return {
        success: false,
        walFilesFound: [],
        error: 'Database not found',
      };
    }

    // IDB mode: WAL files are not applicable (snapshot-based storage)
    if (this.storageMode === 'idb' || entry.storageType === 'idb') {
      return {
        success: true,
        walFilesFound: [],
      };
    }

    // OPFS mode: Check for WAL/SHM files
    if (!this.adapter.listAllFiles) {
      return {
        success: true,
        walFilesFound: [],
        error: 'File listing not supported',
      };
    }

    const filename = toFilename(name);
    const allFiles = await this.adapter.listAllFiles();

    // WAL mode creates -wal and -shm files
    // DELETE mode uses -journal (which is acceptable)
    const walSuffixes = ['-wal', '-shm'];
    const walFilesFound: string[] = [];

    for (const file of allFiles) {
      for (const suffix of walSuffixes) {
        // Check if file matches: mydb.sqlite-wal or mydb.sqlite-shm
        if (file === `${filename}${suffix}`) {
          walFilesFound.push(file);
        }
      }
    }

    return {
      success: walFilesFound.length === 0,
      walFilesFound,
    };
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
 * Reset the singleton instance (for testing or storage reset)
 */
export function resetRegistry(): void {
  _registryInstance = null;
}

/**
 * Force reinitialize the registry by resetting singleton and re-initializing.
 * Use this after storage has been cleared externally.
 */
export async function forceReinitializeRegistry(): Promise<HealingResult> {
  _registryInstance = null;
  const registry = getRegistry();
  return registry.init();
}

// =============================================================================
// Exports for testing
// =============================================================================

export const _testing = {
  OPFS_DIR,
  LEGACY_OPFS_DIR,
  DATABASES_SUBDIR,
  OPFS_REGISTRY_PATH,
  IDB_REGISTRY_DB,
  IDB_REGISTRY_STORE,
  IDB_VERSION,
  MAX_NAME_LENGTH,
  WINDOWS_RESERVED_NAMES,
  PRD_ALLOWED_CHARS_REGEX,
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
  getOpfsFileLastModified,
  listOpfsAllFiles,
  deleteOpfsRawFile,
  renameOpfsRawFile,
  readIdbRegistry,
  writeIdbRegistry,
  listIdbDatabases,
  idbDatabaseExists,
  renameIdbDatabase,
  deleteIdbDatabase,
  defaultStorageAdapter,
  checkLegacyLayoutExists,
  readLegacyRegistry,
  listLegacyFiles,
  copyLegacyFile,
};
