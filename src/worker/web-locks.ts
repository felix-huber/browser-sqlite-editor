/**
 * Web Locks API Integration for Single-Writer Guarantee
 *
 * Ensures only one tab can write to a database at a time.
 *
 * Lock Strategy:
 * - On DB open: navigator.locks.request("sqlite-editor-{dbId}", {mode: "exclusive"})
 * - If lock acquired: write mode enabled
 * - If lock stolen/unavailable: read-only mode
 * - On DB close: release lock (automatic via AbortController)
 *
 * Lock Status Reporting:
 * - Exposes current lock holder (tab ID) via BroadcastChannel
 * - Other tabs can query lock status before opening DB
 *
 * Fallback (Safari <16.4):
 * - Uses localStorage heartbeat mechanism
 */

// =============================================================================
// Constants
// =============================================================================

/** Prefix for Web Lock names */
const LOCK_PREFIX = 'sqlite-editor-';

/** BroadcastChannel name for lock status */
const LOCK_CHANNEL = 'sqlite-editor-locks';

/** Heartbeat interval for localStorage fallback (ms) */
const HEARTBEAT_INTERVAL = 2000;

/** Heartbeat staleness threshold (ms) */
const HEARTBEAT_STALE_THRESHOLD = 6000;

/** localStorage key prefix for heartbeat fallback */
const LS_HEARTBEAT_PREFIX = 'sqlite-editor-lock-';

// =============================================================================
// Types
// =============================================================================

/**
 * Lock status for a database
 */
export interface LockStatus {
  /** Database ID the lock is for */
  dbId: string;
  /** Whether the lock is currently held */
  isLocked: boolean;
  /** Tab ID of the lock holder (null if not locked) */
  holderId: string | null;
  /** Timestamp when the lock was acquired */
  acquiredAt: number | null;
  /** Whether the lock holder appears stale (for fallback mode) */
  isStale: boolean;
}

/**
 * Lock acquisition result
 */
export interface LockAcquisitionResult {
  /** Whether the lock was acquired */
  acquired: boolean;
  /** If not acquired, the holder's tab ID */
  holderId: string | null;
  /** If not acquired, whether the holder appears stale */
  holderStale: boolean;
}

/**
 * BroadcastChannel message types
 */
type LockMessage =
  | { type: 'lock-acquired'; dbId: string; holderId: string; timestamp: number }
  | { type: 'lock-released'; dbId: string; holderId: string }
  | { type: 'lock-query'; dbId: string; requesterId: string }
  | { type: 'lock-status'; dbId: string; status: LockStatus };

/**
 * Lock manager interface for dependency injection in tests
 */
export interface LockManagerAdapter {
  isWebLocksAvailable: () => boolean;
  requestLock: (
    name: string,
    options: LockOptions & { signal?: AbortSignal },
    callback: () => Promise<void>
  ) => Promise<void>;
  queryLock: (name: string) => Promise<LockManagerSnapshot | null>;
}

/**
 * Default lock manager adapter using the real Web Locks API
 */
const defaultLockManagerAdapter: LockManagerAdapter = {
  isWebLocksAvailable: () => {
    return typeof navigator !== 'undefined' && 'locks' in navigator;
  },
  requestLock: async (name, options, callback) => {
    await navigator.locks.request(name, options, callback);
  },
  queryLock: async (name) => {
    if (typeof navigator === 'undefined' || !navigator.locks) return null;
    const state = await navigator.locks.query();
    const held = state.held?.find((lock) => lock.name === name);
    if (held) {
      return {
        held: [
          {
            name: held.name ?? name,
            mode: held.mode ?? 'exclusive',
            clientId: held.clientId ?? '',
          },
        ],
        pending:
          state.pending
            ?.filter((l) => l.name === name)
            .map((l) => ({
              name: l.name ?? name,
              mode: l.mode ?? 'exclusive',
              clientId: l.clientId ?? '',
            })) ?? [],
      };
    }
    return null;
  },
};

/**
 * Simplified lock manager snapshot for lock queries
 */
export interface LockManagerSnapshot {
  held: SimpleLockInfo[];
  pending: SimpleLockInfo[];
}

export interface SimpleLockInfo {
  name: string;
  mode: string;
  clientId: string;
}

// =============================================================================
// Tab ID Generation
// =============================================================================

let _tabId: string | null = null;

/**
 * Get or generate a unique tab ID
 */
export function getTabId(): string {
  if (!_tabId) {
    _tabId = `tab-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
  }
  return _tabId;
}

/**
 * Reset tab ID (for testing)
 */
export function resetTabId(): void {
  _tabId = null;
}

// =============================================================================
// WebLockManager Class
// =============================================================================

/**
 * Manages Web Locks for single-writer guarantee across tabs
 */
export class WebLockManager {
  private adapter: LockManagerAdapter;
  private channel: BroadcastChannel | null = null;
  private activeLocks: Map<string, AbortController> = new Map();
  private heartbeatIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private lockStatusCache: Map<string, LockStatus> = new Map();
  private messageHandler: ((event: MessageEvent) => void) | null = null;

  constructor(adapter?: LockManagerAdapter) {
    this.adapter = adapter ?? defaultLockManagerAdapter;
    this.initChannel();
  }

  /**
   * Initialize BroadcastChannel for lock status communication
   */
  private initChannel(): void {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(LOCK_CHANNEL);
      this.messageHandler = (event: MessageEvent<LockMessage>) => {
        this.handleMessage(event.data);
      };
      this.channel.addEventListener('message', this.messageHandler);
    }
  }

  /**
   * Handle incoming BroadcastChannel messages
   */
  private handleMessage(message: LockMessage): void {
    switch (message.type) {
      case 'lock-acquired':
        this.lockStatusCache.set(message.dbId, {
          dbId: message.dbId,
          isLocked: true,
          holderId: message.holderId,
          acquiredAt: message.timestamp,
          isStale: false,
        });
        break;

      case 'lock-released':
        this.lockStatusCache.delete(message.dbId);
        break;

      case 'lock-query':
        // Respond if we hold this lock
        if (this.activeLocks.has(message.dbId)) {
          const status = this.lockStatusCache.get(message.dbId);
          if (status) {
            this.channel?.postMessage({
              type: 'lock-status',
              dbId: message.dbId,
              status,
            } as LockMessage);
          }
        }
        break;

      case 'lock-status':
        // Update cache with reported status
        this.lockStatusCache.set(message.dbId, message.status);
        break;
    }
  }

  /**
   * Check if Web Locks API is available
   */
  isWebLocksAvailable(): boolean {
    return this.adapter.isWebLocksAvailable();
  }

  /**
   * Acquire an exclusive lock for a database
   *
   * @param dbId Database ID to lock
   * @returns Acquisition result
   */
  async acquireLock(dbId: string): Promise<LockAcquisitionResult> {
    const tabId = getTabId();

    // If we already hold this lock, return success
    if (this.activeLocks.has(dbId)) {
      return { acquired: true, holderId: null, holderStale: false };
    }

    // Try Web Locks API first
    if (this.isWebLocksAvailable()) {
      return this.acquireWebLock(dbId, tabId);
    }

    // Fallback to localStorage heartbeat
    return this.acquireHeartbeatLock(dbId, tabId);
  }

  /**
   * Acquire lock using Web Locks API
   */
  private async acquireWebLock(dbId: string, tabId: string): Promise<LockAcquisitionResult> {
    const lockName = `${LOCK_PREFIX}${dbId}`;
    const abortController = new AbortController();

    return new Promise((resolve) => {
      // Use ifAvailable: true to check if lock can be acquired without waiting
      // We wrap in a try-catch because the lock request can throw if aborted
      let resolved = false;

      // First, try to acquire without waiting
      this.adapter
        .requestLock(
          lockName,
          {
            mode: 'exclusive',
            ifAvailable: true,
            signal: abortController.signal,
          },
          async () => {
            // Lock acquired!
            this.activeLocks.set(dbId, abortController);
            const timestamp = Date.now();

            // Update cache and broadcast
            this.lockStatusCache.set(dbId, {
              dbId,
              isLocked: true,
              holderId: tabId,
              acquiredAt: timestamp,
              isStale: false,
            });

            this.channel?.postMessage({
              type: 'lock-acquired',
              dbId,
              holderId: tabId,
              timestamp,
            } as LockMessage);

            resolved = true;
            resolve({ acquired: true, holderId: null, holderStale: false });

            // Keep the lock held by returning a promise that never resolves
            // until abort is called
            return new Promise<void>((releaseLock) => {
              abortController.signal.addEventListener('abort', () => {
                releaseLock();
              });
            });
          }
        )
        .catch(() => {
          // Lock request was aborted or failed
          if (!resolved) {
            resolve({ acquired: false, holderId: null, holderStale: false });
          }
        });

      // If lock wasn't acquired immediately, resolve with failure
      // We use a microtask to let the lock callback run first if it can
      queueMicrotask(() => {
        if (!resolved) {
          resolved = true;
          // Try to find who holds the lock
          this.queryLockHolder(dbId).then((holder) => {
            resolve({
              acquired: false,
              holderId: holder?.holderId ?? null,
              holderStale: holder?.isStale ?? false,
            });
          });
        }
      });
    });
  }

  /**
   * Acquire lock using localStorage heartbeat fallback
   */
  private async acquireHeartbeatLock(dbId: string, tabId: string): Promise<LockAcquisitionResult> {
    const key = `${LS_HEARTBEAT_PREFIX}${dbId}`;

    // Check if lock is currently held
    const existing = this.readHeartbeat(key);
    if (existing && !this.isHeartbeatStale(existing.timestamp)) {
      return {
        acquired: false,
        holderId: existing.tabId,
        holderStale: false,
      };
    }

    // Check for stale lock
    if (existing && this.isHeartbeatStale(existing.timestamp)) {
      // Stale lock - we can steal it
      console.warn(`[WebLockManager] Stealing stale lock for ${dbId} from ${existing.tabId}`);
    }

    // Acquire the lock
    const timestamp = Date.now();
    this.writeHeartbeat(key, tabId, timestamp);

    // Set up heartbeat interval
    const interval = setInterval(() => {
      this.writeHeartbeat(key, tabId, Date.now());
    }, HEARTBEAT_INTERVAL);
    this.heartbeatIntervals.set(dbId, interval);

    // Create a fake abort controller for consistency
    const abortController = new AbortController();
    this.activeLocks.set(dbId, abortController);

    // Update cache and broadcast
    this.lockStatusCache.set(dbId, {
      dbId,
      isLocked: true,
      holderId: tabId,
      acquiredAt: timestamp,
      isStale: false,
    });

    this.channel?.postMessage({
      type: 'lock-acquired',
      dbId,
      holderId: tabId,
      timestamp,
    } as LockMessage);

    return { acquired: true, holderId: null, holderStale: false };
  }

  /**
   * Release lock for a database
   */
  async releaseLock(dbId: string): Promise<void> {
    const tabId = getTabId();
    const abortController = this.activeLocks.get(dbId);

    if (abortController) {
      // Abort the lock request, which releases the Web Lock
      abortController.abort();
      this.activeLocks.delete(dbId);
    }

    // Clear heartbeat interval if using fallback
    const interval = this.heartbeatIntervals.get(dbId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(dbId);

      // Remove localStorage entry
      const key = `${LS_HEARTBEAT_PREFIX}${dbId}`;
      try {
        localStorage.removeItem(key);
      } catch {
        // localStorage may not be available
      }
    }

    // Update cache and broadcast
    this.lockStatusCache.delete(dbId);
    this.channel?.postMessage({
      type: 'lock-released',
      dbId,
      holderId: tabId,
    } as LockMessage);
  }

  /**
   * Query lock status for a database
   */
  async queryLockStatus(dbId: string): Promise<LockStatus> {
    // Check cache first
    const cached = this.lockStatusCache.get(dbId);
    if (cached) {
      // For heartbeat locks, check staleness
      if (!this.isWebLocksAvailable() && cached.acquiredAt) {
        cached.isStale = this.isHeartbeatStale(cached.acquiredAt);
      }
      return cached;
    }

    // Try to query the actual lock state
    const holder = await this.queryLockHolder(dbId);
    if (holder) {
      return holder;
    }

    // No lock held
    return {
      dbId,
      isLocked: false,
      holderId: null,
      acquiredAt: null,
      isStale: false,
    };
  }

  /**
   * Query who holds a lock (internal helper)
   */
  private async queryLockHolder(dbId: string): Promise<LockStatus | null> {
    // Try Web Locks API query
    if (this.isWebLocksAvailable()) {
      const lockName = `${LOCK_PREFIX}${dbId}`;
      const snapshot = await this.adapter.queryLock(lockName);
      if (snapshot && snapshot.held.length > 0) {
        const held = snapshot.held[0];
        return {
          dbId,
          isLocked: true,
          holderId: held.clientId,
          acquiredAt: null, // Web Locks API doesn't provide this
          isStale: false,
        };
      }
    }

    // Try localStorage heartbeat
    const key = `${LS_HEARTBEAT_PREFIX}${dbId}`;
    const existing = this.readHeartbeat(key);
    if (existing) {
      const isStale = this.isHeartbeatStale(existing.timestamp);
      return {
        dbId,
        isLocked: !isStale,
        holderId: existing.tabId,
        acquiredAt: existing.timestamp,
        isStale,
      };
    }

    // Broadcast a query and wait briefly for responses
    if (this.channel) {
      this.channel.postMessage({
        type: 'lock-query',
        dbId,
        requesterId: getTabId(),
      } as LockMessage);

      // Give other tabs a chance to respond
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check cache again after query
      return this.lockStatusCache.get(dbId) ?? null;
    }

    return null;
  }

  /**
   * Check if we currently hold a lock for a database
   */
  hasLock(dbId: string): boolean {
    return this.activeLocks.has(dbId);
  }

  /**
   * Read heartbeat from localStorage
   */
  private readHeartbeat(key: string): { tabId: string; timestamp: number } | null {
    try {
      const data = localStorage.getItem(key);
      if (!data) return null;
      const parsed = JSON.parse(data);
      if (typeof parsed.tabId === 'string' && typeof parsed.timestamp === 'number') {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Write heartbeat to localStorage
   */
  private writeHeartbeat(key: string, tabId: string, timestamp: number): void {
    try {
      localStorage.setItem(key, JSON.stringify({ tabId, timestamp }));
    } catch {
      // localStorage may be full or unavailable
    }
  }

  /**
   * Check if a heartbeat timestamp is stale
   */
  private isHeartbeatStale(timestamp: number): boolean {
    return Date.now() - timestamp > HEARTBEAT_STALE_THRESHOLD;
  }

  /**
   * Cleanup all resources
   */
  dispose(): void {
    // Release all locks
    for (const dbId of this.activeLocks.keys()) {
      this.releaseLock(dbId);
    }

    // Close BroadcastChannel
    if (this.channel && this.messageHandler) {
      this.channel.removeEventListener('message', this.messageHandler);
      this.channel.close();
      this.channel = null;
      this.messageHandler = null;
    }

    // Clear caches
    this.lockStatusCache.clear();
  }
}

// =============================================================================
// Module-level Singleton
// =============================================================================

let _lockManagerInstance: WebLockManager | null = null;

/**
 * Get the singleton lock manager instance
 */
export function getLockManager(): WebLockManager {
  if (!_lockManagerInstance) {
    _lockManagerInstance = new WebLockManager();
  }
  return _lockManagerInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetLockManager(): void {
  if (_lockManagerInstance) {
    _lockManagerInstance.dispose();
    _lockManagerInstance = null;
  }
}

// =============================================================================
// Exports for testing
// =============================================================================

export const _testing = {
  LOCK_PREFIX,
  LOCK_CHANNEL,
  HEARTBEAT_INTERVAL,
  HEARTBEAT_STALE_THRESHOLD,
  LS_HEARTBEAT_PREFIX,
  defaultLockManagerAdapter,
};
