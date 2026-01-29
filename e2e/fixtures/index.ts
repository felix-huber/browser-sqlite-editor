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
          try {
            await root.removeEntry('sqlite-editor', { recursive: true });
          } catch {
            // ignore missing dir
          }
        } catch {
          // ignore OPFS errors
        }
      }
    });
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
  await page.waitForSelector('[data-testid="status-bar"]', { timeout: 15000 });
  await expect(page.locator('[data-testid="status-bar"]')).toContainText('Ready');
}
