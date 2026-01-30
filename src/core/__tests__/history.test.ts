/**
 * Unit tests for Query History Management
 *
 * Tests cover:
 * - Load/save history
 * - Add to history with consecutive deduplication
 * - Delete individual history items
 * - Delete/clear history
 * - Migrate history (for rename)
 * - Query truncation (max 10KB)
 * - Quota exceeded handling
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
  removeHistoryItem,
  _testing,
} from '../sql/history';

// =============================================================================
// Mock localStorage
// =============================================================================

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  let shouldFailNextWrite = false;

  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      if (shouldFailNextWrite) {
        const error = new DOMException('Quota exceeded', 'QuotaExceededError');
        throw error;
      }
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
    // Test helpers
    _setFailNextWrite: (fail: boolean) => {
      shouldFailNextWrite = fail;
    },
    _getStore: () => store,
    _setStore: (newStore: Record<string, string>) => {
      store = newStore;
    },
  };
};

let localStorageMock: ReturnType<typeof createLocalStorageMock>;

// =============================================================================
// Test Setup/Teardown
// =============================================================================

beforeEach(() => {
  // Create fresh mock for each test
  localStorageMock = createLocalStorageMock();
  vi.stubGlobal('localStorage', localStorageMock);
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

  it('should have max 50 history items', () => {
    expect(_testing.MAX_HISTORY_ITEMS).toBe(50);
  });

  it('should have max 10KB query size', () => {
    expect(_testing.MAX_QUERY_SIZE_BYTES).toBe(10 * 1024);
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

  it('should trim history to max 50 items', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      sql: `SELECT ${i}`,
      executedAt: new Date().toISOString(),
    }));

    saveHistory('mydb', items);

    const stored = JSON.parse(localStorage.getItem('qh:mydb') || '[]');
    expect(stored.length).toBe(50);
    expect(stored[0].sql).toBe('SELECT 0'); // First 50 should be kept
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

  it('should NOT add duplicate if same as most recent (consecutive deduplication)', () => {
    addToHistory('mydb', 'SELECT 1');
    addToHistory('mydb', 'SELECT 1'); // Same query consecutively

    const history = loadHistory('mydb');
    expect(history.length).toBe(1);
    expect(history[0].sql).toBe('SELECT 1');
  });

  it('should allow same query if not consecutive', () => {
    addToHistory('mydb', 'SELECT 1');
    addToHistory('mydb', 'SELECT 2');
    addToHistory('mydb', 'SELECT 1'); // Same as first, but not consecutive

    const history = loadHistory('mydb');
    expect(history.length).toBe(3);
    expect(history[0].sql).toBe('SELECT 1');
    expect(history[1].sql).toBe('SELECT 2');
    expect(history[2].sql).toBe('SELECT 1');
  });

  it('should set executedAt timestamp', () => {
    const before = new Date().toISOString();
    addToHistory('mydb', 'SELECT 1');
    const after = new Date().toISOString();

    const history = loadHistory('mydb');
    expect(history[0].executedAt >= before).toBe(true);
    expect(history[0].executedAt <= after).toBe(true);
  });

  it('should remove oldest entries when max is exceeded', () => {
    // Add 50 items
    for (let i = 0; i < 50; i++) {
      addToHistory('mydb', `SELECT ${i}`);
    }

    // Add one more (should push out oldest)
    addToHistory('mydb', 'SELECT NEW');

    const history = loadHistory('mydb');
    expect(history.length).toBe(50);
    expect(history[0].sql).toBe('SELECT NEW');
    // Oldest (SELECT 0) should be gone, SELECT 1 should now be last
    expect(history[49].sql).toBe('SELECT 1');
  });
});

// =============================================================================
// Query Truncation Tests
// =============================================================================

describe('truncateQuery', () => {
  it('should not truncate small queries', () => {
    const smallQuery = 'SELECT * FROM users';
    expect(_testing.truncateQuery(smallQuery)).toBe(smallQuery);
  });

  it('should truncate queries larger than 10KB', () => {
    // Create a query larger than 10KB
    const largeQuery = 'SELECT ' + 'x'.repeat(15000);
    const truncated = _testing.truncateQuery(largeQuery);

    // Should be truncated with ...
    expect(truncated.endsWith('...')).toBe(true);
    // Should be within 10KB
    const encoder = new TextEncoder();
    expect(encoder.encode(truncated).length).toBeLessThanOrEqual(10 * 1024);
  });

  it('should add truncated query to history', () => {
    const largeQuery = 'SELECT ' + 'x'.repeat(15000);
    addToHistory('mydb', largeQuery);

    const history = loadHistory('mydb');
    expect(history[0].sql.endsWith('...')).toBe(true);
    expect(history[0].sql.length).toBeLessThan(largeQuery.length);
  });
});

// =============================================================================
// Remove Individual Item Tests
// =============================================================================

describe('removeHistoryItem', () => {
  it('should remove item at specified index', () => {
    addToHistory('mydb', 'SELECT 1');
    addToHistory('mydb', 'SELECT 2');
    addToHistory('mydb', 'SELECT 3');

    // Remove middle item (index 1 = SELECT 2)
    const result = removeHistoryItem('mydb', 1);

    expect(result).toBe(true);
    const history = loadHistory('mydb');
    expect(history.length).toBe(2);
    expect(history[0].sql).toBe('SELECT 3');
    expect(history[1].sql).toBe('SELECT 1');
  });

  it('should return false for invalid index', () => {
    addToHistory('mydb', 'SELECT 1');

    expect(removeHistoryItem('mydb', -1)).toBe(false);
    expect(removeHistoryItem('mydb', 5)).toBe(false);
  });

  it('should handle removing first item', () => {
    addToHistory('mydb', 'SELECT 1');
    addToHistory('mydb', 'SELECT 2');

    removeHistoryItem('mydb', 0);

    const history = loadHistory('mydb');
    expect(history.length).toBe(1);
    expect(history[0].sql).toBe('SELECT 1');
  });

  it('should handle removing last item', () => {
    addToHistory('mydb', 'SELECT 1');
    addToHistory('mydb', 'SELECT 2');

    removeHistoryItem('mydb', 1);

    const history = loadHistory('mydb');
    expect(history.length).toBe(1);
    expect(history[0].sql).toBe('SELECT 2');
  });
});

// =============================================================================
// Quota Exceeded Tests
// =============================================================================

describe('quota exceeded handling', () => {
  it('should remove oldest entries when quota is exceeded', () => {
    // Add some items first
    for (let i = 0; i < 10; i++) {
      addToHistory('mydb', `SELECT ${i}`);
    }

    // Now make setItem fail for the next call
    let failCount = 5; // Fail 5 times, then succeed
    vi.mocked(localStorage.setItem).mockImplementation((key: string, value: string) => {
      if (failCount > 0) {
        failCount--;
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      localStorageMock._setStore({ ...localStorageMock._getStore(), [key]: value });
    });

    // This should succeed after removing 5 oldest entries
    addToHistory('mydb', 'SELECT NEW');

    const history = loadHistory('mydb');
    // Should have removed oldest 5 entries to fit
    expect(history.length).toBeLessThanOrEqual(6);
    expect(history[0].sql).toBe('SELECT NEW');
  });

  it('should return false if cannot save even with empty history', () => {
    // Make setItem always fail
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    const result = saveHistory('mydb', [{ sql: 'SELECT 1', executedAt: new Date().toISOString() }]);
    expect(result).toBe(false);
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
  it('should set history to empty array', () => {
    addToHistory('mydb', 'SELECT 1');

    clearHistory('mydb');

    const history = loadHistory('mydb');
    expect(history).toEqual([]);
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

// =============================================================================
// Persistence Tests
// =============================================================================

describe('persistence', () => {
  it('should survive page refresh simulation', () => {
    // Add some history
    addToHistory('mydb', 'SELECT 1');
    addToHistory('mydb', 'SELECT 2');

    // "Refresh" - reload the history
    const history = loadHistory('mydb');

    expect(history.length).toBe(2);
    expect(history[0].sql).toBe('SELECT 2');
    expect(history[1].sql).toBe('SELECT 1');
  });
});
