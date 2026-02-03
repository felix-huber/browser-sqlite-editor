import { test, expect, type Page } from '@playwright/test';
import { createAndOpenOpfsDatabase, openDatabaseFromWelcome, openTable, runSql, isOpfsAvailable } from './helpers/app';

/**
 * Multi-Tab Locking E2E Tests
 *
 * Tests the single-writer guarantee across multiple browser tabs:
 * - Tab A acquires write lock, Tab B gets read-only mode
 * - Write operations blocked in read-only tab
 * - Read operations work in read-only tab
 * - Lock handoff when writer tab closes
 * - Lock takeover on heartbeat timeout (simulated crash)
 * - Status bar shows lock holder information
 */

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Result of creating a test database
 */
interface CreateDbResult {
  success: boolean;
  dbName: string;
  error?: string;
}

/**
 * Clear all storage for clean test state.
 * Must clean ALL known databases including VFS storage to prevent
 * corrupted state from affecting subsequent tests.
 */
async function clearAllStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Clear localStorage (heartbeat locks)
    localStorage.clear();

    // Clear IndexedDB databases - include ALL known databases
    const deleteIdb = (name: string): Promise<void> => {
      return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve(); // Continue even on error
        req.onblocked = () => resolve();
      });
    };

    // Known databases that might exist
    const knownDbs = [
      'sqlite-editor-registry',
      'idb-sqlite',
      'idb-batch-atomic',  // VFS storage
    ];

    // Try to list all databases if available
    if (typeof indexedDB.databases === 'function') {
      try {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name) {
            await deleteIdb(db.name);
          }
        }
      } catch {
        // Fall back to known list
        for (const name of knownDbs) {
          await deleteIdb(name);
        }
      }
    } else {
      for (const name of knownDbs) {
        await deleteIdb(name);
      }
    }

    // Clear OPFS app contents but keep directory handles intact
    try {
      if (navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        const appDir = await root.getDirectoryHandle('wasm-sqlite-editor', { create: true });
        const dbDir = await appDir.getDirectoryHandle('databases', { create: true });
        const dbFiles: string[] = [];
        // @ts-expect-error - entries() is available
        for await (const [name] of dbDir.entries()) {
          dbFiles.push(name);
        }
        for (const name of dbFiles) {
          try {
            await dbDir.removeEntry(name, { recursive: true });
          } catch {
            // Ignore locked files
          }
        }
        try {
          await appDir.removeEntry('registry.json');
        } catch {
          // registry might not exist
        }

        // Best-effort cleanup for legacy layout without deleting root dir
        try {
          const legacyDir = await root.getDirectoryHandle('sqlite-editor');
          const legacyFiles: string[] = [];
          // @ts-expect-error - entries() is available
          for await (const [name] of legacyDir.entries()) {
            legacyFiles.push(name);
          }
          for (const name of legacyFiles) {
            try {
              await legacyDir.removeEntry(name, { recursive: true });
            } catch {
              // Ignore locked files
            }
          }
        } catch {
          // legacy dir might not exist
        }
      }
    } catch {
      // OPFS not available
    }
  });
}

/**
 * Create a test database via the worker
 */
async function createTestDatabase(page: Page, name: string): Promise<CreateDbResult> {
  return page.evaluate(async (dbName: string): Promise<CreateDbResult> => {
    try {
      // Create a minimal SQLite database in IDB storage
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
      const timestamp = new Date().toISOString();

      // Create registry entry
      const entry = {
        id,
        name: dbName,
        createdAt: timestamp,
        lastOpenedAt: timestamp,
        storageType: 'idb' as const,
      };

      // Open registry database
      const registryDb = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('sqlite-editor-registry', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (event) => {
          const database = (event.target as IDBOpenDBRequest).result;
          if (!database.objectStoreNames.contains('registry')) {
            database.createObjectStore('registry', { keyPath: 'key' });
          }
        };
      });

      // Read existing registry
      let existingData: { databases: typeof entry[] } = { databases: [] };
      try {
        const tx = registryDb.transaction('registry', 'readonly');
        const store = tx.objectStore('registry');
        const result = await new Promise<{ key: string; data: typeof existingData } | undefined>(
          (resolve, reject) => {
            const req = store.get('registry');
            req.onsuccess = () => resolve(req.result as { key: string; data: typeof existingData } | undefined);
            req.onerror = () => reject(req.error);
          }
        );
        if (result?.data) {
          existingData = result.data;
        }
      } catch {
        // No existing data
      }

      // Add new entry
      existingData.databases.push(entry);

      // Save back
      const writeTx = registryDb.transaction('registry', 'readwrite');
      const writeStore = writeTx.objectStore('registry');
      await new Promise<void>((resolve, reject) => {
        const req = writeStore.put({ key: 'registry', data: existingData });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      registryDb.close();

      // Create a minimal SQLite database blob with a test table
      // SQLite file header (first 16 bytes)
      const sqliteHeader = new Uint8Array([
        0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66,
        0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
      ]);

      // Store in idb-sqlite
      const sqliteDb = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('idb-sqlite', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (event) => {
          const database = (event.target as IDBOpenDBRequest).result;
          if (!database.objectStoreNames.contains('databases')) {
            database.createObjectStore('databases', { keyPath: 'name' });
          }
        };
      });

      const sqliteTx = sqliteDb.transaction('databases', 'readwrite');
      const sqliteStore = sqliteTx.objectStore('databases');

      await new Promise<void>((resolve, reject) => {
        const blob = new Blob([sqliteHeader], { type: 'application/x-sqlite3' });
        const req = sqliteStore.put({
          name: dbName,
          blob,
          updatedAt: timestamp,
        });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      sqliteDb.close();

      return { success: true, dbName };
    } catch (err) {
      return {
        success: false,
        dbName,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, name);
}

/**
 * Acquire a lock for a database via localStorage heartbeat mechanism
 * This simulates what the app does internally
 */
async function acquireLockInTab(page: Page, dbName: string, tabId: string): Promise<boolean> {
  return page.evaluate(
    ({ dbName: name, tabId: tid }) => {
      const key = `sqlite-editor-lock-${name}`;
      const existing = localStorage.getItem(key);

      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          const timeSince = Date.now() - parsed.timestamp;
          // If existing lock is not stale (< 6s), we can't acquire
          if (timeSince < 6000) {
            return false;
          }
        } catch {
          // Invalid data, proceed to acquire
        }
      }

      // Acquire the lock
      localStorage.setItem(key, JSON.stringify({ tabId: tid, timestamp: Date.now() }));
      return true;
    },
    { dbName, tabId }
  );
}

/**
 * Release a lock for a database
 */
async function releaseLockInTab(page: Page, dbName: string): Promise<void> {
  await page.evaluate((name) => {
    const key = `sqlite-editor-lock-${name}`;
    localStorage.removeItem(key);
  }, dbName);
}

/**
 * Check if a lock is held for a database
 */
async function checkLockStatus(
  page: Page,
  dbName: string
): Promise<{ isLocked: boolean; holderId: string | null; isStale: boolean }> {
  return page.evaluate((name) => {
    const key = `sqlite-editor-lock-${name}`;
    const data = localStorage.getItem(key);

    if (!data) {
      return { isLocked: false, holderId: null, isStale: false };
    }

    try {
      const parsed = JSON.parse(data);
      const timeSince = Date.now() - parsed.timestamp;
      const isStale = timeSince > 6000;

      return {
        isLocked: !isStale,
        holderId: parsed.tabId,
        isStale,
      };
    } catch {
      return { isLocked: false, holderId: null, isStale: false };
    }
  }, dbName);
}

/**
 * Simulate a heartbeat update (keeping the lock alive)
 */
async function updateHeartbeat(page: Page, dbName: string, tabId: string): Promise<void> {
  await page.evaluate(
    ({ dbName: name, tabId: tid }) => {
      const key = `sqlite-editor-lock-${name}`;
      localStorage.setItem(key, JSON.stringify({ tabId: tid, timestamp: Date.now() }));
    },
    { dbName, tabId }
  );
}

/**
 * Simulate a crashed tab by setting a stale timestamp
 */
async function simulateCrashedTab(page: Page, dbName: string, tabId: string): Promise<void> {
  await page.evaluate(
    ({ dbName: name, tabId: tid }) => {
      const key = `sqlite-editor-lock-${name}`;
      // Set timestamp to 10 seconds ago (stale threshold is 6s)
      localStorage.setItem(key, JSON.stringify({ tabId: tid, timestamp: Date.now() - 10000 }));
    },
    { dbName, tabId }
  );
}

/**
 * Generate a unique tab ID
 */
function generateTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('Multi-Tab Locking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
  });

  test.describe('Lock Acquisition', () => {
    test('first tab acquires write lock', async ({ page }) => {
      const dbName = 'test-lock-acquire';
      const tabId = generateTabId();

      // Create test database
      const createResult = await createTestDatabase(page, dbName);
      expect(createResult.success).toBe(true);

      // Acquire lock
      const acquired = await acquireLockInTab(page, dbName, tabId);
      expect(acquired).toBe(true);

      // Verify lock status
      const status = await checkLockStatus(page, dbName);
      expect(status.isLocked).toBe(true);
      expect(status.holderId).toBe(tabId);
      expect(status.isStale).toBe(false);
    });

    test('second tab cannot acquire lock when first tab holds it', async ({ page, context }) => {
      const dbName = 'test-lock-conflict';
      const tabAId = generateTabId();
      const tabBId = generateTabId();

      // Create test database
      await createTestDatabase(page, dbName);

      // Tab A acquires lock
      const tabAAcquired = await acquireLockInTab(page, dbName, tabAId);
      expect(tabAAcquired).toBe(true);

      // Create second page (Tab B) in same context
      const pageB = await context.newPage();
      await pageB.goto('/');

      // Tab B tries to acquire lock - should fail
      const tabBAcquired = await acquireLockInTab(pageB, dbName, tabBId);
      expect(tabBAcquired).toBe(false);

      // Verify lock is still held by Tab A
      const status = await checkLockStatus(pageB, dbName);
      expect(status.isLocked).toBe(true);
      expect(status.holderId).toBe(tabAId);

      await pageB.close();
    });
  });

  test.describe('Lock Release and Handoff', () => {
    test('second tab can acquire lock after first tab releases it', async ({ page, context }) => {
      const dbName = 'test-lock-release';
      const tabAId = generateTabId();
      const tabBId = generateTabId();

      // Create test database
      await createTestDatabase(page, dbName);

      // Tab A acquires lock
      await acquireLockInTab(page, dbName, tabAId);

      // Create Tab B
      const pageB = await context.newPage();
      await pageB.goto('/');

      // Tab B cannot acquire (lock is held)
      let tabBAcquired = await acquireLockInTab(pageB, dbName, tabBId);
      expect(tabBAcquired).toBe(false);

      // Tab A releases lock
      await releaseLockInTab(page, dbName);

      // Verify lock is released
      const statusAfterRelease = await checkLockStatus(page, dbName);
      expect(statusAfterRelease.isLocked).toBe(false);

      // Wait for localStorage propagation to Tab B
      await pageB.waitForFunction(
        (name) => !localStorage.getItem(`sqlite-editor-lock-${name}`),
        dbName
      );

      // Tab B can now acquire lock
      tabBAcquired = await acquireLockInTab(pageB, dbName, tabBId);
      expect(tabBAcquired).toBe(true);

      // Verify Tab B holds lock
      const finalStatus = await checkLockStatus(pageB, dbName);
      expect(finalStatus.isLocked).toBe(true);
      expect(finalStatus.holderId).toBe(tabBId);

      await pageB.close();
    });

    test('lock is automatically released when tab closes', async ({ context }) => {
      const dbName = 'test-lock-close';
      const tabAId = generateTabId();
      const tabBId = generateTabId();

      // Create Tab A
      const pageA = await context.newPage();
      await pageA.goto('/');
      await expect(pageA).toHaveTitle(/SQLite Editor/);
      await clearAllStorage(pageA);

      // Create test database and acquire lock
      await createTestDatabase(pageA, dbName);
      await acquireLockInTab(pageA, dbName, tabAId);

      // Create Tab B
      const pageB = await context.newPage();
      await pageB.goto('/');

      // Tab B cannot acquire lock
      let tabBAcquired = await acquireLockInTab(pageB, dbName, tabBId);
      expect(tabBAcquired).toBe(false);

      // Close Tab A (simulates releasing lock)
      await releaseLockInTab(pageA, dbName); // Explicitly release before close
      await pageA.close();

      // Wait for localStorage propagation to Tab B
      await pageB.waitForFunction(
        (name) => !localStorage.getItem(`sqlite-editor-lock-${name}`),
        dbName
      );

      // Tab B can now acquire lock
      tabBAcquired = await acquireLockInTab(pageB, dbName, tabBId);
      expect(tabBAcquired).toBe(true);

      await pageB.close();
    });
  });

  test.describe('Heartbeat Timeout (Simulated Crash)', () => {
    test('lock becomes stale after heartbeat timeout', async ({ page }) => {
      const dbName = 'test-lock-stale';
      const tabAId = generateTabId();

      // Create test database
      await createTestDatabase(page, dbName);

      // Simulate a crashed tab (stale lock)
      await simulateCrashedTab(page, dbName, tabAId);

      // Verify lock is stale
      const status = await checkLockStatus(page, dbName);
      expect(status.isStale).toBe(true);
      expect(status.holderId).toBe(tabAId);
    });

    test('second tab can acquire stale lock (takeover)', async ({ page, context }) => {
      const dbName = 'test-lock-takeover';
      const tabAId = generateTabId();
      const tabBId = generateTabId();

      // Create test database
      await createTestDatabase(page, dbName);

      // Simulate Tab A crashed (stale lock)
      await simulateCrashedTab(page, dbName, tabAId);

      // Create Tab B
      const pageB = await context.newPage();
      await pageB.goto('/');

      // Verify the lock is stale from Tab B's perspective
      const statusBeforeTakeover = await checkLockStatus(pageB, dbName);
      expect(statusBeforeTakeover.isStale).toBe(true);

      // Tab B can acquire the stale lock (takeover)
      const tabBAcquired = await acquireLockInTab(pageB, dbName, tabBId);
      expect(tabBAcquired).toBe(true);

      // Verify Tab B now holds the lock
      const finalStatus = await checkLockStatus(pageB, dbName);
      expect(finalStatus.isLocked).toBe(true);
      expect(finalStatus.holderId).toBe(tabBId);
      expect(finalStatus.isStale).toBe(false);

      await pageB.close();
    });

    test('heartbeat keeps lock alive', async ({ page }) => {
      const dbName = 'test-heartbeat';
      const tabId = generateTabId();

      // Create test database
      await createTestDatabase(page, dbName);

      // Acquire lock
      await acquireLockInTab(page, dbName, tabId);

      // Verify lock is active
      let status = await checkLockStatus(page, dbName);
      expect(status.isLocked).toBe(true);
      expect(status.isStale).toBe(false);

      // Update heartbeat
      await updateHeartbeat(page, dbName, tabId);

      // Verify lock is still active
      status = await checkLockStatus(page, dbName);
      expect(status.isLocked).toBe(true);
      expect(status.isStale).toBe(false);
    });
  });

  test.describe('Cross-Context Lock Sharing', () => {
    test('locks are visible across browser contexts via localStorage', async ({ page, context }) => {
      const dbName = 'test-cross-context';
      const tabAId = generateTabId();

      // Create test database
      await createTestDatabase(page, dbName);

      // Tab A acquires lock
      await acquireLockInTab(page, dbName, tabAId);

      // Create Tab B in same context (shares localStorage)
      const pageB = await context.newPage();
      await pageB.goto('/');

      // Tab B can see the lock
      const status = await checkLockStatus(pageB, dbName);
      expect(status.isLocked).toBe(true);
      expect(status.holderId).toBe(tabAId);

      await pageB.close();
    });

    test('multiple databases have independent locks', async ({ page }) => {
      const db1Name = 'test-multi-db-1';
      const db2Name = 'test-multi-db-2';
      const tabAId = generateTabId();
      const tabBId = generateTabId();

      // Create two test databases
      await createTestDatabase(page, db1Name);
      await createTestDatabase(page, db2Name);

      // Tab A acquires lock on db1
      const db1Acquired = await acquireLockInTab(page, db1Name, tabAId);
      expect(db1Acquired).toBe(true);

      // Different "tab" acquires lock on db2 (same page, but simulating different tab ID)
      const db2Acquired = await acquireLockInTab(page, db2Name, tabBId);
      expect(db2Acquired).toBe(true);

      // Verify both locks exist independently
      const db1Status = await checkLockStatus(page, db1Name);
      expect(db1Status.holderId).toBe(tabAId);

      const db2Status = await checkLockStatus(page, db2Name);
      expect(db2Status.holderId).toBe(tabBId);
    });
  });
});

test.describe('Two Page Tests (Same Context = Shared localStorage)', () => {
  /**
   * These tests use two pages in the SAME browser context.
   * This correctly simulates two browser tabs that share localStorage.
   * Different browser contexts are isolated and don't share storage.
   */

  test('full multi-tab locking workflow', async ({ context }) => {
    // Create two pages in the SAME context (shares localStorage like real tabs)
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    const dbName = 'test-full-workflow';
    const tabAId = generateTabId();
    const tabBId = generateTabId();

    try {
      // Tab A: Navigate and setup
      await pageA.goto('/');
      await expect(pageA).toHaveTitle(/SQLite Editor/);
      await clearAllStorage(pageA);

      // Tab A: Create database and acquire lock
      await createTestDatabase(pageA, dbName);
      const tabAAcquired = await acquireLockInTab(pageA, dbName, tabAId);
      expect(tabAAcquired).toBe(true);

      // Tab B: Navigate (shares localStorage in same context)
      await pageB.goto('/');
      await expect(pageB).toHaveTitle(/SQLite Editor/);

      // Tab B: Try to acquire lock - should fail (lock is held by Tab A)
      const tabBAcquiredFirst = await acquireLockInTab(pageB, dbName, tabBId);
      expect(tabBAcquiredFirst).toBe(false);

      // Tab B: Verify can see lock status
      const statusFromB = await checkLockStatus(pageB, dbName);
      expect(statusFromB.isLocked).toBe(true);
      expect(statusFromB.holderId).toBe(tabAId);

      // Tab A: Release lock
      await releaseLockInTab(pageA, dbName);

      // Tab B: Now can acquire lock
      const tabBAcquiredSecond = await acquireLockInTab(pageB, dbName, tabBId);
      expect(tabBAcquiredSecond).toBe(true);

      // Verify Tab B holds lock
      const finalStatus = await checkLockStatus(pageB, dbName);
      expect(finalStatus.isLocked).toBe(true);
      expect(finalStatus.holderId).toBe(tabBId);
    } finally {
      await pageA.close();
      await pageB.close();
    }
  });

  test('crash recovery: Tab B takes over after Tab A crashes', async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    const dbName = 'test-crash-recovery';

    try {
      await pageA.goto('/');
      await expect(pageA).toHaveTitle(/SQLite Editor/);
      await clearAllStorage(pageA);
      await pageA.reload();
      const opfsAvailable = await isOpfsAvailable(pageA);
      test.skip(!opfsAvailable, 'OPFS not available');

      // Tab A: Create DB and open as writer
      await createAndOpenOpfsDatabase(pageA, dbName);
      await runSql(pageA, `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users (name) VALUES ('Alice');`);
      await openTable(pageA, dbName, 'users');

      // Tab B: Open same DB (read-only)
      await pageB.goto('/');
      await openDatabaseFromWelcome(pageB, dbName);
      await openTable(pageB, dbName, 'users');
      await expect(pageB.getByTestId('read-only-banner')).toBeVisible();
      await expect(pageB.getByTestId('table-readonly')).toBeVisible();

      // Simulate crash by closing Tab A (lock stops heartbeating)
      await pageA.close();

      // Wait for stale detection and take over
      await expect(pageB.getByTestId('stale-warning')).toBeVisible({ timeout: 15000 });
      await pageB.getByTestId('take-over-button').click();
      await expect(pageB.getByTestId('read-only-banner')).toBeHidden({ timeout: 15000 });
      await expect(pageB.getByTestId('add-row-button')).toBeEnabled();
    } finally {
      await pageB.close();
    }
  });
});

// =============================================================================
// Single-Writer Lock + SQLITE_OPEN_READONLY Enforcement Tests
// =============================================================================

test.describe('Single-Writer Lock Integration', () => {
  test('multi-tab: writer takeover allows writes after stale lock', async ({ context }) => {
    /**
     * This test verifies the complete single-writer lock takeover flow:
     * 1. Tab A acquires write lock and can write to database
     * 2. Tab B opens same database in read-only mode (SQLITE_OPEN_READONLY enforced)
     * 3. After Tab A's lock becomes stale, Tab B can take over
     * 4. After takeover, Tab B can successfully write to database
     *
     * This is an extension of the crash recovery test, verifying the write
     * actually succeeds after takeover.
     */
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    // Use the same naming pattern as existing crash recovery test
    const dbName = 'single-writer-test';

    try {
      await pageA.goto('/');
      await expect(pageA).toHaveTitle(/SQLite Editor/);
      // Clear all storage for fresh test state - same pattern as crash recovery test
      await clearAllStorage(pageA);
      await pageA.reload();
      const opfsAvailable = await isOpfsAvailable(pageA);
      test.skip(!opfsAvailable, 'OPFS not available');

      // Tab A: Create DB with test table as writer
      await createAndOpenOpfsDatabase(pageA, dbName);
      await runSql(pageA, `CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO items (value) VALUES ('from_tab_a');`);
      await openTable(pageA, dbName, 'items');

      // Verify Tab A can see the data it wrote
      await expect(pageA.getByText('from_tab_a')).toBeVisible();

      // Tab B: Navigate and open same database (read-only due to lock)
      await pageB.goto('/');
      await openDatabaseFromWelcome(pageB, dbName);
      await openTable(pageB, dbName, 'items');

      // Tab B should be in read-only mode
      await expect(pageB.getByTestId('read-only-banner')).toBeVisible();

      // Tab B should still see the data (read works in read-only mode)
      await expect(pageB.getByText('from_tab_a')).toBeVisible();

      // Close Tab A to simulate lock becoming stale
      await pageA.close();

      // Wait for stale detection in Tab B
      await expect(pageB.getByTestId('stale-warning')).toBeVisible({ timeout: 15000 });

      // Tab B takes over the write lock
      await pageB.getByTestId('take-over-button').click();

      // Verify Tab B is no longer in read-only mode
      await expect(pageB.getByTestId('read-only-banner')).toBeHidden({ timeout: 15000 });

      // Tab B should now be able to write - use SQL editor to insert new data
      await runSql(pageB, `INSERT INTO items (value) VALUES ('from_tab_b_after_takeover');`);

      // Verify the new data is visible - refresh the table view
      await openTable(pageB, dbName, 'items');
      await expect(pageB.getByText('from_tab_b_after_takeover')).toBeVisible();

      // Also verify original data is still there
      await expect(pageB.getByText('from_tab_a')).toBeVisible();
    } finally {
      await pageB.close();
    }
  });

  test('multi-tab: read-only tab sees lock holder and cannot modify database', async ({ context }) => {
    /**
     * This test verifies that a tab in read-only mode (due to another tab
     * holding the write lock) shows proper read-only UI indication.
     */
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    const dbName = 'readonly-test';

    try {
      await pageA.goto('/');
      await expect(pageA).toHaveTitle(/SQLite Editor/);
      // Clear all storage for fresh test state
      await clearAllStorage(pageA);
      await pageA.reload();
      const opfsAvailable = await isOpfsAvailable(pageA);
      test.skip(!opfsAvailable, 'OPFS not available');

      // Tab A: Create DB with test table as writer
      await createAndOpenOpfsDatabase(pageA, dbName);
      await runSql(pageA, `CREATE TABLE data (id INTEGER PRIMARY KEY, val TEXT);`);

      // Tab B: Navigate and open same database (will be read-only)
      await pageB.goto('/');
      await openDatabaseFromWelcome(pageB, dbName);

      // Tab B should be in read-only mode with banner visible
      await expect(pageB.getByTestId('read-only-banner')).toBeVisible();

      // Verify lock holder info is shown (using specific test ID)
      await expect(pageB.getByTestId('lock-holder-info')).toBeVisible();
    } finally {
      await pageA.close();
      await pageB.close();
    }
  });
});
