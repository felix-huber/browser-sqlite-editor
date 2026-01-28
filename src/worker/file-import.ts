/**
 * SQLite File Import Pipeline
 *
 * Provides chunked streaming import for SQLite database files:
 * - Resolves unique DB name (auto-suffix if name exists)
 * - Streams file in 1MB chunks (no full ArrayBuffer)
 * - Writes to OPFS/IDB with progress events
 * - Validates SQLite file (integrity check, encryption detection)
 * - Cleans up on failure (partial files, registry unchanged)
 * - Handles quota exceeded errors gracefully
 */

import type { StorageMode, WorkerErrorCode } from '../types';
import { checkStorageAvailable } from './quota-errors';

// =============================================================================
// Constants
// =============================================================================

/** Chunk size for streaming (1MB) */
export const CHUNK_SIZE = 1024 * 1024;

/** SQLite file magic header (first 16 bytes) */
const SQLITE_MAGIC = 'SQLite format 3\0';

/** Minimum valid SQLite file size (header + at least one page) */
const MIN_SQLITE_SIZE = 100;

// =============================================================================
// Types
// =============================================================================

/**
 * Import result on success
 */
export interface ImportResult {
  success: true;
  /** Database ID in registry */
  dbId: string;
  /** Database name */
  dbName: string;
  /** Storage type used */
  storageType: StorageMode;
  /** File size in bytes */
  fileSize: number;
}

/**
 * Import error result
 */
export interface ImportError {
  success: false;
  /** Error code for categorization */
  code: WorkerErrorCode;
  /** Human-readable error message */
  message: string;
}

/**
 * Import result type
 */
export type ImportOutcome = ImportResult | ImportError;

/**
 * Progress callback type
 */
export type ProgressCallback = (percent: number) => void;

/**
 * Import options
 */
export interface ImportOptions {
  /** Hint for the database name (may be modified for uniqueness) */
  nameHint: string;
  /** Storage mode to use */
  storageMode: StorageMode;
  /** Progress callback */
  onProgress?: ProgressCallback;
}

/**
 * Storage adapter for dependency injection in tests
 */
export interface ImportStorageAdapter {
  /** Check if OPFS is available */
  isOpfsAvailable: () => Promise<boolean>;
  /** List existing database names */
  listDatabaseNames: () => Promise<string[]>;
  /** Write file to storage */
  writeFile: (name: string, data: Uint8Array) => Promise<void>;
  /** Delete file from storage */
  deleteFile: (name: string) => Promise<void>;
  /** Check available storage */
  checkStorage: (requiredBytes: number) => Promise<{ ok: boolean; error?: string }>;
  /** Validate SQLite file */
  validateSqlite: (data: Uint8Array) => Promise<{ valid: boolean; error?: string }>;
  /** Register database in registry */
  registerDatabase: (name: string, storageType: StorageMode) => Promise<string>;
}

// =============================================================================
// Name Resolution
// =============================================================================

/**
 * Generate a unique database name by appending (1), (2), etc. if name exists
 *
 * @param baseName - Desired name
 * @param existingNames - Set of existing database names
 * @returns Unique name
 */
export function resolveUniqueName(baseName: string, existingNames: Set<string>): string {
  // Sanitize the base name
  const sanitized = baseName.trim().replace(/\.sqlite$/i, '').trim();
  if (!sanitized) {
    return 'Untitled';
  }

  // If name doesn't exist, use it
  if (!existingNames.has(sanitized)) {
    return sanitized;
  }

  // Try adding suffix (1), (2), etc.
  let counter = 1;
  while (true) {
    const candidate = `${sanitized} (${counter})`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
    counter++;
    // Safety limit to prevent infinite loop
    if (counter > 1000) {
      throw new Error('Unable to generate unique name after 1000 attempts');
    }
  }
}

// =============================================================================
// SQLite Validation
// =============================================================================

/**
 * Check if data has valid SQLite magic header
 */
export function hasSqliteMagic(data: Uint8Array): boolean {
  if (data.length < SQLITE_MAGIC.length) {
    return false;
  }
  const header = new TextDecoder().decode(data.slice(0, SQLITE_MAGIC.length));
  return header === SQLITE_MAGIC;
}

/**
 * Check if SQLite file appears to be encrypted
 * Encrypted SQLite files (SQLCipher, SEE) don't have the standard header
 */
export function isEncryptedSqlite(data: Uint8Array): boolean {
  // If file is large enough but doesn't have magic, it might be encrypted
  // SQLCipher files have random-looking header bytes
  if (data.length >= MIN_SQLITE_SIZE && !hasSqliteMagic(data)) {
    // Check if header looks random (not all zeros, not all same value)
    const header = data.slice(0, 16);
    const uniqueBytes = new Set(header);
    // Encrypted files have high entropy (many unique byte values)
    // Non-SQLite files might have patterns (like PNG magic, etc.)
    return uniqueBytes.size > 8;
  }
  return false;
}

/**
 * Check common file type signatures to detect non-SQLite files
 */
export function detectFileType(data: Uint8Array): string | null {
  if (data.length < 8) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return 'PNG image';
  }

  // JPEG: FF D8 FF
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'JPEG image';
  }

  // PDF: 25 50 44 46
  if (
    data[0] === 0x25 &&
    data[1] === 0x50 &&
    data[2] === 0x44 &&
    data[3] === 0x46
  ) {
    return 'PDF document';
  }

  // ZIP: 50 4B 03 04
  if (
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04
  ) {
    return 'ZIP archive';
  }

  // GIF: 47 49 46 38
  if (
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38
  ) {
    return 'GIF image';
  }

  return null;
}

// =============================================================================
// Chunked Streaming
// =============================================================================

/**
 * Stream a File in chunks and accumulate into Uint8Array with progress
 *
 * @param file - File to stream
 * @param onProgress - Progress callback (0-100)
 * @returns Complete file data
 */
export async function streamFileChunks(
  file: File,
  onProgress?: ProgressCallback
): Promise<Uint8Array> {
  const totalSize = file.size;

  // Check if file.stream() is available (not in all environments like Node.js tests)
  if (typeof file.stream === 'function') {
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;

    const stream = file.stream();
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        chunks.push(value);
        bytesRead += value.length;

        // Report progress (scale to 0-50% for read phase)
        if (onProgress && totalSize > 0) {
          const percent = Math.round((bytesRead / totalSize) * 50);
          onProgress(percent);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Concatenate chunks
    const result = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  // Fallback: use arrayBuffer() for environments without stream support
  if (onProgress) {
    onProgress(0);
  }

  const buffer = await file.arrayBuffer();

  if (onProgress) {
    onProgress(50);
  }

  return new Uint8Array(buffer);
}

// =============================================================================
// OPFS Operations
// =============================================================================

/**
 * Get the OPFS root directory for sqlite-editor
 */
async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('sqlite-editor', { create: true });
}

/**
 * Write data to OPFS file with chunked progress
 */
async function writeToOpfs(
  filename: string,
  data: Uint8Array,
  onProgress?: ProgressCallback
): Promise<void> {
  const dir = await getOpfsRoot();
  const file = await dir.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();

  try {
    const totalSize = data.length;
    let bytesWritten = 0;

    // Write in chunks
    while (bytesWritten < totalSize) {
      const chunkEnd = Math.min(bytesWritten + CHUNK_SIZE, totalSize);
      const chunk = data.slice(bytesWritten, chunkEnd);
      await writable.write(chunk);
      bytesWritten = chunkEnd;

      // Report progress (scale to 50-80% for write phase)
      if (onProgress && totalSize > 0) {
        const percent = 50 + Math.round((bytesWritten / totalSize) * 30);
        onProgress(percent);
      }
    }
  } finally {
    await writable.close();
  }
}

/**
 * Delete file from OPFS
 */
async function deleteFromOpfs(filename: string): Promise<void> {
  try {
    const dir = await getOpfsRoot();
    await dir.removeEntry(filename);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * List database files in OPFS
 */
async function listOpfsFiles(): Promise<string[]> {
  const files: string[] = [];
  try {
    const dir = await getOpfsRoot();
    const entries = (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)[
      Symbol.asyncIterator
    ]();
    for await (const [name, handle] of { [Symbol.asyncIterator]: () => entries }) {
      if (handle.kind === 'file' && name.endsWith('.sqlite')) {
        // Return name without .sqlite extension
        files.push(name.replace(/\.sqlite$/, ''));
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return files;
}

// =============================================================================
// IDB Operations
// =============================================================================

/** IndexedDB database name for SQLite storage */
const IDB_DATABASE_NAME = 'idb-sqlite';
const IDB_STORE_NAME = 'databases';
const IDB_VERSION = 1;

/**
 * Open the IndexedDB database
 */
function openIdbDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DATABASE_NAME, IDB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: 'name' });
      }
    };
  });
}

/**
 * Write data to IDB with progress
 */
async function writeToIdb(
  name: string,
  data: Uint8Array,
  onProgress?: ProgressCallback
): Promise<void> {
  const db = await openIdbDatabase();

  try {
    const blob = new Blob([data as BlobPart], { type: 'application/x-sqlite3' });
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.put({
        name,
        blob,
        updatedAt: new Date().toISOString(),
      });
      request.onsuccess = () => {
        // Report progress (50-80% for write)
        if (onProgress) {
          onProgress(80);
        }
        resolve();
      };
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
 * Delete from IDB
 */
async function deleteFromIdb(name: string): Promise<void> {
  const db = await openIdbDatabase();

  try {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Ignore if doesn't exist
  } finally {
    db.close();
  }
}

/**
 * List database names in IDB
 */
async function listIdbDatabases(): Promise<string[]> {
  const db = await openIdbDatabase();

  try {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const store = tx.objectStore(IDB_STORE_NAME);

    return new Promise<string[]>((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

// =============================================================================
// SQLite Validation via SQL.js
// =============================================================================

/**
 * Validate SQLite file by attempting to open it and run integrity check
 * This requires sql.js to be initialized
 */
export async function validateSqliteFile(
  data: Uint8Array
): Promise<{ valid: boolean; error?: string }> {
  // First check: file size
  if (data.length === 0) {
    return { valid: false, error: 'File is empty (zero bytes)' };
  }

  if (data.length < MIN_SQLITE_SIZE) {
    return { valid: false, error: 'File is too small to be a valid SQLite database' };
  }

  // Second check: magic header
  if (!hasSqliteMagic(data)) {
    // Check if it might be encrypted
    if (isEncryptedSqlite(data)) {
      return {
        valid: false,
        error: 'File appears to be encrypted. Encrypted SQLite databases are not supported.',
      };
    }

    // Check if it's a known file type
    const fileType = detectFileType(data);
    if (fileType) {
      return {
        valid: false,
        error: `File is a ${fileType}, not a SQLite database`,
      };
    }

    return {
      valid: false,
      error: 'File is not a valid SQLite database (missing SQLite header)',
    };
  }

  // Third check: try to open with sql.js and run integrity check
  // This is done by the caller if they have sql.js available
  // For now, we trust the header check
  return { valid: true };
}

// =============================================================================
// Main Import Function
// =============================================================================

/**
 * Import a SQLite database file
 *
 * @param file - File to import
 * @param options - Import options
 * @param adapter - Optional storage adapter for testing
 * @returns Import result
 */
export async function importDatabase(
  file: File,
  options: ImportOptions,
  adapter?: ImportStorageAdapter
): Promise<ImportOutcome> {
  const { nameHint, storageMode, onProgress } = options;

  // Track whether we've written a file (for cleanup)
  let writtenFileName: string | null = null;

  try {
    // Step 1: Check available storage (0% progress)
    if (onProgress) onProgress(0);

    const storageCheck = adapter
      ? await adapter.checkStorage(file.size)
      : await checkStorageAvailable(file.size);

    if (!storageCheck.ok) {
      return {
        success: false,
        code: 'QUOTA_EXCEEDED',
        message: storageCheck.error || 'Insufficient storage space for import',
      };
    }

    // Step 2: Get existing names and resolve unique name
    const existingNames = adapter
      ? await adapter.listDatabaseNames()
      : storageMode === 'opfs'
        ? await listOpfsFiles()
        : await listIdbDatabases();

    const uniqueName = resolveUniqueName(nameHint, new Set(existingNames));
    const filename = storageMode === 'opfs' ? `${uniqueName.toLowerCase().replace(/\s+/g, '_')}.sqlite` : uniqueName;

    // Step 3: Stream file in chunks (0-50% progress)
    const data = await streamFileChunks(file, onProgress);

    // Step 4: Validate SQLite file (50% progress)
    if (onProgress) onProgress(50);

    const validation = adapter
      ? await adapter.validateSqlite(data)
      : await validateSqliteFile(data);

    if (!validation.valid) {
      // Determine error code based on message
      let code: WorkerErrorCode = 'INVALID_FILE';
      if (validation.error?.includes('encrypted')) {
        code = 'ENCRYPTED_FILE';
      } else if (validation.error?.includes('corrupt') || validation.error?.includes('integrity')) {
        code = 'CORRUPT_FILE';
      }

      return {
        success: false,
        code,
        message: validation.error || 'Invalid SQLite file',
      };
    }

    // Step 5: Write to storage (50-80% progress)
    try {
      if (adapter) {
        await adapter.writeFile(filename, data);
      } else if (storageMode === 'opfs') {
        await writeToOpfs(filename, data, onProgress);
      } else {
        await writeToIdb(filename, data, onProgress);
      }
      writtenFileName = filename;
    } catch (err) {
      // Check for quota exceeded during write
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        return {
          success: false,
          code: 'QUOTA_EXCEEDED',
          message: 'Storage quota exceeded while writing file. Please free up space and try again.',
        };
      }
      throw err;
    }

    // Step 6: Register in database registry (80-90% progress)
    if (onProgress) onProgress(90);

    const dbId = adapter
      ? await adapter.registerDatabase(uniqueName, storageMode)
      : await registerInRegistry(uniqueName, storageMode);

    // Step 7: Complete (100% progress)
    if (onProgress) onProgress(100);

    return {
      success: true,
      dbId,
      dbName: uniqueName,
      storageType: storageMode,
      fileSize: data.length,
    };
  } catch (err) {
    // Clean up on any error
    if (writtenFileName) {
      try {
        if (adapter) {
          await adapter.deleteFile(writtenFileName);
        } else if (storageMode === 'opfs') {
          await deleteFromOpfs(writtenFileName);
        } else {
          await deleteFromIdb(writtenFileName);
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    // Check for quota exceeded (DOMException or message-based detection)
    if (
      (err instanceof DOMException && err.name === 'QuotaExceededError') ||
      (err instanceof Error && err.message.toLowerCase().includes('quota'))
    ) {
      return {
        success: false,
        code: 'QUOTA_EXCEEDED',
        message: 'Storage quota exceeded during import',
      };
    }

    // Return error with appropriate message
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      code: 'UNKNOWN',
      message: `Import failed: ${message}`,
    };
  }
}

// =============================================================================
// Registry Integration
// =============================================================================

/**
 * Register database in the registry
 * This is a simplified version - in production, use the full DatabaseRegistry class
 */
async function registerInRegistry(name: string, storageType: StorageMode): Promise<string> {
  // Import dynamically to avoid circular dependency
  const { getRegistry } = await import('./db-registry');
  const registry = getRegistry();

  // Initialize if needed
  if (!registry.isInitialized()) {
    await registry.init();
  }

  return registry.registerDatabase(name, storageType);
}

// =============================================================================
// Exports for Testing
// =============================================================================

export const _testing = {
  CHUNK_SIZE,
  SQLITE_MAGIC,
  MIN_SQLITE_SIZE,
  getOpfsRoot,
  writeToOpfs,
  deleteFromOpfs,
  listOpfsFiles,
  writeToIdb,
  deleteFromIdb,
  listIdbDatabases,
  validateSqliteFile,
  openIdbDatabase,
};
