import { test, expect } from '@playwright/test';
import { debug, step, setupConsoleErrorLogging, logPageState } from './helpers/debug';

test.describe('Smoke Tests', () => {
  test('app loads without console errors', async ({ page }) => {
    debug('Starting smoke test: app loads without console errors');

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
        debug('Console error detected:', msg.text());
      }
    });

    await step('Navigate to app', async () => {
      await page.goto('/');
    });

    await step('Verify page title', async () => {
      await expect(page).toHaveTitle(/SQLite Editor/);
    });

    await step('Check for critical console errors', async () => {
      // Allow React dev mode warnings but no actual errors
      const criticalErrors = consoleErrors.filter(
        (e) => !e.includes('Download the React DevTools')
      );
      if (criticalErrors.length > 0) {
        debug('Critical errors found:', criticalErrors);
      }
      expect(criticalErrors).toHaveLength(0);
    });

    debug('Smoke test completed successfully');
  });

  test('welcome screen is displayed', async ({ page }) => {
    debug('Starting smoke test: welcome screen is displayed');
    setupConsoleErrorLogging(page);

    await step('Navigate to app', async () => {
      await page.goto('/');
    });

    await step('Verify heading is visible', async () => {
      await expect(page.locator('h1, [role="heading"]').first()).toBeVisible();
    });

    await logPageState(page);
    debug('Welcome screen test completed successfully');
  });
});
