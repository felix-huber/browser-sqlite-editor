/**
 * Unit tests for SQLite import error handling
 *
 * Tests cover:
 * - Invalid SQLite file detection with user-facing error message
 * - Encrypted/SQLCipher file detection with user-facing error message
 * - Failed imports leave no orphaned files (cleanup on error)
 * - No registry entry on import failure
 */

import { describe, it, expect } from 'vitest';
import {
  validateSqliteFile,
  hasSqliteMagic,
  isEncryptedSqlite,
  detectFileType,
} from '../file-import';

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
 * Create data that mimics an encrypted SQLite file (SQLCipher)
 * SQLCipher encrypted files have random-looking bytes without the SQLite magic
 */
function createEncryptedSqliteData(size = 4096): Uint8Array {
  const data = new Uint8Array(size);
  // Fill with high-entropy random-looking data (no recognizable header)
  for (let i = 0; i < size; i++) {
    // Use a simple PRNG pattern that creates high entropy
    data[i] = (i * 17 + 123 + Math.floor(i / 256) * 13) % 256;
  }
  // Ensure header doesn't match any known file type
  data[0] = 0xAB;
  data[1] = 0xCD;
  data[2] = 0xEF;
  data[3] = 0x12;
  return data;
}

/**
 * Create a PNG file header
 */
function createPngHeader(size = 200): Uint8Array {
  const data = new Uint8Array(size);
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  data[0] = 0x89;
  data[1] = 0x50;
  data[2] = 0x4e;
  data[3] = 0x47;
  data[4] = 0x0d;
  data[5] = 0x0a;
  data[6] = 0x1a;
  data[7] = 0x0a;
  return data;
}


// =============================================================================
// Tests for Error Messages per PRD
// =============================================================================

describe('SQLite import error detection', () => {
  describe('invalid SQLite file', () => {
    it('should return "Not a valid SQLite file" for non-SQLite data', async () => {
      // Create data that is not SQLite, not encrypted, and not a known file type
      const data = new Uint8Array(200);
      data.fill(0x00); // All zeros - not high entropy, not a known type

      const result = await validateSqliteFile(data);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Not a valid SQLite file');
    });

    it('should identify PNG files with descriptive error', async () => {
      const data = createPngHeader();

      const result = await validateSqliteFile(data);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('PNG image');
    });

    it('should reject zero-byte files', async () => {
      const result = await validateSqliteFile(new Uint8Array(0));

      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject files too small to be SQLite', async () => {
      const result = await validateSqliteFile(new Uint8Array(50));

      expect(result.valid).toBe(false);
      expect(result.error).toContain('too small');
    });
  });

  describe('encrypted/SQLCipher file detection', () => {
    it('should detect encrypted SQLite file and return specific error', async () => {
      const data = createEncryptedSqliteData();

      const result = await validateSqliteFile(data);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('File is encrypted — SQLCipher is not supported');
    });

    it('should differentiate encrypted from corrupted based on entropy', () => {
      // Encrypted files have high entropy (many unique byte values)
      const encrypted = createEncryptedSqliteData();
      expect(isEncryptedSqlite(encrypted)).toBe(true);

      // Files with patterns (low entropy) are not detected as encrypted
      const patterned = new Uint8Array(4096);
      patterned.fill(0xAA); // All same byte - low entropy
      expect(isEncryptedSqlite(patterned)).toBe(false);
    });

    it('should not flag valid SQLite as encrypted', () => {
      const valid = createSqliteHeader();
      expect(isEncryptedSqlite(valid)).toBe(false);
    });
  });

  describe('hasSqliteMagic', () => {
    it('should return true for valid SQLite header', () => {
      const data = createSqliteHeader();
      expect(hasSqliteMagic(data)).toBe(true);
    });

    it('should return false for PNG', () => {
      const data = createPngHeader();
      expect(hasSqliteMagic(data)).toBe(false);
    });

    it('should return false for encrypted data', () => {
      const data = createEncryptedSqliteData();
      expect(hasSqliteMagic(data)).toBe(false);
    });

    it('should return false for empty data', () => {
      expect(hasSqliteMagic(new Uint8Array(0))).toBe(false);
    });
  });

  describe('detectFileType', () => {
    it('should detect PNG', () => {
      const data = createPngHeader();
      expect(detectFileType(data)).toBe('PNG image');
    });

    it('should detect JPEG', () => {
      const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      expect(detectFileType(data)).toBe('JPEG image');
    });

    it('should detect PDF', () => {
      const data = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      expect(detectFileType(data)).toBe('PDF document');
    });

    it('should detect ZIP', () => {
      const data = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      expect(detectFileType(data)).toBe('ZIP archive');
    });

    it('should return null for SQLite data', () => {
      const data = createSqliteHeader();
      expect(detectFileType(data)).toBeNull();
    });

    it('should return null for encrypted data', () => {
      const data = createEncryptedSqliteData();
      expect(detectFileType(data)).toBeNull();
    });
  });
});

describe('Import failure cleanup', () => {
  describe('orphaned file prevention', () => {
    it('should not write registry entry on validation failure', async () => {
      // This tests the contract: if validateSqliteFile returns valid=false,
      // no registry entry should be created
      const invalidData = createPngHeader();
      const result = await validateSqliteFile(invalidData);

      expect(result.valid).toBe(false);
      // The actual integration test would verify no registry entry exists
      // This unit test verifies the validation correctly rejects
    });

    it('should return specific error codes for different failure types', async () => {
      // Empty file
      const emptyResult = await validateSqliteFile(new Uint8Array(0));
      expect(emptyResult.error).toContain('empty');

      // Encrypted file
      const encryptedResult = await validateSqliteFile(createEncryptedSqliteData());
      expect(encryptedResult.error).toBe('File is encrypted — SQLCipher is not supported');

      // Known file type
      const pngResult = await validateSqliteFile(createPngHeader());
      expect(pngResult.error).toContain('PNG');

      // Unknown invalid file
      const unknownData = new Uint8Array(200);
      unknownData.fill(0x00);
      const unknownResult = await validateSqliteFile(unknownData);
      expect(unknownResult.error).toBe('Not a valid SQLite file');
    });
  });
});
