import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Tests for Legacy Layout Migration (bd-2am: P1-06)
 *
 * Tests migration from old /sqlite-editor/ layout to new /wasm-sqlite-editor/databases/ layout.
 *
 * Test IDs:
 * - E2E-P1-06-01: Legacy layout -> migrated layout on startup
 * - E2E-P1-06-02: Simulated mid-migration failure -> resume on reload
 */

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Clear all storage (OPFS and IndexedDB)
 * Must clean ALL known databases including VFS storage.
 */
async function clearAllStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Clear localStorage
    localStorage.clear();

    // Clear IndexedDB - include ALL known databases
    const deleteIdb = (name: string): Promise<void> => {
      return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    };

    const knownDbs = ['sqlite-editor-registry', 'idb-sqlite', 'idb-batch-atomic'];

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
        for (const name of knownDbs) {
          await deleteIdb(name);
        }
      }
    } else {
      for (const name of knownDbs) {
        await deleteIdb(name);
      }
    }

    // Clear OPFS contents without deleting root directories
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
            // ignore locked files
          }
        }
        try {
          await appDir.removeEntry('registry.json');
        } catch {
          // registry might not exist
        }

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
              // ignore locked files
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
 * Create a database file in the LEGACY layout (/sqlite-editor/*.sqlite)
 * Note: We only create the file, not a registry entry. The migration + discovery
 * mechanism will handle creating the registry entry.
 */
async function createLegacyDatabase(page: Page, name: string): Promise<string> {
  return page.evaluate(async (dbName: string): Promise<string> => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

    // Create the legacy directory and .sqlite file
    const root = await navigator.storage.getDirectory();
    const legacyDir = await root.getDirectoryHandle('sqlite-editor', { create: true });

    // Derive filename from name (must match toFilename() in src/worker/db-registry.ts)
    const filename = dbName
      .replace(/[<>:"/\\|?*()]/g, '_')
      .replace(/\s+/g, '_')
      .toLowerCase() + '.sqlite';

    const fileHandle = await legacyDir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();

    // Write minimal SQLite header (16 bytes)
    const sqliteHeader = new Uint8Array([
      0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, // "SQLite f"
      0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00, // "ormat 3\0"
    ]);
    await writable.write(sqliteHeader);
    await writable.close();

    return id;
  }, name);
}

/**
 * Check if a file exists in the NEW layout (/wasm-sqlite-editor/databases/*.sqlite)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function checkNewLayoutFile(page: Page, filename: string): Promise<boolean> {
  return page.evaluate(async (fname: string): Promise<boolean> => {
    try {
      const root = await navigator.storage.getDirectory();
      const newDir = await root.getDirectoryHandle('wasm-sqlite-editor');
      const dbDir = await newDir.getDirectoryHandle('databases');
      await dbDir.getFileHandle(fname);
      return true;
    } catch {
      return false;
    }
  }, filename);
}

/**
 * Check if a file exists in the LEGACY layout (/sqlite-editor/*.sqlite)
 */
async function checkLegacyLayoutFile(page: Page, filename: string): Promise<boolean> {
  return page.evaluate(async (fname: string): Promise<boolean> => {
    try {
      const root = await navigator.storage.getDirectory();
      const legacyDir = await root.getDirectoryHandle('sqlite-editor');
      await legacyDir.getFileHandle(fname);
      return true;
    } catch {
      return false;
    }
  }, filename);
}

/**
 * List files in the NEW layout databases directory
 */
async function listNewLayoutFiles(page: Page): Promise<string[]> {
  return page.evaluate(async (): Promise<string[]> => {
    const files: string[] = [];
    try {
      const root = await navigator.storage.getDirectory();
      const newDir = await root.getDirectoryHandle('wasm-sqlite-editor');
      const dbDir = await newDir.getDirectoryHandle('databases');
      const entries = (dbDir as unknown as AsyncIterable<[string, FileSystemHandle]>)[Symbol.asyncIterator]();
      for await (const [name, handle] of { [Symbol.asyncIterator]: () => entries }) {
        if (handle.kind === 'file' && name.endsWith('.sqlite')) {
          files.push(name);
        }
      }
    } catch {
      // Directory doesn't exist
    }
    return files;
  });
}

/**
 * Read the NEW layout registry
 */
async function readNewLayoutRegistry(page: Page): Promise<{ databases: Array<{ id: string; name: string }> } | null> {
  return page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const newDir = await root.getDirectoryHandle('wasm-sqlite-editor');
      const regFile = await newDir.getFileHandle('registry.json');
      const blob = await regFile.getFile();
      const text = await blob.text();
      return JSON.parse(text);
    } catch {
      return null;
    }
  });
}

/**
 * Wait for app to be ready AND registry to be loaded
 *
 * The app shows "Ready" status immediately, but the registry (database list)
 * is loaded asynchronously after worker initialization. We need to wait for
 * the registry to be loaded to ensure migration has completed.
 */
async function waitForReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  const statusBar = page.locator('[data-testid="status-bar"]');
  await expect(statusBar).toBeVisible({ timeout: 15000 });

  // Wait for the database navigator to be visible - this indicates the sidebar
  // is rendered, which happens after the worker is ready
  const dbNavigator = page.locator('nav[aria-label="Database navigator"]');
  await expect(dbNavigator).toBeVisible({ timeout: 15000 });

  // Wait for the test API to be available and registry to be loaded
  // The test API is exposed only after worker initialization completes
  await page.waitForFunction(async () => {
    const testApi = (window as Window & {
      __sqliteEditorTest?: { getRegistry?: () => Promise<unknown> };
    }).__sqliteEditorTest;
    if (!testApi?.getRegistry) return false;
    try {
      // Calling getRegistry ensures the registry is fully initialized
      await testApi.getRegistry();
      return true;
    } catch {
      return false;
    }
  }, { timeout: 15000 });
}

// =============================================================================
// Tests
// =============================================================================

test.describe('Legacy Layout Migration', () => {
  test.beforeEach(async ({ page }) => {
    // First, navigate to app to access OPFS APIs (needed for storage operations)
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Clear all storage - this gives us a clean slate
    await clearAllStorage(page);
    // NOTE: We do NOT reload here or wait for app ready.
    // Each test will set up its own state and then reload to trigger migration.
  });

  /**
   * E2E-P1-06-01: Legacy layout -> migrated layout on startup
   */
  test('E2E-P1-06-01: should migrate databases from legacy layout on app startup', async ({ page }) => {
    // Capture all console logs
    page.on('console', msg => {
      console.log('BROWSER:', msg.text());
    });

    // Step 1: Create databases in LEGACY layout BEFORE app initializes registry
    // We do this while on the page but before the app has fully initialized
    await createLegacyDatabase(page, 'Legacy DB One');
    await createLegacyDatabase(page, 'Legacy DB Two');

    // Verify files exist in legacy location
    const legacyFile1Exists = await checkLegacyLayoutFile(page, 'legacy_db_one.sqlite');
    const legacyFile2Exists = await checkLegacyLayoutFile(page, 'legacy_db_two.sqlite');
    console.log('Legacy files exist:', { legacyFile1Exists, legacyFile2Exists });
    expect(legacyFile1Exists).toBe(true);
    expect(legacyFile2Exists).toBe(true);

    // Debug: Check OPFS structure before reload
    const legacyDirContents = await page.evaluate(async () => {
      const files: string[] = [];
      try {
        const root = await navigator.storage.getDirectory();
        const legacyDir = await root.getDirectoryHandle('sqlite-editor');
        const entries = (legacyDir as unknown as AsyncIterable<[string, FileSystemHandle]>)[Symbol.asyncIterator]();
        for await (const [name, handle] of { [Symbol.asyncIterator]: () => entries }) {
          files.push(`${name} (${handle.kind})`);
        }
      } catch (e) {
        return [`Error: ${e}`];
      }
      return files;
    });
    console.log('Legacy dir contents before reload:', legacyDirContents);

    // Step 2: Reload app to trigger migration (fresh app start with legacy data present)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForReady(page);

    // Debug: Check what happened
    const legacyDirAfterReload = await page.evaluate(async () => {
      try {
        const root = await navigator.storage.getDirectory();
        await root.getDirectoryHandle('sqlite-editor');
        return 'exists';
      } catch {
        return 'not found';
      }
    });
    console.log('Legacy dir after reload:', legacyDirAfterReload);

    // Debug: Check storage mode and OPFS availability
    const appState = await page.evaluate(async () => {
      // Try to get registry state via the test API if available
      const testApi = (window as Window & {
        __sqliteEditorTest?: { getRegistry?: () => Promise<unknown> };
      }).__sqliteEditorTest;

      // Check OPFS availability (basic check - main thread)
      let opfsBasic = false;
      try {
        if (navigator.storage?.getDirectory) {
          await navigator.storage.getDirectory();
          opfsBasic = true;
        }
      } catch {
        opfsBasic = false;
      }

      // Check cross-origin isolation (required for full OPFS support)
      const crossOriginIsolated = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false;

      if (testApi?.getRegistry) {
        try {
          const registry = await testApi.getRegistry();
          return JSON.stringify({ opfsBasic, crossOriginIsolated, registry }, null, 2);
        } catch (e) {
          return `Error: ${e}`;
        }
      }
      return `Test API not available, OPFS basic: ${opfsBasic}, crossOriginIsolated: ${crossOriginIsolated}`;
    });
    console.log('App state:', appState);

    // Step 3: Verify databases were migrated to new layout
    const newFiles = await listNewLayoutFiles(page);
    console.log('New layout files:', newFiles);
    expect(newFiles).toContain('legacy_db_one.sqlite');
    expect(newFiles).toContain('legacy_db_two.sqlite');

    // Step 4: Verify registry contains the databases (discovered during migration)
    const registry = await readNewLayoutRegistry(page);
    expect(registry).not.toBeNull();
    expect(registry!.databases).toHaveLength(2);
    // Names are derived from filenames: legacy_db_one.sqlite -> "legacy db one"
    const names = registry!.databases.map(d => d.name.toLowerCase());
    expect(names).toContain('legacy db one');
    expect(names).toContain('legacy db two');

    // Step 5: Verify legacy files are preserved (for rollback)
    expect(await checkLegacyLayoutFile(page, 'legacy_db_one.sqlite')).toBe(true);
    expect(await checkLegacyLayoutFile(page, 'legacy_db_two.sqlite')).toBe(true);

    // Step 6: Verify databases appear in the UI (names derived from filenames)
    // The database tree uses role="tree" aria-label="Databases"
    const dbTree = page.locator('ul[role="tree"][aria-label="Databases"]');
    await expect(dbTree.locator('text=legacy db one')).toBeVisible({ timeout: 5000 });
    await expect(dbTree.locator('text=legacy db two')).toBeVisible({ timeout: 5000 });
  });

  /**
   * E2E-P1-06-02: Simulated mid-migration failure -> resume on reload
   *
   * This test simulates an interrupted migration by:
   * 1. Navigating to a blank page to stop the app
   * 2. Setting up partial migration state (legacy files + partial new-layout)
   * 3. Navigating back to the app, which should complete the migration
   */
  test('E2E-P1-06-02: should resume interrupted migration on reload', async ({ page }) => {
    // Navigate to blank page to stop the app and worker
    await page.goto('about:blank');

    // Navigate back briefly to set up OPFS state, then immediately go blank again
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Set up partial migration state atomically before app fully initializes
    await page.evaluate(async () => {
      const sqliteHeader = new Uint8Array([
        0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, // "SQLite f"
        0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00, // "ormat 3\0"
      ]);

      const root = await navigator.storage.getDirectory();

      // First clear existing contents without deleting root directories
      try {
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
          } catch { /* ignore */ }
        }
        try { await appDir.removeEntry('registry.json'); } catch { /* ignore */ }
      } catch { /* ignore */ }

      try {
        const legacyDirExisting = await root.getDirectoryHandle('sqlite-editor');
        const legacyFiles: string[] = [];
        // @ts-expect-error - entries() is available
        for await (const [name] of legacyDirExisting.entries()) {
          legacyFiles.push(name);
        }
        for (const name of legacyFiles) {
          try {
            await legacyDirExisting.removeEntry(name, { recursive: true });
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }

      // Create legacy directory with 3 databases
      const legacyDir = await root.getDirectoryHandle('sqlite-editor', { create: true });

      for (const name of ['db_alpha', 'db_beta', 'db_gamma']) {
        const fileHandle = await legacyDir.getFileHandle(`${name}.sqlite`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(sqliteHeader);
        await writable.close();
      }

      // Create new directory structure with only ONE file (simulating partial migration)
      const newDir = await root.getDirectoryHandle('wasm-sqlite-editor', { create: true });
      const dbDir = await newDir.getDirectoryHandle('databases', { create: true });

      const newHandle = await dbDir.getFileHandle('db_alpha.sqlite', { create: true });
      const writable = await newHandle.createWritable();
      await writable.write(sqliteHeader);
      await writable.close();
    });

    // Go to blank page immediately to stop any background processing
    await page.goto('about:blank');

    // Re-navigate to access OPFS and verify partial state
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Verify partial state BEFORE app fully initializes
    // Use quick check before migration runs
    const partialState = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const checkFile = async (dirPath: string, filename: string): Promise<boolean> => {
        try {
          const parts = dirPath.split('/').filter(Boolean);
          let dir: FileSystemDirectoryHandle = root;
          for (const part of parts) {
            dir = await dir.getDirectoryHandle(part);
          }
          await dir.getFileHandle(filename);
          return true;
        } catch {
          return false;
        }
      };

      return {
        alphaInNew: await checkFile('wasm-sqlite-editor/databases', 'db_alpha.sqlite'),
        betaInNew: await checkFile('wasm-sqlite-editor/databases', 'db_beta.sqlite'),
        gammaInNew: await checkFile('wasm-sqlite-editor/databases', 'db_gamma.sqlite'),
      };
    });

    // At this point, the app is loading but migration may have already run.
    // The key test is that after app is ready, all files should be in new layout
    // and there should be no duplicates.

    // Wait for app to be ready (this ensures migration has completed)
    await waitForReady(page);

    // Verify ALL databases are now in new layout
    const newFiles = await listNewLayoutFiles(page);
    expect(newFiles).toContain('db_alpha.sqlite');
    expect(newFiles).toContain('db_beta.sqlite');
    expect(newFiles).toContain('db_gamma.sqlite');
    expect(newFiles).toHaveLength(3);

    // Verify registry has all 3 databases
    const registry = await readNewLayoutRegistry(page);
    expect(registry).not.toBeNull();
    expect(registry!.databases).toHaveLength(3);

    // Verify no duplicates in UI (names derived from filenames)
    const dbTree = page.locator('ul[role="tree"][aria-label="Databases"]');
    await expect(dbTree.locator('text=db alpha')).toBeVisible();
    await expect(dbTree.locator('text=db beta')).toBeVisible();
    await expect(dbTree.locator('text=db gamma')).toBeVisible();

    // Verify no duplicate entries (each database appears exactly once)
    const alphaCount = await dbTree.locator('text=db alpha').count();
    const betaCount = await dbTree.locator('text=db beta').count();
    const gammaCount = await dbTree.locator('text=db gamma').count();
    expect(alphaCount).toBe(1);
    expect(betaCount).toBe(1);
    expect(gammaCount).toBe(1);

    // Log partial state for debugging
    console.log('Partial state (may have been migrated already):', partialState);
  });

  test('should not run migration when no legacy layout exists', async ({ page }) => {
    // Create a database using the app (should use new layout directly)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForReady(page);

    // Verify no legacy directory exists
    const legacyExists = await page.evaluate(async () => {
      try {
        const root = await navigator.storage.getDirectory();
        await root.getDirectoryHandle('sqlite-editor');
        return true;
      } catch {
        return false;
      }
    });
    expect(legacyExists).toBe(false);
  });

  test('migration should be idempotent (safe to re-run)', async ({ page }) => {
    // Step 1: Create database in legacy layout
    await createLegacyDatabase(page, 'Idempotent Test');

    // Step 2: First reload - triggers initial migration
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForReady(page);

    const filesAfterFirst = await listNewLayoutFiles(page);
    expect(filesAfterFirst).toContain('idempotent_test.sqlite');
    expect(filesAfterFirst).toHaveLength(1);

    // Step 3: Second reload - migration should be a no-op
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForReady(page);

    const filesAfterSecond = await listNewLayoutFiles(page);
    expect(filesAfterSecond).toContain('idempotent_test.sqlite');
    expect(filesAfterSecond).toHaveLength(1); // Still only 1 file, no duplicates

    // Step 4: Third reload - still idempotent
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForReady(page);

    const filesAfterThird = await listNewLayoutFiles(page);
    expect(filesAfterThird).toHaveLength(1);

    // Verify database appears exactly once in UI (name derived from filename)
    const dbTree = page.locator('ul[role="tree"][aria-label="Databases"]');
    await expect(dbTree.locator('text=idempotent test')).toBeVisible();
    const count = await dbTree.locator('text=idempotent test').count();
    expect(count).toBe(1);
  });
});
