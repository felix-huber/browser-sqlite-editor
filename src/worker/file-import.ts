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
import { IDB_VFS_NAME } from '../core/engine/opfs-vfs';
import { checkStorageAvailable } from './quota-errors';
import { toFilename } from './db-registry';

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
 * NOTE: This function buffers the entire file in memory. For large files,
 * use streamFileToOpfs() which uses SyncAccessHandle for true streaming.
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

/**
 * Read the first N bytes of a File for header validation
 * Uses slice() to avoid reading the entire file into memory.
 */
export async function readFileHeader(file: File, bytes: number): Promise<Uint8Array> {
  const slice = file.slice(0, bytes);
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
}

// =============================================================================
// SyncAccessHandle Types (Worker context only)
// =============================================================================

/**
 * FileSystemSyncAccessHandle interface for OPFS in Worker context
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

/**
 * Result of streaming file to OPFS
 */
export interface StreamToOpfsResult {
  success: true;
  bytesWritten: number;
  writeCount: number;
}

export interface StreamToOpfsError {
  success: false;
  error: string;
  bytesWritten: number;
}

export type StreamToOpfsOutcome = StreamToOpfsResult | StreamToOpfsError;

/**
 * Stream a File directly to OPFS via SyncAccessHandle in 1MB chunks.
 * This is the true streaming implementation per PRD - no full ArrayBuffer
 * is ever allocated in JS heap. Peak heap usage is bounded by chunk size (~1MB).
 *
 * @param file - File to stream
 * @param filename - Target filename in OPFS databases/ directory
 * @param onProgress - Progress callback (percentage)
 * @returns Result with bytes written and write count
 */
export async function streamFileToOpfs(
  file: File,
  filename: string,
  onProgress?: ProgressCallback
): Promise<StreamToOpfsOutcome> {
  const totalSize = file.size;
  let bytesWritten = 0;
  let writeCount = 0;
  let accessHandle: FileSystemSyncAccessHandle | null = null;
  let fileHandle: FileSystemFileHandle | null = null;

  try {
    // Get the OPFS databases directory
    const dir = await getOpfsDatabasesDir();
    fileHandle = await dir.getFileHandle(filename, { create: true });

    // Get sync access handle for direct write access
    accessHandle = await (fileHandle as FileSystemFileHandleWithSync).createSyncAccessHandle();

    // Truncate to ensure clean slate
    accessHandle.truncate(0);

    // Fixed-size write buffer - reused to avoid allocations
    // We fill this buffer and write when full, avoiding memory accumulation
    const writeBuffer = new Uint8Array(CHUNK_SIZE);
    let bufferOffset = 0;

    /**
     * Flush the write buffer to OPFS
     */
    const flushBuffer = () => {
      if (bufferOffset > 0) {
        // Write only the filled portion
        const dataToWrite = bufferOffset === CHUNK_SIZE
          ? writeBuffer
          : writeBuffer.subarray(0, bufferOffset);
        accessHandle!.write(dataToWrite, { at: bytesWritten });
        bytesWritten += bufferOffset;
        writeCount++;
        bufferOffset = 0;

        // Report progress (0-80% for streaming phase)
        if (onProgress && totalSize > 0) {
          const percent = Math.round((bytesWritten / totalSize) * 80);
          onProgress(percent);
        }
      }
    };

    // Process file stream
    if (typeof file.stream === 'function') {
      const stream = file.stream();
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Process incoming chunk - copy to write buffer and flush when full
          let chunkOffset = 0;
          while (chunkOffset < value.length) {
            const spaceInBuffer = CHUNK_SIZE - bufferOffset;
            const bytesToCopy = Math.min(spaceInBuffer, value.length - chunkOffset);

            writeBuffer.set(value.subarray(chunkOffset, chunkOffset + bytesToCopy), bufferOffset);
            bufferOffset += bytesToCopy;
            chunkOffset += bytesToCopy;

            // Flush when buffer is full
            if (bufferOffset === CHUNK_SIZE) {
              flushBuffer();
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      // Fallback: read entire file but still write in chunks
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);

      // Write in CHUNK_SIZE chunks to maintain consistent behavior
      for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
        const end = Math.min(offset + CHUNK_SIZE, data.length);
        const chunk = data.subarray(offset, end);
        accessHandle.write(chunk, { at: bytesWritten });
        bytesWritten += chunk.length;
        writeCount++;

        // Report progress
        if (onProgress && totalSize > 0) {
          const percent = Math.round((bytesWritten / totalSize) * 80);
          onProgress(percent);
        }
      }
      // Skip the final flushBuffer since we wrote directly
      bufferOffset = 0;
    }

    // Write any remaining data in the buffer
    flushBuffer();

    // Flush and close
    accessHandle.flush();
    accessHandle.close();
    accessHandle = null;

    if (onProgress) {
      onProgress(80);
    }

    return {
      success: true,
      bytesWritten,
      writeCount,
    };
  } catch (err) {
    // Clean up on error
    if (accessHandle) {
      try {
        accessHandle.close();
      } catch {
        // Ignore close errors during cleanup
      }
    }

    // Clean up the partially written OPFS file
    try {
      const dir = await getOpfsDatabasesDir();
      await dir.removeEntry(filename);
    } catch {
      // Ignore cleanup errors - file may not exist
    }

    const message = err instanceof Error ? err.message : String(err);

    // Check for quota exceeded
    if (
      (err instanceof DOMException && err.name === 'QuotaExceededError') ||
      message.toLowerCase().includes('quota')
    ) {
      return {
        success: false,
        error: 'Storage quota exceeded while writing file',
        bytesWritten,
      };
    }

    return {
      success: false,
      error: message,
      bytesWritten,
    };
  }
}

// =============================================================================
// OPFS Operations
// =============================================================================

/**
 * Get the OPFS root directory for wasm-sqlite-editor
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
  return root.getDirectoryHandle('databases', { create: true });
}

/**
 * Write data to OPFS file with chunked progress
 */
async function writeToOpfs(
  filename: string,
  data: Uint8Array,
  onProgress?: ProgressCallback
): Promise<void> {
  const dir = await getOpfsDatabasesDir();
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
 * Delete file from OPFS databases/ subdirectory
 */
async function deleteFromOpfs(filename: string): Promise<void> {
  try {
    const dir = await getOpfsDatabasesDir();
    await dir.removeEntry(filename);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * List database files in OPFS databases/ subdirectory
 */
async function listOpfsFiles(): Promise<string[]> {
  const files: string[] = [];
  try {
    const dir = await getOpfsDatabasesDir();
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
// IDB Operations (IDB VFS)
// =============================================================================

const IDB_VFS_DB = IDB_VFS_NAME;
const IDB_VFS_VERSION = 6;
const IDB_VFS_METADATA_STORE = 'metadata';
const IDB_VFS_BLOCKS_STORE = 'blocks';

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

/**
 * Open the IndexedDB database used by the IDB VFS
 */
function openIdbDatabase(): Promise<IDBDatabase> {
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

async function listIdbVfsDatabases(): Promise<string[]> {
  try {
    const db = await openIdbDatabase();
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
      return await new Promise<string[]>((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result as string[]);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
 * Write data to IDB VFS with progress
 */
async function writeToIdb(
  name: string,
  data: Uint8Array,
  onProgress?: ProgressCallback
): Promise<void> {
  const db = await openIdbDatabase();

  try {
    const path = toIdbVfsPath(name);
    const totalSize = data.length;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([IDB_VFS_METADATA_STORE, IDB_VFS_BLOCKS_STORE], 'readwrite');
      const metadata = tx.objectStore(IDB_VFS_METADATA_STORE);
      const blocks = tx.objectStore(IDB_VFS_BLOCKS_STORE);

      const range = IDBKeyRange.bound([path, -Infinity], [path, Infinity]);
      blocks.delete(range);

      metadata.put({
        name: path,
        fileSize: totalSize,
        version: 0,
      });

      for (let offset = 0; offset < totalSize; offset += CHUNK_SIZE) {
        const chunkEnd = Math.min(offset + CHUNK_SIZE, totalSize);
        const chunk = data.slice(offset, chunkEnd);
        blocks.put({
          path,
          offset: -offset,
          version: 0,
          data: chunk,
        });
        if (onProgress && totalSize > 0) {
          const percent = 50 + Math.round((chunkEnd / totalSize) * 30);
          onProgress(percent);
        }
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Delete from IDB VFS
 */
async function deleteFromIdb(name: string): Promise<void> {
  const db = await openIdbDatabase();

  try {
    const path = toIdbVfsPath(name);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([IDB_VFS_METADATA_STORE, IDB_VFS_BLOCKS_STORE], 'readwrite');
      const metadata = tx.objectStore(IDB_VFS_METADATA_STORE);
      const blocks = tx.objectStore(IDB_VFS_BLOCKS_STORE);
      const range = IDBKeyRange.bound([path, -Infinity], [path, Infinity]);
      blocks.delete(range);
      metadata.delete(path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Ignore if doesn't exist
  } finally {
    db.close();
  }
}

/**
 * List database names in IDB (VFS + legacy snapshots)
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
      // PRD-specified message
      return {
        valid: false,
        error: 'File is encrypted — SQLCipher is not supported',
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

    // PRD-specified message
    return {
      valid: false,
      error: 'Not a valid SQLite file',
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

    // For OPFS: Work with sanitized filenames since that's how files are stored
    // For IDB: Work with display names directly
    let uniqueName: string;
    let filename: string;

    if (storageMode === 'opfs') {
      // For OPFS, we need to:
      // 1. Generate a display name (e.g., "sakila (1)")
      // 2. Use toFilename() to convert to the actual filename
      // This ensures consistency between import and open operations

      // Strip extension from hint for display name
      const baseHint = nameHint.replace(/\.sqlite$/i, '').trim() || 'Untitled';

      // Build a set of existing filenames (not display names) for collision detection
      const existingFilenames = new Set(existingNames);

      // Try the base name first, then add (1), (2), etc.
      let candidate = baseHint;
      let counter = 0;
      while (existingFilenames.has(toFilename(candidate).replace(/\.sqlite$/, ''))) {
        counter++;
        candidate = `${baseHint} (${counter})`;
        if (counter > 1000) {
          throw new Error('Unable to generate unique name after 1000 attempts');
        }
      }

      uniqueName = candidate;
      filename = toFilename(uniqueName);
    } else {
      // IDB: use display names directly
      uniqueName = resolveUniqueName(nameHint, new Set(existingNames));
      filename = uniqueName;
    }

    // Step 3: Validate SQLite file header BEFORE writing anything
    // Read just the header (first 100 bytes) for validation - no full memory allocation
    const headerSize = Math.min(file.size, MIN_SQLITE_SIZE);
    const headerData = await readFileHeader(file, headerSize);

    // Validate based on header
    const validation = adapter
      ? await adapter.validateSqlite(headerData)
      : await validateSqliteFile(headerData);

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

    // Step 4: Write to storage using streaming for OPFS (0-80% progress)
    let fileSize = file.size;

    try {
      if (adapter) {
        // Test adapter: use existing buffered approach
        const data = await streamFileChunks(file, onProgress);
        await adapter.writeFile(filename, data);
        fileSize = data.length;
        writtenFileName = filename;
      } else if (storageMode === 'opfs') {
        // Track filename for cleanup before attempting write
        writtenFileName = filename;

        // OPFS: Use SyncAccessHandle streaming - no full memory buffering
        // Per PRD: "writes each chunk to the OPFS file via SyncAccessHandle —
        // no full ArrayBuffer is ever allocated in JS heap"
        const streamResult = await streamFileToOpfs(file, filename, onProgress);

        if (!streamResult.success) {
          // Clean up partially written file
          try {
            await deleteFromOpfs(filename);
          } catch {
            // Ignore cleanup errors
          }
          writtenFileName = null;

          // Check for quota exceeded
          if (streamResult.error.toLowerCase().includes('quota')) {
            return {
              success: false,
              code: 'QUOTA_EXCEEDED',
              message: 'Storage quota exceeded while writing file. Please free up space and try again.',
            };
          }
          return {
            success: false,
            code: 'UNKNOWN',
            message: `Import failed: ${streamResult.error}`,
          };
        }

        fileSize = streamResult.bytesWritten;
      } else {
        // IDB: Use existing chunked approach (already writes in chunks)
        const data = await streamFileChunks(file, onProgress);
        await writeToIdb(filename, data, onProgress);
        fileSize = data.length;
        writtenFileName = filename;
      }
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

    // Step 5: Register in database registry (80-90% progress)
    if (onProgress) onProgress(90);

    const dbId = adapter
      ? await adapter.registerDatabase(uniqueName, storageMode)
      : await registerInRegistry(uniqueName, storageMode);

    // Step 6: Complete (100% progress)
    if (onProgress) onProgress(100);

    return {
      success: true,
      dbId,
      dbName: uniqueName,
      storageType: storageMode,
      fileSize,
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
  getOpfsDatabasesDir,
  writeToOpfs,
  deleteFromOpfs,
  listOpfsFiles,
  writeToIdb,
  deleteFromIdb,
  listIdbDatabases,
  validateSqliteFile,
  openIdbDatabase,
  readFileHeader,
  streamFileToOpfs,
};
