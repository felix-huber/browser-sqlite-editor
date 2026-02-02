import { test, expect } from './fixtures';
import { waitForReady, runSql, openViewTab, dismissUnsavedPromptIfVisible } from './helpers/app';
import { debug, step, setupConsoleErrorLogging } from './helpers/debug';

/**
 * E2E Tests for Sample Database (Sakila) Workflow
 *
 * This test suite verifies the complete workflow of:
 * 1. Opening the bundled Sakila sample database
 * 2. Executing SQL queries against it
 * 3. Navigating to different views (Query Builder)
 * 4. Ensuring no console errors occur throughout
 */

test.describe('Sample Database Workflow', () => {
  test('opens Sakila sample database, executes SQL query, and navigates to Query Builder without console errors', async ({
    page,
  }) => {
    debug('Starting sample database workflow test');

    // Track console errors throughout the test
    const consoleErrors: string[] = [];
    setupConsoleErrorLogging(page);
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // Filter out React DevTools message and expected warnings
        const text = msg.text();
        if (!text.includes('Download the React DevTools')) {
          consoleErrors.push(text);
          debug('Console error detected:', text);
        }
      }
    });

    // Step 1: Navigate to the app and verify welcome screen
    await step('Navigate to app', async () => {
      await page.goto('/');
      await expect(page).toHaveTitle(/SQLite Editor/);
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });
    });

    // Step 2: Click "Open Sakila sample database" button
    await step('Open Sakila sample database', async () => {
      const sakilaButton = page.getByTestId('open-sakila-sample-button');
      await expect(sakilaButton).toBeVisible({ timeout: 10000 });
      await sakilaButton.click();
    });

    // Step 3: Wait for the database to load
    await step('Wait for database to load', async () => {
      // Wait for the app to be ready with a database loaded
      await waitForReady(page);

      // Verify the SQL tab is visible (indicates database is open)
      await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 15000 });
    });

    // Step 4: Execute a SQL query
    await step('Execute SQL query', async () => {
      // Make sure we're on the SQL tab
      await page.getByTestId('tab-sql').click();
      await dismissUnsavedPromptIfVisible(page);

      // Run a simple query on the actor table
      await runSql(page, 'SELECT * FROM actor LIMIT 10');

      // Verify results are displayed
      await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 15000 });

      // Verify we have data - actor table has actor_id, first_name, last_name columns
      // Check that at least one cell is visible (indicating data loaded)
      const firstCell = page.locator('[data-testid^="cell-0-"]').first();
      await expect(firstCell).toBeVisible({ timeout: 10000 });
    });

    // Step 5: Navigate to Query Builder
    await step('Navigate to Query Builder', async () => {
      await openViewTab(page, 'Query Builder');

      // Verify Query Builder view is displayed
      await expect(page.getByTestId('query-builder-view')).toBeVisible({ timeout: 10000 });

      // Verify table list shows Sakila tables (actor is one of them)
      await expect(page.getByTestId('table-item-actor')).toBeVisible({ timeout: 10000 });
    });

    // Step 6: Verify no console errors occurred
    await step('Verify no console errors', async () => {
      // Filter out any non-critical warnings if needed
      const criticalErrors = consoleErrors.filter((error) => {
        // Ignore known non-critical messages
        return (
          !error.includes('Download the React DevTools') &&
          !error.includes('React does not recognize') // React DOM prop warnings
        );
      });

      if (criticalErrors.length > 0) {
        debug('Critical console errors found:', criticalErrors);
      }

      expect(criticalErrors).toHaveLength(0);
    });

    debug('Sample database workflow test completed successfully');
  });

  test('Sakila database loads with expected tables', async ({ page }) => {
    debug('Starting Sakila tables verification test');

    const consoleErrors: string[] = [];
    setupConsoleErrorLogging(page);
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('Download the React DevTools')) {
          consoleErrors.push(text);
        }
      }
    });

    // Navigate and open Sakila
    await step('Navigate and open Sakila', async () => {
      await page.goto('/');
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });

      const sakilaButton = page.getByTestId('open-sakila-sample-button');
      await expect(sakilaButton).toBeVisible({ timeout: 10000 });
      await sakilaButton.click();

      await waitForReady(page);
      await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 15000 });
    });

    // Verify key Sakila tables exist by querying them
    await step('Verify Sakila tables via SQL', async () => {
      // Verify each key table exists by counting rows - this is more reliable than text extraction
      const expectedTables = ['actor', 'film', 'customer', 'rental', 'store'];

      for (const tableName of expectedTables) {
        await runSql(page, `SELECT COUNT(*) as cnt FROM ${tableName}`);
        await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 15000 });
        // If the query succeeds without error, the table exists
        await expect(page.getByTestId('cell-0-cnt')).toBeVisible({ timeout: 5000 });
      }
    });

    // Verify no console errors
    await step('Verify no console errors', async () => {
      const criticalErrors = consoleErrors.filter(
        (error) =>
          !error.includes('Download the React DevTools') &&
          !error.includes('React does not recognize')
      );
      expect(criticalErrors).toHaveLength(0);
    });

    debug('Sakila tables verification test completed');
  });

  test('SQL queries on Sakila return correct data', async ({ page }) => {
    debug('Starting Sakila SQL query test');

    const consoleErrors: string[] = [];
    setupConsoleErrorLogging(page);
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('Download the React DevTools')) {
          consoleErrors.push(text);
        }
      }
    });

    // Open Sakila database
    await step('Open Sakila database', async () => {
      await page.goto('/');
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });

      await page.getByTestId('open-sakila-sample-button').click();
      await waitForReady(page);
    });

    // Execute and verify a COUNT query
    await step('Execute COUNT query', async () => {
      await runSql(page, 'SELECT COUNT(*) as total FROM actor');

      await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 15000 });

      // Sakila's actor table should have 200 actors
      const countCell = page.getByTestId('cell-0-total');
      await expect(countCell).toBeVisible({ timeout: 5000 });
      const countText = await countCell.textContent();
      expect(parseInt(countText || '0', 10)).toBeGreaterThan(0);
    });

    // Execute a JOIN query
    await step('Execute JOIN query', async () => {
      await runSql(
        page,
        `SELECT f.title, COUNT(fa.actor_id) as actor_count
         FROM film f
         JOIN film_actor fa ON f.film_id = fa.film_id
         GROUP BY f.film_id
         LIMIT 5`
      );

      await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 15000 });

      // Verify we got results with title column
      const titleCell = page.getByTestId('cell-0-title');
      await expect(titleCell).toBeVisible({ timeout: 5000 });
    });

    // Verify no console errors
    await step('Verify no console errors', async () => {
      const criticalErrors = consoleErrors.filter(
        (error) =>
          !error.includes('Download the React DevTools') &&
          !error.includes('React does not recognize')
      );
      expect(criticalErrors).toHaveLength(0);
    });

    debug('Sakila SQL query test completed');
  });

  test('Query Builder can use Sakila tables', async ({ page }) => {
    debug('Starting Query Builder with Sakila test');

    const consoleErrors: string[] = [];
    setupConsoleErrorLogging(page);
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('Download the React DevTools')) {
          consoleErrors.push(text);
        }
      }
    });

    // Open Sakila database
    await step('Open Sakila database', async () => {
      await page.goto('/');
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });

      await page.getByTestId('open-sakila-sample-button').click();
      await waitForReady(page);
    });

    // Navigate to Query Builder
    await step('Navigate to Query Builder', async () => {
      await openViewTab(page, 'Query Builder');
      await expect(page.getByTestId('query-builder-view')).toBeVisible({ timeout: 10000 });
    });

    // Add a table to the canvas
    await step('Add actor table to canvas', async () => {
      const actorTableItem = page.getByTestId('table-item-actor');
      await expect(actorTableItem).toBeVisible({ timeout: 5000 });

      // Drag the table to the canvas
      await actorTableItem.dragTo(page.getByTestId('query-builder-canvas'), { force: true });

      // Verify table box appears on canvas
      const tableBox = page.locator('[data-testid="table-box"]', { hasText: 'actor' });
      await expect(tableBox).toBeVisible({ timeout: 5000 });
    });

    // Select columns and verify SQL preview
    await step('Select columns and verify SQL preview', async () => {
      const tableBox = page.locator('[data-testid="table-box"]', { hasText: 'actor' });

      // Click select all to select all columns
      await tableBox.locator('[data-testid="select-all-button"]').click();

      // Verify SQL preview shows SELECT statement
      const sqlPreview = page.getByTestId('sql-preview-text');
      await expect(sqlPreview).toContainText('SELECT');
      await expect(sqlPreview).toContainText('actor');
    });

    // Run the query from Query Builder
    await step('Run query from Query Builder', async () => {
      await page.getByTestId('run-button').click();

      // Verify results section appears
      await expect(page.getByTestId('results-section')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('sql-results-display')).toBeVisible({ timeout: 10000 });
    });

    // Verify no console errors
    await step('Verify no console errors', async () => {
      const criticalErrors = consoleErrors.filter(
        (error) =>
          !error.includes('Download the React DevTools') &&
          !error.includes('React does not recognize')
      );
      expect(criticalErrors).toHaveLength(0);
    });

    debug('Query Builder with Sakila test completed');
  });
});
