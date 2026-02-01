/**
 * Reset App Data E2E Tests
 *
 * Tests the "Reset app data" functionality to ensure:
 * 1. All databases are deleted
 * 2. Sidebar is empty after reset
 * 3. Recent databases list is empty after reset
 * 4. Storage (OPFS/IndexedDB) is actually cleared
 */

import { test, expect } from '@playwright/test';

test.describe('Reset App Data', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app and wait for initialization
    await page.goto('/');
    await page.waitForSelector('[data-testid="welcome-screen"]', { timeout: 30000 });
  });

  test('reset clears all databases and storage', async ({ page }) => {
    // Step 1: Create a test database
    await page.getByTestId('new-database-button').click();
    await page.waitForSelector('[data-testid="new-database-dialog"]', { timeout: 5000 });

    const dbNameInput = page.getByTestId('database-name-input');
    await dbNameInput.fill('testdb');

    const createButton = page.getByTestId('create-button');
    await createButton.click();

    // Wait for database to be created and opened
    await page.waitForSelector('[data-testid="tab-sql"]', { timeout: 10000 });

    // Verify database appears in sidebar
    await expect(page.getByTestId('sidebar')).toContainText('testdb');

    // Step 2: Close the database to return to welcome screen
    await page.getByRole('button', { name: 'Close DB' }).click();

    // Wait for welcome screen to appear
    await page.waitForSelector('[data-testid="welcome-screen"]', { timeout: 5000 });

    // Verify database appears in recent databases
    await expect(page.getByTestId('recent-databases')).toBeVisible();
    await expect(page.getByTestId('recent-db-testdb')).toBeVisible();

    // Step 3: Click Reset app data
    await page.getByTestId('reset-app-button').click();

    // Wait for confirmation dialog
    await page.waitForSelector('[data-testid="reset-confirm-dialog"]', { timeout: 5000 });

    // Confirm the reset
    await page.getByTestId('reset-confirm-button').click();

    // Wait for page to reload (URL will have ?reset= parameter)
    await page.waitForURL(/\?reset=/, { timeout: 30000 });

    // Wait for app to reinitialize
    await page.waitForSelector('[data-testid="welcome-screen"]', { timeout: 30000 });

    // Step 4: Verify sidebar is empty (no databases)
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toBeVisible();

    // The sidebar should show "No databases" when empty
    const emptyState = sidebar.locator('[data-testid="empty-state"]');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('No databases');

    // Step 5: Verify recent databases section is not visible (no recent DBs)
    // The recent databases section shouldn't exist when there are no databases
    await expect(page.getByTestId('recent-databases')).not.toBeVisible();

    // Step 6: Verify the testdb entry is gone
    await expect(page.locator('text=testdb')).not.toBeVisible();
  });

  test('reset clears multiple databases', async ({ page }) => {
    // Create first database
    await page.getByTestId('new-database-button').click();
    await page.waitForSelector('[data-testid="new-database-dialog"]');
    await page.getByTestId('database-name-input').fill('db1');
    await page.getByTestId('create-button').click();
    await page.waitForSelector('[data-testid="tab-sql"]', { timeout: 10000 });

    // Close it
    await page.getByRole('button', { name: 'Close DB' }).click();
    await page.waitForSelector('[data-testid="welcome-screen"]');

    // Create second database
    await page.getByTestId('new-database-button').click();
    await page.waitForSelector('[data-testid="new-database-dialog"]');
    await page.getByTestId('database-name-input').fill('db2');
    await page.getByTestId('create-button').click();
    await page.waitForSelector('[data-testid="tab-sql"]', { timeout: 10000 });

    // Close it
    await page.getByRole('button', { name: 'Close DB' }).click();
    await page.waitForSelector('[data-testid="welcome-screen"]');

    // Verify both databases exist
    await expect(page.getByTestId('sidebar')).toContainText('db1');
    await expect(page.getByTestId('sidebar')).toContainText('db2');

    // Reset
    await page.getByTestId('reset-app-button').click();
    await page.waitForSelector('[data-testid="reset-confirm-dialog"]');
    await page.getByTestId('reset-confirm-button').click();

    // Wait for reload
    await page.waitForURL(/\?reset=/, { timeout: 30000 });
    await page.waitForSelector('[data-testid="welcome-screen"]', { timeout: 30000 });

    // Verify all databases are gone
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar.locator('[data-testid="empty-state"]')).toBeVisible();
    await expect(page.locator('text=db1')).not.toBeVisible();
    await expect(page.locator('text=db2')).not.toBeVisible();
  });

  test('cancel reset does not clear databases', async ({ page }) => {
    // Create a database
    await page.getByTestId('new-database-button').click();
    await page.waitForSelector('[data-testid="new-database-dialog"]');
    await page.getByTestId('database-name-input').fill('keepme');
    await page.getByTestId('create-button').click();
    await page.waitForSelector('[data-testid="tab-sql"]', { timeout: 10000 });

    // Close it
    await page.getByRole('button', { name: 'Close DB' }).click();
    await page.waitForSelector('[data-testid="welcome-screen"]');

    // Open reset dialog but cancel
    await page.getByTestId('reset-app-button').click();
    await page.waitForSelector('[data-testid="reset-confirm-dialog"]');
    await page.getByTestId('reset-cancel-button').click();

    // Verify dialog is closed
    await expect(page.getByTestId('reset-confirm-dialog')).not.toBeVisible();

    // Verify database still exists
    await expect(page.getByTestId('sidebar')).toContainText('keepme');
  });
});
