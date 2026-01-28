import { test as base, expect } from '@playwright/test';

/**
 * Extended test fixture with page helpers for common operations.
 * Add database seeding and storage clearing utilities as the app matures.
 */
export const test = base.extend<{
  /**
   * Clear OPFS and IndexedDB storage before each test.
   * Currently a no-op placeholder for when storage is implemented.
   */
  clearStorage: void;
}>({
  clearStorage: [async ({ page }, use) => {
    // Placeholder: will clear OPFS + IDB when implemented
    // await page.evaluate(async () => {
    //   // Clear IndexedDB databases
    //   const dbs = await indexedDB.databases?.() ?? [];
    //   for (const db of dbs) {
    //     if (db.name) indexedDB.deleteDatabase(db.name);
    //   }
    //   // Clear OPFS would go here
    // });
    await use();
  }, { auto: true }],
});

export { expect };

/**
 * Wait for async operations to complete.
 * Useful for waiting on WASM initialization or database operations.
 */
export async function waitForReady(page: import('@playwright/test').Page) {
  // Wait for app to be interactive
  await page.waitForLoadState('networkidle');
  // Add app-specific ready checks here as needed
}
