/**
 * Unit tests for Web Locks Module
 *
 * Tests cover:
 * - Single tab: lock acquired successfully
 * - Second tab: lock denied, reports first tab as holder
 * - First tab closes: second tab can acquire lock
 * - Lock query: correctly reports holder before attempting acquire
 * - AbortController: releasing lock works
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WebLockManager,
  getLockManager,
  resetLockManager,
  getTabId,
  resetTabId,
  _testing,
  type LockManagerAdapter,
  type LockManagerSnapshot,
} from '../web-locks';

// =============================================================================
// Mock Types
// =============================================================================

interface MockLockState {
  heldLocks: Map<string, { holderId: string; callback: () => void }>;
  pendingLocks: Map<string, Array<{ resolve: () => void; reject: (err: Error) => void }>>;
  webLocksAvailable: boolean;
  localStorageData: Map<string, string>;
}

// =============================================================================
// Mock Adapter Factory
// =============================================================================

function createMockAdapter(state: MockLockState): LockManagerAdapter {
  return {
    isWebLocksAvailable: () => state.webLocksAvailable,
    requestLock: vi.fn(async (name, options, callback): Promise<void> => {
      if (!state.webLocksAvailable) {
        throw new Error('Web Locks API not available');
      }

      const { ifAvailable, signal } = options as LockOptions & { signal?: AbortSignal };

      // Check if lock is already held
      if (state.heldLocks.has(name)) {
        if (ifAvailable) {
          // Return immediately without calling callback
          return;
        }
        // Queue the request
        return new Promise((resolve, reject) => {
          if (!state.pendingLocks.has(name)) {
            state.pendingLocks.set(name, []);
          }
          state.pendingLocks.get(name)!.push({ resolve: resolve as () => void, reject });
        });
      }

      // Lock is available, acquire it
      const holderId = getTabId();
      let releaseFn: () => void;
      const releasePromise = new Promise<void>((resolve) => {
        releaseFn = resolve;
      });

      state.heldLocks.set(name, {
        holderId,
        callback: () => {
          releaseFn();
        },
      });

      // Handle abort signal
      if (signal) {
        signal.addEventListener('abort', () => {
          state.heldLocks.delete(name);
          releaseFn();
          // Give lock to next pending request
          const pending = state.pendingLocks.get(name);
          if (pending && pending.length > 0) {
            const next = pending.shift()!;
            next.resolve();
          }
        });
      }

      // Call the callback
      await callback();
      await releasePromise;
    }),
    queryLock: vi.fn(async (name): Promise<LockManagerSnapshot | null> => {
      const lock = state.heldLocks.get(name);
      if (lock) {
        return {
          held: [{ name, mode: 'exclusive', clientId: lock.holderId }],
          pending: [],
        };
      }
      return null;
    }),
  };
}

// =============================================================================
// localStorage Mock
// =============================================================================

function mockLocalStorage(state: MockLockState) {
  const mockStorage = {
    getItem: vi.fn((key: string) => state.localStorageData.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      state.localStorageData.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      state.localStorageData.delete(key);
    }),
    clear: vi.fn(() => {
      state.localStorageData.clear();
    }),
    length: 0,
    key: vi.fn(() => null),
  };

  vi.stubGlobal('localStorage', mockStorage);
  return mockStorage;
}

// =============================================================================
// Test Setup/Teardown
// =============================================================================

let mockState: MockLockState;

beforeEach(() => {
  mockState = {
    heldLocks: new Map(),
    pendingLocks: new Map(),
    webLocksAvailable: true,
    localStorageData: new Map(),
  };
  resetLockManager();
  resetTabId();
  mockLocalStorage(mockState);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// =============================================================================
// Web Locks API Tests
// =============================================================================

describe('WebLockManager - Web Locks API', () => {
  describe('Single tab lock acquisition', () => {
    it('should acquire lock successfully when no other holder', async () => {
      const adapter = createMockAdapter(mockState);
      const manager = new WebLockManager(adapter);

      const result = await manager.acquireLock('test-db');

      expect(result.acquired).toBe(true);
      expect(result.holderId).toBeNull();
      expect(result.holderStale).toBe(false);
    });

    it('should report holding the lock after acquisition', async () => {
      const adapter = createMockAdapter(mockState);
      const manager = new WebLockManager(adapter);

      await manager.acquireLock('test-db');

      expect(manager.hasLock('test-db')).toBe(true);
    });

    it('should not acquire same lock twice from same manager', async () => {
      const adapter = createMockAdapter(mockState);
      const manager = new WebLockManager(adapter);

      const result1 = await manager.acquireLock('test-db');
      const result2 = await manager.acquireLock('test-db');

      expect(result1.acquired).toBe(true);
      expect(result2.acquired).toBe(true); // Should return success since we already hold it
      expect(manager.hasLock('test-db')).toBe(true);
    });
  });

  describe('Second tab lock denial', () => {
    it('should deny lock when already held by another manager', async () => {
      const adapter = createMockAdapter(mockState);
      const manager1 = new WebLockManager(adapter);
      const manager2 = new WebLockManager(adapter);

      // First manager acquires lock
      await manager1.acquireLock('test-db');

      // Reset tab ID for second manager simulation
      resetTabId();

      // Second manager tries to acquire
      const result = await manager2.acquireLock('test-db');

      expect(result.acquired).toBe(false);
    });

    it('should report the lock holder when denied', async () => {
      const adapter = createMockAdapter(mockState);
      const manager1 = new WebLockManager(adapter);

      // First manager acquires lock
      const firstTabId = getTabId();
      await manager1.acquireLock('test-db');

      // Query who holds the lock
      const status = await manager1.queryLockStatus('test-db');

      expect(status.isLocked).toBe(true);
      expect(status.holderId).toBe(firstTabId);
    });
  });

  describe('Lock release and handoff', () => {
    it('should release lock via AbortController', async () => {
      const adapter = createMockAdapter(mockState);
      const manager = new WebLockManager(adapter);

      await manager.acquireLock('test-db');
      expect(manager.hasLock('test-db')).toBe(true);

      await manager.releaseLock('test-db');
      expect(manager.hasLock('test-db')).toBe(false);
    });

    it('should allow second manager to acquire after first releases', async () => {
      const adapter = createMockAdapter(mockState);
      const manager1 = new WebLockManager(adapter);
      const manager2 = new WebLockManager(adapter);

      // First manager acquires lock
      await manager1.acquireLock('test-db');

      // First manager releases
      await manager1.releaseLock('test-db');

      // Reset tab ID for second manager
      resetTabId();

      // Second manager can now acquire
      const result = await manager2.acquireLock('test-db');

      expect(result.acquired).toBe(true);
      expect(manager2.hasLock('test-db')).toBe(true);
    });
  });

  describe('Lock query before acquisition', () => {
    it('should correctly report no lock holder when unlocked', async () => {
      // Use a unique db ID to avoid cache interference from other tests
      const adapter = createMockAdapter(mockState);
      const manager = new WebLockManager(adapter);

      const status = await manager.queryLockStatus('unlocked-db-query-test');

      expect(status.isLocked).toBe(false);
      expect(status.holderId).toBeNull();
    });

    it('should correctly report lock holder when locked', async () => {
      const adapter = createMockAdapter(mockState);
      const manager = new WebLockManager(adapter);

      const tabId = getTabId();
      await manager.acquireLock('test-db');

      const status = await manager.queryLockStatus('test-db');

      expect(status.isLocked).toBe(true);
      expect(status.holderId).toBe(tabId);
    });
  });
});

// =============================================================================
// localStorage Heartbeat Fallback Tests
// =============================================================================

describe('WebLockManager - localStorage Heartbeat Fallback', () => {
  beforeEach(() => {
    mockState.webLocksAvailable = false;
  });

  describe('Fallback lock acquisition', () => {
    it('should acquire lock using localStorage when Web Locks unavailable', async () => {
      const adapter = createMockAdapter(mockState);
      const manager = new WebLockManager(adapter);

      const result = await manager.acquireLock('test-db');

      expect(result.acquired).toBe(true);
      expect(manager.hasLock('test-db')).toBe(true);
    });

    it('should write heartbeat to localStorage', async () => {
      const adapter = createMockAdapter(mockState);
      const manager = new WebLockManager(adapter);
      const localStorage = mockLocalStorage(mockState);

      await manager.acquireLock('test-db');

      expect(localStorage.setItem).toHaveBeenCalled();
      const key = `${_testing.LS_HEARTBEAT_PREFIX}test-db`;
      expect(mockState.localStorageData.has(key)).toBe(true);
    });

    it('should deny lock when another holder has fresh heartbeat', async () => {
      const adapter = createMockAdapter(mockState);

      // Simulate another tab's heartbeat
      const key = `${_testing.LS_HEARTBEAT_PREFIX}test-db`;
      mockState.localStorageData.set(
        key,
        JSON.stringify({
          tabId: 'other-tab-123',
          timestamp: Date.now(),
        })
      );

      const manager = new WebLockManager(adapter);
      const result = await manager.acquireLock('test-db');

      expect(result.acquired).toBe(false);
      expect(result.holderId).toBe('other-tab-123');
      expect(result.holderStale).toBe(false);
    });
  });

  describe('Stale lock handling', () => {
    it('should steal lock when holder heartbeat is stale', async () => {
      const adapter = createMockAdapter(mockState);

      // Simulate a stale heartbeat (older than threshold)
      const key = `${_testing.LS_HEARTBEAT_PREFIX}test-db`;
      const staleTimestamp = Date.now() - _testing.HEARTBEAT_STALE_THRESHOLD - 1000;
      mockState.localStorageData.set(
        key,
        JSON.stringify({
          tabId: 'stale-tab-123',
          timestamp: staleTimestamp,
        })
      );

      const manager = new WebLockManager(adapter);
      const result = await manager.acquireLock('test-db');

      expect(result.acquired).toBe(true);
      expect(manager.hasLock('test-db')).toBe(true);
    });

    it('should report stale lock holder before acquisition', async () => {
      const adapter = createMockAdapter(mockState);

      // Simulate a stale heartbeat
      const key = `${_testing.LS_HEARTBEAT_PREFIX}test-db`;
      const staleTimestamp = Date.now() - _testing.HEARTBEAT_STALE_THRESHOLD - 1000;
      mockState.localStorageData.set(
        key,
        JSON.stringify({
          tabId: 'stale-tab-123',
          timestamp: staleTimestamp,
        })
      );

      const manager = new WebLockManager(adapter);
      const status = await manager.queryLockStatus('test-db');

      expect(status.isLocked).toBe(false); // Stale lock is not considered locked
      expect(status.holderId).toBe('stale-tab-123');
      expect(status.isStale).toBe(true);
    });
  });

  describe('Lock release (fallback)', () => {
    it('should remove localStorage entry on release', async () => {
      const adapter = createMockAdapter(mockState);
      const localStorage = mockLocalStorage(mockState);
      const manager = new WebLockManager(adapter);

      await manager.acquireLock('test-db');
      await manager.releaseLock('test-db');

      expect(localStorage.removeItem).toHaveBeenCalled();
      expect(manager.hasLock('test-db')).toBe(false);
    });
  });
});

// =============================================================================
// Tab ID Tests
// =============================================================================

describe('Tab ID Generation', () => {
  it('should generate consistent tab ID for same session', () => {
    const id1 = getTabId();
    const id2 = getTabId();

    expect(id1).toBe(id2);
  });

  it('should generate new tab ID after reset', () => {
    const id1 = getTabId();
    resetTabId();
    const id2 = getTabId();

    expect(id1).not.toBe(id2);
  });

  it('should generate string tab ID', () => {
    const id = getTabId();

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(id.startsWith('tab-')).toBe(true);
  });
});

// =============================================================================
// Singleton Tests
// =============================================================================

describe('WebLockManager - Singleton', () => {
  it('should return same instance from getLockManager', () => {
    const instance1 = getLockManager();
    const instance2 = getLockManager();

    expect(instance1).toBe(instance2);
  });

  it('should create new instance after reset', () => {
    const instance1 = getLockManager();
    resetLockManager();
    const instance2 = getLockManager();

    expect(instance1).not.toBe(instance2);
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe('WebLockManager - Constants', () => {
  it('should have correct lock prefix', () => {
    expect(_testing.LOCK_PREFIX).toBe('sqlite-editor-');
  });

  it('should have correct channel name', () => {
    expect(_testing.LOCK_CHANNEL).toBe('sqlite-editor-locks');
  });

  it('should have reasonable heartbeat interval', () => {
    expect(_testing.HEARTBEAT_INTERVAL).toBe(1000);
  });

  it('should have reasonable stale threshold', () => {
    expect(_testing.HEARTBEAT_STALE_THRESHOLD).toBe(3000);
    expect(_testing.HEARTBEAT_STALE_THRESHOLD).toBeGreaterThan(_testing.HEARTBEAT_INTERVAL);
  });

  it('should have correct localStorage prefix', () => {
    expect(_testing.LS_HEARTBEAT_PREFIX).toBe('sqlite-editor-lock-');
  });
});

// =============================================================================
// Dispose/Cleanup Tests
// =============================================================================

describe('WebLockManager - Cleanup', () => {
  it('should release all locks on dispose', async () => {
    const adapter = createMockAdapter(mockState);
    const manager = new WebLockManager(adapter);

    await manager.acquireLock('db1');
    await manager.acquireLock('db2');

    expect(manager.hasLock('db1')).toBe(true);
    expect(manager.hasLock('db2')).toBe(true);

    manager.dispose();

    expect(manager.hasLock('db1')).toBe(false);
    expect(manager.hasLock('db2')).toBe(false);
  });
});

// =============================================================================
// Multiple Database Lock Tests
// =============================================================================

describe('WebLockManager - Multiple Databases', () => {
  it('should handle locks for different databases independently', async () => {
    const adapter = createMockAdapter(mockState);
    const manager = new WebLockManager(adapter);

    const result1 = await manager.acquireLock('db1');
    const result2 = await manager.acquireLock('db2');

    expect(result1.acquired).toBe(true);
    expect(result2.acquired).toBe(true);
    expect(manager.hasLock('db1')).toBe(true);
    expect(manager.hasLock('db2')).toBe(true);
  });

  it('should release locks independently', async () => {
    const adapter = createMockAdapter(mockState);
    const manager = new WebLockManager(adapter);

    await manager.acquireLock('db1');
    await manager.acquireLock('db2');

    await manager.releaseLock('db1');

    expect(manager.hasLock('db1')).toBe(false);
    expect(manager.hasLock('db2')).toBe(true);
  });
});
