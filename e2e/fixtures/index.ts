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
    await _page.evaluate(async () => {
      localStorage.clear();

      const deleteIdb = (name: string): Promise<void> =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        });

      const knownDbs = ['sqlite-editor-registry', 'idb-sqlite'];

      if (typeof indexedDB.databases === 'function') {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name) {
            await deleteIdb(db.name);
          }
        }
      } else {
        for (const name of knownDbs) {
          await deleteIdb(name);
        }
      }

      if (navigator.storage?.getDirectory) {
        try {
          const root = await navigator.storage.getDirectory();
          // Remove both old and new layout directories
          try {
            await root.removeEntry('sqlite-editor', { recursive: true });
          } catch {
            // ignore missing dir
          }
          try {
            await root.removeEntry('wasm-sqlite-editor', { recursive: true });
          } catch {
            // ignore missing dir
          }
        } catch {
          // ignore OPFS errors
        }
      }
    });
    // Reload after clearing storage and wait for WASM worker to be fully ready.
    await _page.goto('/', { waitUntil: 'domcontentloaded' });
    // Ensure OPFS directories exist (they were deleted above)
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
    // Wait for the WASM worker to initialize and be ready to accept commands
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
