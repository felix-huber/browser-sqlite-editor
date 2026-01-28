/**
 * Unit tests for Query History Management
 *
 * Tests cover:
 * - Load/save history
 * - Add to history
 * - Delete history
 * - Migrate history (for rename)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadHistory,
  saveHistory,
  addToHistory,
  deleteHistory,
  clearHistory,
  migrateHistory,
  hasHistory,
  _testing,
} from '../history';

// =============================================================================
// Mock localStorage
// =============================================================================

const localStorageMock: Storage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();

// =============================================================================
// Test Setup/Teardown
// =============================================================================

beforeEach(() => {
  // Replace global localStorage
  vi.stubGlobal('localStorage', localStorageMock);
  localStorageMock.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// =============================================================================
// Constants Tests
// =============================================================================

describe('History Constants', () => {
  it('should use qh: prefix for storage keys', () => {
    expect(_testing.STORAGE_PREFIX).toBe('qh:');
  });

  it('should have reasonable max history items', () => {
    expect(_testing.MAX_HISTORY_ITEMS).toBe(100);
  });

  it('should generate correct storage key', () => {
    expect(_testing.getStorageKey('mydb')).toBe('qh:mydb');
    expect(_testing.getStorageKey('test database')).toBe('qh:test database');
  });
});

// =============================================================================
// Load/Save Tests
// =============================================================================

describe('loadHistory', () => {
  it('should return empty array when no history exists', () => {
    const history = loadHistory('nonexistent');
    expect(history).toEqual([]);
  });

  it('should return stored history items', () => {
    const items = [
      { sql: 'SELECT * FROM users', executedAt: '2026-01-29T00:00:00.000Z' },
      { sql: 'SELECT * FROM posts', executedAt: '2026-01-29T00:01:00.000Z' },
    ];
    localStorage.setItem('qh:mydb', JSON.stringify(items));

    const history = loadHistory('mydb');
    expect(history).toEqual(items);
  });

  it('should return empty array for invalid JSON', () => {
    localStorage.setItem('qh:mydb', 'not valid json');
    const history = loadHistory('mydb');
    expect(history).toEqual([]);
  });

  it('should return empty array for non-array data', () => {
    localStorage.setItem('qh:mydb', JSON.stringify({ sql: 'SELECT 1' }));
    const history = loadHistory('mydb');
    expect(history).toEqual([]);
  });
});

describe('saveHistory', () => {
  it('should save history to localStorage', () => {
    const items = [{ sql: 'SELECT 1', executedAt: '2026-01-29T00:00:00.000Z' }];
    const result = saveHistory('mydb', items);

    expect(result).toBe(true);
    expect(localStorage.getItem('qh:mydb')).toBe(JSON.stringify(items));
  });

  it('should trim history to max items', () => {
    const items = Array.from({ length: 150 }, (_, i) => ({
      sql: `SELECT ${i}`,
      executedAt: new Date().toISOString(),
    }));

    saveHistory('mydb', items);

    const stored = JSON.parse(localStorage.getItem('qh:mydb') || '[]');
    expect(stored.length).toBe(100);
    expect(stored[0].sql).toBe('SELECT 0'); // First 100 should be kept
  });
});

// =============================================================================
// Add to History Tests
// =============================================================================

describe('addToHistory', () => {
  it('should add new query at the beginning', () => {
    addToHistory('mydb', 'SELECT 1');
    addToHistory('mydb', 'SELECT 2');

    const history = loadHistory('mydb');
    expect(history.length).toBe(2);
    expect(history[0].sql).toBe('SELECT 2');
    expect(history[1].sql).toBe('SELECT 1');
  });

  it('should remove duplicate and add at beginning', () => {
    addToHistory('mydb', 'SELECT 1');
    addToHistory('mydb', 'SELECT 2');
    addToHistory('mydb', 'SELECT 1'); // Duplicate

    const history = loadHistory('mydb');
    expect(history.length).toBe(2);
    expect(history[0].sql).toBe('SELECT 1');
    expect(history[1].sql).toBe('SELECT 2');
  });

  it('should set executedAt timestamp', () => {
    const before = new Date().toISOString();
    addToHistory('mydb', 'SELECT 1');
    const after = new Date().toISOString();

    const history = loadHistory('mydb');
    expect(history[0].executedAt >= before).toBe(true);
    expect(history[0].executedAt <= after).toBe(true);
  });
});

// =============================================================================
// Delete/Clear Tests
// =============================================================================

describe('deleteHistory', () => {
  it('should remove history from localStorage', () => {
    addToHistory('mydb', 'SELECT 1');
    expect(hasHistory('mydb')).toBe(true);

    deleteHistory('mydb');

    expect(hasHistory('mydb')).toBe(false);
  });

  it('should not throw for nonexistent history', () => {
    expect(() => deleteHistory('nonexistent')).not.toThrow();
  });
});

describe('clearHistory', () => {
  it('should set history to empty array (key still exists)', () => {
    addToHistory('mydb', 'SELECT 1');

    clearHistory('mydb');

    const history = loadHistory('mydb');
    expect(history).toEqual([]);
    // Key still exists with empty array
    expect(localStorage.getItem('qh:mydb')).toBe('[]');
  });
});

// =============================================================================
// Migration Tests
// =============================================================================

describe('migrateHistory', () => {
  it('should migrate history from old key to new key', () => {
    const items = [{ sql: 'SELECT 1', executedAt: '2026-01-29T00:00:00.000Z' }];
    localStorage.setItem('qh:old_db', JSON.stringify(items));

    const result = migrateHistory('old_db', 'new_db');

    expect(result).toBe(true);
    expect(localStorage.getItem('qh:old_db')).toBeNull();
    expect(loadHistory('new_db')).toEqual(items);
  });

  it('should return true when no history to migrate', () => {
    const result = migrateHistory('nonexistent', 'new_name');
    expect(result).toBe(true);
  });

  it('should return true for same name (no-op)', () => {
    addToHistory('mydb', 'SELECT 1');
    const result = migrateHistory('mydb', 'mydb');

    expect(result).toBe(true);
    // History should still exist
    expect(loadHistory('mydb').length).toBe(1);
  });

  it('should preserve all history items during migration', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      sql: `SELECT ${i}`,
      executedAt: new Date().toISOString(),
    }));
    localStorage.setItem('qh:old', JSON.stringify(items));

    migrateHistory('old', 'new');

    const migrated = loadHistory('new');
    expect(migrated.length).toBe(50);
    expect(migrated[0].sql).toBe('SELECT 0');
    expect(migrated[49].sql).toBe('SELECT 49');
  });
});

// =============================================================================
// hasHistory Tests
// =============================================================================

describe('hasHistory', () => {
  it('should return false when no history exists', () => {
    expect(hasHistory('mydb')).toBe(false);
  });

  it('should return true when history exists', () => {
    addToHistory('mydb', 'SELECT 1');
    expect(hasHistory('mydb')).toBe(true);
  });

  it('should return true even for empty array', () => {
    localStorage.setItem('qh:mydb', '[]');
    // This returns true because the key exists (even if empty)
    expect(hasHistory('mydb')).toBe(true);
  });
});
