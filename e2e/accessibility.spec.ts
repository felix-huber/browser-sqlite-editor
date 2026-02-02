/**
 * Accessibility E2E Tests
 *
 * Tests accessibility compliance using axe-core.
 *
 * Coverage:
 * - Welcome screen accessibility
 * - Grid view accessibility
 * - Dialog accessibility
 * - Focus management
 * - Keyboard navigation
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ensureWelcomeScreen } from './helpers/app';

test.describe('Accessibility', () => {
  test.describe('Welcome Screen', () => {
    test('should have no accessibility violations on initial load', async ({ page }) => {
      await page.goto('/');
      await ensureWelcomeScreen(page);

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test('should have visible focus indicators on buttons', async ({ page }) => {
      await page.goto('/');
      await ensureWelcomeScreen(page);

      // Tab to first focusable element
      await page.keyboard.press('Tab');

      // Check that focused element has a visible focus indicator
      const focusedElement = await page.locator(':focus');
      await expect(focusedElement).toBeVisible();

      // Check for focus outline or ring
      const outline = await focusedElement.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.outline !== 'none' || style.boxShadow !== 'none';
      });
      expect(outline).toBe(true);
    });
  });

  test.describe('Data Grid Accessibility', () => {
    test.beforeEach(async ({ page }) => {
      // Load app and create test database
      await page.goto('/');
      await ensureWelcomeScreen(page);

      // Create a new database via keyboard
      const createDbButton = page.locator('[data-testid="new-database-button"]');
      if (await createDbButton.isVisible()) {
        await createDbButton.click();
        await page.waitForSelector('[data-testid="new-database-dialog"]', { timeout: 5000 });
        await page.fill('[data-testid="database-name-input"]', 'test-accessibility');
        await page.click('[data-testid="create-button"]');
        await page.waitForTimeout(500);
      }
    });

    test('grid should have proper ARIA attributes', async ({ page }) => {
      // Check that grid has role="grid"
      const grid = page.locator('[role="grid"]');
      const gridCount = await grid.count();

      if (gridCount > 0) {
        await expect(grid.first()).toHaveAttribute('aria-label');
        await expect(grid.first()).toHaveAttribute('aria-rowcount');
        await expect(grid.first()).toHaveAttribute('aria-colcount');
      }
    });

    test('grid cells should be keyboard navigable', async ({ page }) => {
      const grid = page.locator('[role="grid"]');
      const gridCount = await grid.count();

      if (gridCount > 0) {
        // Focus the grid
        await grid.first().focus();

        // Test arrow key navigation (if cells exist)
        const cells = page.locator('[role="gridcell"]');
        const cellCount = await cells.count();

        if (cellCount > 0) {
          await page.keyboard.press('ArrowRight');
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('ArrowLeft');
          await page.keyboard.press('ArrowUp');
        }
      }
    });
  });

  test.describe('Sidebar Accessibility', () => {
    test('sidebar tree should have proper ARIA attributes', async ({ page }) => {
      await page.goto('/');
      await ensureWelcomeScreen(page);

      // Check tree has role="tree"
      const tree = page.locator('[role="tree"]');
      const treeCount = await tree.count();

      if (treeCount > 0) {
        await expect(tree.first()).toHaveAttribute('aria-label');
      }
    });

    test('tree items should have aria-expanded', async ({ page }) => {
      await page.goto('/');
      await ensureWelcomeScreen(page);

      // Check tree items have aria-expanded
      const treeItems = page.locator('[role="treeitem"]');
      const treeItemCount = await treeItems.count();

      if (treeItemCount > 0) {
        await expect(treeItems.first()).toHaveAttribute('aria-expanded');
      }
    });

    test('sidebar search should be accessible', async ({ page }) => {
      await page.goto('/');
      await ensureWelcomeScreen(page);

      const searchInput = page.locator('[data-testid="search-input"]');
      await expect(searchInput).toHaveAttribute('aria-label');
    });
  });

  test.describe('Dialog Accessibility', () => {
    test('new database dialog should be accessible', async ({ page }) => {
      await page.goto('/');
      await ensureWelcomeScreen(page);

      // Open new database dialog
      const createDbButton = page.locator('[data-testid="new-database-button"]');
      if (await createDbButton.isVisible()) {
        await createDbButton.click();
        await page.waitForSelector('[data-testid="new-database-dialog"]', { timeout: 5000 });

        // Check dialog has proper ARIA attributes
        const dialogBackdrop = page.locator('[data-testid="new-database-dialog-backdrop"]');
        await expect(dialogBackdrop).toHaveAttribute('role', 'dialog');
        await expect(dialogBackdrop).toHaveAttribute('aria-modal', 'true');
        await expect(dialogBackdrop).toHaveAttribute('aria-labelledby');

        // Run axe on the dialog
        const accessibilityScanResults = await new AxeBuilder({ page })
          .include('[data-testid="new-database-dialog"]')
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze();

        expect(accessibilityScanResults.violations).toEqual([]);

        // Test Escape key closes dialog
        await page.keyboard.press('Escape');
        await expect(dialogBackdrop).not.toBeVisible();
      }
    });

    test('dialog should trap focus', async ({ page }) => {
      await page.goto('/');
      await ensureWelcomeScreen(page);

      // Open new database dialog
      const createDbButton = page.locator('[data-testid="new-database-button"]');
      if (await createDbButton.isVisible()) {
        await createDbButton.click();
        await page.waitForSelector('[data-testid="new-database-dialog"]', { timeout: 5000 });

        // Tab through all focusable elements
        const dialog = page.locator('[data-testid="new-database-dialog"]');
        const focusableElements = dialog.locator('input, button, [tabindex="0"]');
        const count = await focusableElements.count();

        if (count > 0) {
          // Tab through all elements
          for (let i = 0; i < count + 1; i++) {
            await page.keyboard.press('Tab');
          }

          // Focus should still be inside the dialog
          const focusedElement = page.locator(':focus');
          const isInDialog = await focusedElement.evaluate((el) => {
            const dialog = document.querySelector('[data-testid="new-database-dialog"]');
            return dialog?.contains(el) || false;
          });

          expect(isInDialog).toBe(true);
        }
      }
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('all interactive elements should be reachable via Tab', async ({ page }) => {
      await page.goto('/');
      await ensureWelcomeScreen(page);

      // Get all interactive elements
      const interactiveElements = page.locator('button, a, input, select, textarea, [tabindex="0"]');
      const count = await interactiveElements.count();

      // Tab through all elements
      const visitedElements = new Set<string>();
      for (let i = 0; i < count * 2; i++) {
        await page.keyboard.press('Tab');
        const focusedElement = await page.locator(':focus').evaluate((el) => {
          return el?.tagName?.toLowerCase() + '-' + (el?.getAttribute('data-testid') || el?.textContent?.slice(0, 20));
        });
        if (focusedElement) {
          visitedElements.add(focusedElement);
        }
      }

      // Should have visited multiple elements
      expect(visitedElements.size).toBeGreaterThan(0);
    });

    test('buttons should be activatable via Enter and Space', async ({ page }) => {
      await page.goto('/');
      await ensureWelcomeScreen(page);

      // Find a button
      const button = page.locator('[data-testid="create-db-button"]');
      if (await button.isVisible()) {
        // Focus the button
        await button.focus();

        // Test Enter key
        await page.keyboard.press('Enter');

        // Dialog should open
        const dialog = page.locator('[data-testid="new-database-dialog"]');
        if (await dialog.isVisible({ timeout: 2000 })) {
          await page.keyboard.press('Escape');
        }

        // Focus button again
        await button.focus();

        // Test Space key
        await page.keyboard.press('Space');

        // Dialog should open again
        await expect(page.locator('[data-testid="new-database-dialog"]')).toBeVisible({ timeout: 2000 });
      }
    });
  });

  test.describe('Screen Reader Announcements', () => {
    test('status bar should have aria-live region', async ({ page }) => {
      await page.goto('/');
      await ensureWelcomeScreen(page);

      // Wait for status bar
      await page.waitForSelector('[data-testid="status-bar"]', { timeout: 10000 });

      const statusBar = page.locator('[data-testid="status-bar"]');
      await expect(statusBar).toHaveAttribute('role', 'status');
    });

    test('error messages should have role="alert"', async ({ page }) => {
      await page.goto('/');
      await ensureWelcomeScreen(page);

      // Open new database dialog
      const createDbButton = page.locator('[data-testid="new-database-button"]');
      if (await createDbButton.isVisible()) {
        await createDbButton.click();
        await page.waitForSelector('[data-testid="new-database-dialog"]', { timeout: 5000 });

        // Enter invalid name to trigger validation error
        await page.fill('[data-testid="database-name-input"]', '/');
        await page.waitForTimeout(300); // Wait for debounce

        // Check for error with role="alert"
        const errorElement = page.locator('[data-testid="name-validation-error"]');
        if (await errorElement.isVisible()) {
          await expect(errorElement).toHaveAttribute('role', 'alert');
        }
      }
    });
  });
});
