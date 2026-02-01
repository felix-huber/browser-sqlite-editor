/**
 * Script to take screenshots for README.md documentation
 * Uses the Sakila demo database to show features with real data
 *
 * Run with: npx tsx scripts/take-screenshots.ts
 */
import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOTS_DIR = join(process.cwd(), 'docs', 'screenshots');
const BASE_URL = 'http://localhost:5173';

// Ensure screenshots directory exists
if (!existsSync(SCREENSHOTS_DIR)) {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function waitForReady(page: Page) {
  // Wait for status bar to appear - don't wait for networkidle as it takes too long
  await page.waitForSelector('[data-testid="status-bar"]', { timeout: 60000 });
  // Wait for app to be truly ready
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-testid="status-bar"]');
    if (!status) return false;
    const saveStatus = document.querySelector('[data-testid="save-status"]');
    if (saveStatus) return true;
    return status.textContent?.includes('Ready') ?? false;
  }, { timeout: 60000 });
}

async function dismissUnsavedPromptIfVisible(page: Page) {
  const discardButton = page.getByTestId('unsaved-prompt-discard');
  try {
    await discardButton.waitFor({ state: 'visible', timeout: 1000 });
    await discardButton.click();
    // Wait for modal to close
    await page.getByTestId('unsaved-prompt-backdrop').waitFor({ state: 'hidden', timeout: 2000 });
  } catch {
    // Modal didn't appear, which is fine
  }
}

async function clickTab(page: Page, tabTestId: string) {
  // Try clicking the tab with retries
  for (let i = 0; i < 3; i++) {
    try {
      const tab = page.getByTestId(tabTestId);
      await tab.waitFor({ state: 'visible', timeout: 5000 });
      await tab.click();
      await dismissUnsavedPromptIfVisible(page);
      return;
    } catch (e) {
      if (i === 2) throw e;
      await page.waitForTimeout(1000);
    }
  }
}

async function takeScreenshots() {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1400,900']
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 2 // Retina quality
  });

  const page = await context.newPage();

  try {
    // Navigate to the app
    console.log('Navigating to app...');
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="welcome-screen"]', { timeout: 30000 });

    // Wait for the worker to be ready
    console.log('Waiting for worker to be ready...');
    await page.waitForFunction(async () => {
      const api = (window as Window & { __sqliteEditorTest?: { getRegistry?: () => Promise<unknown> } }).__sqliteEditorTest;
      if (!api?.getRegistry) return false;
      const registry = await api.getRegistry();
      return registry !== null;
    }, { timeout: 60000 });

    // Click to load Sakila sample database
    console.log('Loading Sakila database...');
    const sakilaButton = page.getByTestId('open-sakila-sample-button');
    await sakilaButton.waitFor({ state: 'visible', timeout: 10000 });
    await sakilaButton.click();

    // Wait for database to load
    console.log('Waiting for database to load...');
    await waitForReady(page);

    // Wait a moment for UI to stabilize
    await page.waitForTimeout(3000);

    // ===== SCREENSHOT 1: Table View with Data =====
    console.log('Taking table view screenshot...');

    // Expand the sakila database in sidebar
    const dbTree = page.getByTestId('db-tree-sakila');
    await dbTree.waitFor({ state: 'visible', timeout: 10000 });
    const isExpanded = await dbTree.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      const dbRow = page.getByTestId('db-row-sakila');
      await dbRow.click();
      await page.waitForTimeout(1000);
    }

    // Click on the film table
    const filmItem = page.getByTestId('item-table-film');
    await filmItem.waitFor({ state: 'visible', timeout: 10000 });
    await filmItem.click();
    await dismissUnsavedPromptIfVisible(page);

    // Wait for data grid to load
    await page.waitForSelector('[data-testid="data-grid"]', { timeout: 15000 });
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, 'data-grid.png'),
      fullPage: false
    });
    console.log('  Saved: data-grid.png');

    // ===== SCREENSHOT 2: SQL Editor =====
    console.log('Taking SQL editor screenshot...');

    // Click on SQL tab
    await clickTab(page, 'tab-sql');
    await page.waitForTimeout(1500);

    // Type an interesting query
    const query = `SELECT a.first_name, a.last_name, COUNT(fa.film_id) as film_count
FROM actor a
JOIN film_actor fa ON a.actor_id = fa.actor_id
GROUP BY a.actor_id
ORDER BY film_count DESC
LIMIT 10;`;

    const editor = page.getByTestId('codemirror-editor');
    await editor.waitFor({ state: 'visible', timeout: 10000 });

    // Click and clear existing content
    const content = editor.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(query, { delay: 5 });

    // Run the query
    const runButton = page.getByTestId('run-button');
    await runButton.waitFor({ state: 'visible', timeout: 5000 });
    await runButton.click();

    // Wait for results
    await page.waitForSelector('[data-testid="results-table"], [data-testid="empty-results"]', { timeout: 15000 });
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, 'sql-editor.png'),
      fullPage: false
    });
    console.log('  Saved: sql-editor.png');

    // ===== SCREENSHOT 3: ERD Diagram =====
    console.log('Taking ERD diagram screenshot...');

    // Click on ERD tab
    await clickTab(page, 'tab-erd');
    await page.waitForTimeout(2000);

    // Wait for ERD to render
    await page.waitForSelector('.react-flow', { timeout: 15000 });
    await page.waitForTimeout(2500);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, 'erd-diagram.png'),
      fullPage: false
    });
    console.log('  Saved: erd-diagram.png');

    // ===== SCREENSHOT 4: Table Designer =====
    console.log('Taking table designer screenshot...');

    // Click on Designer tab
    await clickTab(page, 'tab-designer');
    await page.waitForTimeout(1500);

    // Try to select a table - go back to sidebar and select film again
    await filmItem.click();
    await dismissUnsavedPromptIfVisible(page);
    await page.waitForTimeout(500);

    // Now click designer again
    await clickTab(page, 'tab-designer');
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, 'table-designer.png'),
      fullPage: false
    });
    console.log('  Saved: table-designer.png');

    // ===== SCREENSHOT 5: Main Interface / Query Builder =====
    console.log('Taking query builder screenshot...');

    // Click on Query Builder tab
    await clickTab(page, 'tab-query-builder');
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, 'query-builder.png'),
      fullPage: false
    });
    console.log('  Saved: query-builder.png');

    // ===== SCREENSHOT 6: Main Interface =====
    console.log('Taking main interface screenshot...');

    // Go to table tab with actor table for variety
    const actorItem = page.getByTestId('item-table-actor');
    await actorItem.waitFor({ state: 'visible', timeout: 10000 });
    await actorItem.click();
    await dismissUnsavedPromptIfVisible(page);
    await page.waitForSelector('[data-testid="data-grid"]', { timeout: 15000 });
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, 'main-interface.png'),
      fullPage: false
    });
    console.log('  Saved: main-interface.png');

    console.log('\nAll screenshots taken successfully!');
    console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}`);

  } catch (error) {
    console.error('Error taking screenshots:', error);
    // Take a debug screenshot
    try {
      await page.screenshot({ path: join(SCREENSHOTS_DIR, 'error-debug.png') });
      console.log('Debug screenshot saved to error-debug.png');
    } catch {
      // Ignore
    }
    throw error;
  } finally {
    await browser.close();
  }
}

takeScreenshots().catch(console.error);
