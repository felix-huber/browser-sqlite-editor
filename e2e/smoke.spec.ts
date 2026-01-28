import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('app loads without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);

    // Allow React dev mode warnings but no actual errors
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('Download the React DevTools')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('welcome screen is displayed', async ({ page }) => {
    await page.goto('/');

    // Check for presence of main heading or welcome content
    await expect(page.locator('h1, [role="heading"]').first()).toBeVisible();
  });
});
