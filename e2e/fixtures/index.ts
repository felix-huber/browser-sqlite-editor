import { test as base, expect } from '@playwright/test';

/**
 * Extended test fixture with page helpers for common operations.
 * Add database seeding and storage clearing utilities as the app matures.
 */
export const test = base.extend<{
  /**
   * Clear OPFS and IndexedDB storage before each test.
   */
  clearStorage: void;
}>({
  clearStorage: [async ({ page: _page }, use) => {
    await _page.goto('/', { waitUntil: 'domcontentloaded' });

    // Step 1: Wait for test API to be available, then close any open database
    // This releases file handles and allows storage cleanup to succeed
    try {
      await _page.waitForFunction(() => {
        const api = (window as Window & { __sqliteEditorTest?: { hasActiveDatabase?: () => boolean } }).__sqliteEditorTest;
        return !!api?.hasActiveDatabase;
      }, { timeout: 10000 });

      await _page.evaluate(async () => {
        const api = (window as Window & {
          __sqliteEditorTest?: {
            hasActiveDatabase?: () => boolean;
            closeDatabase?: () => Promise<void>;
            resetStore?: () => void;
          }
        }).__sqliteEditorTest;

        if (api) {
          // Close any open database first (releases file handles)
          if (api.hasActiveDatabase?.()) {
            await api.closeDatabase?.();
          }
          // Reset the store to clear any stale state
          api.resetStore?.();
        }
      });
    } catch {
      // If test API isn't available yet, proceed with storage cleanup anyway
    }

    // Give the UI a moment to react to store reset
    await _page.waitForTimeout(100);

    // Step 2: Clear all storage
    await _page.evaluate(async () => {
      localStorage.clear();

      const deleteIdb = (name: string): Promise<void> =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        });

      // Include ALL known databases (VFS storage too)
      const knownDbs = ['sqlite-editor-registry', 'idb-sqlite', 'idb-batch-atomic'];

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
      if (navigator.storage?.getDirectory) {
        try {
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
                // ignore locked files
              }
            }
          } catch {
            // legacy dir might not exist
          }
        } catch {
          // ignore OPFS errors
        }
      }
    });

    // Step 3: Reload after clearing storage to get a completely fresh app state
    // This ensures the React app reinitializes with no activeDbId
    await _page.goto('/', { waitUntil: 'domcontentloaded' });

    // Step 4: Ensure OPFS directories exist (they were deleted above)
    await _page.evaluate(async () => {
      if (navigator.storage?.getDirectory) {
        try {
          const root = await navigator.storage.getDirectory();
          const appDir = await root.getDirectoryHandle('wasm-sqlite-editor', { create: true });
          await appDir.getDirectoryHandle('databases', { create: true });
        } catch {
          // OPFS not available or not in worker context
        }
      }
    });

    // Step 5: Wait for the WASM worker to initialize and be ready to accept commands
    await _page.waitForFunction(async () => {
      const api = (window as Window & { __sqliteEditorTest?: { getRegistry?: () => Promise<unknown> } }).__sqliteEditorTest;
      if (!api?.getRegistry) return false;
      try {
        const registry = await api.getRegistry();
        return registry !== null;
      } catch {
        return false;
      }
    }, { timeout: 30000 });

    // Step 6: Verify we're on the welcome screen (no database is open)
    // This is the key assertion for test isolation
    const welcomeScreen = _page.locator('[data-testid="welcome-screen"]');
    await expect(welcomeScreen).toBeVisible({ timeout: 10000 });

    await use();
  }, { auto: true }],
});

export { expect };

/**
 * Wait for async operations to complete.
 * Useful for waiting on WASM initialization or database operations.
 */
export async function waitForReady(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
  const statusBar = page.locator('[data-testid="status-bar"]');
  await expect(statusBar).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-testid="status-bar"]');
    if (!status) return false;
    const saveStatus = document.querySelector('[data-testid="save-status"]');
    if (saveStatus) return true;
    return status.textContent?.includes('Ready') ?? false;
  });
}
