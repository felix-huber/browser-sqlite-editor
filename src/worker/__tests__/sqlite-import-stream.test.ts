/**
 * Unit tests for SQLite streaming import via SyncAccessHandle
 *
 * Tests cover:
 * - 1MB chunk streaming (no full memory buffering)
 * - Write count assertions for chunk-based writes
 * - Progress events during streaming
 * - Error handling and cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamFileToOpfs, CHUNK_SIZE } from '../file-import';

// =============================================================================
// Mock Setup for OPFS SyncAccessHandle
// =============================================================================

interface MockSyncAccessHandle {
  write: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  truncate: ReturnType<typeof vi.fn>;
  getSize: ReturnType<typeof vi.fn>;
}

interface WriteCall {
  data: Uint8Array;
  offset: number;
}

let mockAccessHandle: MockSyncAccessHandle;
let writeHistory: WriteCall[];
let mockFileHandle: { createSyncAccessHandle: ReturnType<typeof vi.fn> };
let mockDirHandle: { getFileHandle: ReturnType<typeof vi.fn> };
let shouldFailOnWrite = false;
let failAfterBytes = Infinity;
let bytesWrittenBeforeError = 0;

// Mock navigator.storage.getDirectory
const originalNavigator = global.navigator;

beforeEach(() => {
  writeHistory = [];
  bytesWrittenBeforeError = 0;
  shouldFailOnWrite = false;
  failAfterBytes = Infinity;

  mockAccessHandle = {
    write: vi.fn((buffer: Uint8Array, options?: { at?: number }) => {
      const offset = options?.at ?? 0;
      bytesWrittenBeforeError += buffer.byteLength;

      if (shouldFailOnWrite || bytesWrittenBeforeError > failAfterBytes) {
        const error = new DOMException('Quota exceeded', 'QuotaExceededError');
        throw error;
      }

      writeHistory.push({
        data: new Uint8Array(buffer),
        offset,
      });
      return buffer.byteLength;
    }),
    flush: vi.fn(),
    close: vi.fn(),
    truncate: vi.fn(),
    getSize: vi.fn(() => writeHistory.reduce((sum, w) => sum + w.data.byteLength, 0)),
  };

  mockFileHandle = {
    createSyncAccessHandle: vi.fn().mockResolvedValue(mockAccessHandle),
  };

  mockDirHandle = {
    getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
    removeEntry: vi.fn().mockResolvedValue(undefined),
  };

  // Create nested directory structure to mimic:
  // getDirectory() -> root -> getDirectoryHandle('wasm-sqlite-editor') -> app dir
  // -> getDirectoryHandle('databases') -> databases dir
  const mockAppDirHandle = {
    getDirectoryHandle: vi.fn().mockResolvedValue(mockDirHandle), // returns databases dir
  };

  const mockRootDirHandle = {
    getDirectoryHandle: vi.fn().mockResolvedValue(mockAppDirHandle), // returns app dir
  };

  // Mock navigator.storage.getDirectory
  Object.defineProperty(global, 'navigator', {
    value: {
      ...originalNavigator,
      storage: {
        getDirectory: vi.fn().mockResolvedValue(mockRootDirHandle),
      },
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(global, 'navigator', {
    value: originalNavigator,
    writable: true,
    configurable: true,
  });
  vi.restoreAllMocks();
});

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a valid SQLite file header
 */
function createSqliteHeader(size = 4096): Uint8Array {
  const data = new Uint8Array(size);
  const magic = 'SQLite format 3\0';
  for (let i = 0; i < magic.length; i++) {
    data[i] = magic.charCodeAt(i);
  }
  // Set page size (bytes 16-17) to 4096
  data[16] = 0x10;
  data[17] = 0x00;
  return data;
}

/**
 * Create a mock File with streaming support
 */
function createMockFile(data: Uint8Array, name = 'test.sqlite'): File {
  // Create a File that supports .stream() with configurable chunk size
  const blob = new Blob([data]);

  // Create a custom File-like object with stream() support
  const mockFile = {
    name,
    size: data.length,
    type: 'application/x-sqlite3',
    lastModified: Date.now(),
    arrayBuffer: () => Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
    slice: (start?: number, end?: number) => blob.slice(start, end),
    text: () => Promise.resolve(new TextDecoder().decode(data)),
    stream: () => {
      // Return a ReadableStream that yields chunks
      let offset = 0;
      const chunkSize = 64 * 1024; // 64KB chunks to simulate browser behavior

      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= data.length) {
            controller.close();
            return;
          }
          const end = Math.min(offset + chunkSize, data.length);
          const chunk = data.slice(offset, end);
          offset = end;
          controller.enqueue(chunk);
        },
      });
    },
  } as unknown as File;

  return mockFile;
}

// =============================================================================
// Tests for streamFileToOpfs
// =============================================================================

describe('streamFileToOpfs', () => {
  describe('chunk-based writes', () => {
    it('writes N chunks for N MB file', async () => {
      // 3MB file should result in 3 write calls
      const fileSize = 3 * CHUNK_SIZE;
      const data = createSqliteHeader(fileSize);
      const mockFile = createMockFile(data);

      const result = await streamFileToOpfs(mockFile, 'test.sqlite');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.writeCount).toBe(3);
        expect(result.bytesWritten).toBe(fileSize);
      }

      // Verify actual writes occurred
      expect(mockAccessHandle.write).toHaveBeenCalledTimes(3);
      expect(mockAccessHandle.truncate).toHaveBeenCalledWith(0);
      expect(mockAccessHandle.flush).toHaveBeenCalled();
      expect(mockAccessHandle.close).toHaveBeenCalled();
    });

    it('handles partial final chunk', async () => {
      // 2.5MB file should result in 3 write calls (1MB, 1MB, 0.5MB)
      const fileSize = Math.floor(2.5 * CHUNK_SIZE);
      const data = createSqliteHeader(fileSize);
      const mockFile = createMockFile(data);

      const result = await streamFileToOpfs(mockFile, 'test.sqlite');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.writeCount).toBe(3);
        expect(result.bytesWritten).toBe(fileSize);
      }

      // Verify chunk sizes
      expect(writeHistory[0].data.byteLength).toBe(CHUNK_SIZE);
      expect(writeHistory[1].data.byteLength).toBe(CHUNK_SIZE);
      expect(writeHistory[2].data.byteLength).toBe(fileSize - 2 * CHUNK_SIZE);
    });

    it('writes single chunk for small file', async () => {
      const fileSize = 4096; // 4KB
      const data = createSqliteHeader(fileSize);
      const mockFile = createMockFile(data);

      const result = await streamFileToOpfs(mockFile, 'test.sqlite');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.writeCount).toBe(1);
        expect(result.bytesWritten).toBe(fileSize);
      }

      expect(writeHistory[0].data.byteLength).toBe(fileSize);
    });

    it('writes at correct offsets', async () => {
      const fileSize = 3 * CHUNK_SIZE;
      const data = createSqliteHeader(fileSize);
      const mockFile = createMockFile(data);

      await streamFileToOpfs(mockFile, 'test.sqlite');

      // Verify offsets
      expect(writeHistory[0].offset).toBe(0);
      expect(writeHistory[1].offset).toBe(CHUNK_SIZE);
      expect(writeHistory[2].offset).toBe(2 * CHUNK_SIZE);
    });
  });

  describe('progress reporting', () => {
    it('reports progress at each chunk boundary', async () => {
      const fileSize = 4 * CHUNK_SIZE;
      const data = createSqliteHeader(fileSize);
      const mockFile = createMockFile(data);
      const progressValues: number[] = [];

      await streamFileToOpfs(mockFile, 'test.sqlite', (p) => progressValues.push(p));

      // Should have progress updates during write (0-80% range per implementation)
      expect(progressValues.length).toBeGreaterThan(0);
      // Final progress should be 80% (validation/registry happens after)
      expect(progressValues[progressValues.length - 1]).toBe(80);
    });

    it('reports 0% progress for empty callback', async () => {
      const fileSize = CHUNK_SIZE;
      const data = createSqliteHeader(fileSize);
      const mockFile = createMockFile(data);

      // Should not throw without progress callback
      const result = await streamFileToOpfs(mockFile, 'test.sqlite');
      expect(result.success).toBe(true);
    });
  });

  describe('error handling and cleanup', () => {
    it('returns error and closes handle on quota exceeded', async () => {
      shouldFailOnWrite = true;
      const data = createSqliteHeader(4096);
      const mockFile = createMockFile(data);

      const result = await streamFileToOpfs(mockFile, 'test.sqlite');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.toLowerCase()).toContain('quota');
      }
      // Handle should be closed even on error
      expect(mockAccessHandle.close).toHaveBeenCalled();
    });

    it('returns partial bytes written on error', async () => {
      // Fail after 1.5MB written
      failAfterBytes = Math.floor(1.5 * CHUNK_SIZE);
      const fileSize = 3 * CHUNK_SIZE;
      const data = createSqliteHeader(fileSize);
      const mockFile = createMockFile(data);

      const result = await streamFileToOpfs(mockFile, 'test.sqlite');

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should report bytes written before error
        expect(result.bytesWritten).toBeGreaterThan(0);
        expect(result.bytesWritten).toBeLessThan(fileSize);
      }
    });

    it('closes handle on any error', async () => {
      mockAccessHandle.write.mockImplementation(() => {
        throw new Error('Disk full');
      });
      const data = createSqliteHeader(4096);
      const mockFile = createMockFile(data);

      const result = await streamFileToOpfs(mockFile, 'test.sqlite');

      expect(result.success).toBe(false);
      expect(mockAccessHandle.close).toHaveBeenCalled();
    });
  });

  describe('data integrity', () => {
    it('writes correct data content', async () => {
      // Use a smaller file size for faster test execution
      const fileSize = 8192; // 8KB
      const data = createSqliteHeader(fileSize);
      // Fill with recognizable pattern
      for (let i = 100; i < fileSize; i++) {
        data[i] = i % 256;
      }
      const mockFile = createMockFile(data);

      await streamFileToOpfs(mockFile, 'test.sqlite');

      // Reconstruct written data
      const written = new Uint8Array(fileSize);
      for (const write of writeHistory) {
        written.set(write.data, write.offset);
      }

      // Verify SQLite header preserved
      expect(new TextDecoder().decode(written.slice(0, 16))).toBe('SQLite format 3\0');

      // Verify data integrity
      for (let i = 100; i < fileSize; i++) {
        expect(written[i]).toBe(i % 256);
      }
    });
  });
});
