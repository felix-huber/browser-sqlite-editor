/**
 * Screenshot script for README documentation
 * Run with: npx tsx scripts/take-screenshots.ts
 */

import { chromium, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'docs/screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function waitForWorkerReady(page: Page) {
  await page.waitForFunction(
    async () => {
      const api = (
        window as Window & { __sqliteEditorTest?: { getRegistry?: () => Promise<unknown> } }
      ).__sqliteEditorTest;
      if (!api?.getRegistry) return false;
      const registry = await api.getRegistry();
      return registry !== null;
    },
    { timeout: 15000 }
  );
}

async function waitForReady(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000); // Give WASM time to initialize
  const statusBar = page.locator('[data-testid="status-bar"]');
  try {
    await statusBar.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(
      () => {
        const status = document.querySelector('[data-testid="status-bar"]');
        if (!status) return false;
        const saveStatus = document.querySelector('[data-testid="save-status"]');
        if (saveStatus) return true;
        return status.textContent?.includes('Ready') ?? false;
      },
      { timeout: 30000 }
    );
  } catch {
    // Continue anyway if status bar doesn't appear
    console.log('Warning: Status bar not ready, continuing...');
  }
}

async function createAndOpenDatabase(page: Page, dbName: string) {
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000); // Wait for WASM init

  // Wait for welcome screen
  try {
    await page.locator('[data-testid="welcome-screen"]').waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    console.log('Warning: Welcome screen not visible, continuing...');
  }

  // Wait for worker
  try {
    await waitForWorkerReady(page);
  } catch {
    console.log('Warning: Worker not ready, continuing...');
    await page.waitForTimeout(3000);
  }

  await page.getByTestId('new-database-button').click();
  await page.getByTestId('new-database-dialog').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByTestId('database-name-input').fill(dbName);
  const createButton = page.getByTestId('create-button');
  await createButton.waitFor({ state: 'visible' });
  await page.waitForTimeout(1000);
  await createButton.click();

  try {
    await page.getByTestId('new-database-dialog').waitFor({ state: 'hidden', timeout: 10000 });
  } catch {
    console.log('Warning: Dialog still visible, continuing...');
  }

  const recent = page.getByTestId(`recent-db-${dbName}`);
  if (await recent.isVisible().catch(() => false)) {
    await recent.click();
  }
  await waitForReady(page);

  try {
    await page.getByTestId('tab-sql').waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    console.log('Warning: SQL tab not visible, continuing...');
  }
}

async function runSql(page: Page, sql: string) {
  await page.getByTestId('tab-sql').click();
  const editor = page.getByTestId('codemirror-editor');
  await editor.waitFor({ state: 'visible', timeout: 10000 });
  const content = editor.locator('.cm-content');
  if (await content.count()) {
    await content.click();
  } else {
    await editor.click();
  }
  await page.keyboard.press('Control+A');
  await page.keyboard.type(sql);
  await page.getByTestId('run-button').waitFor({ state: 'visible' });
  await page.getByTestId('run-button').click();
  await page.waitForSelector(
    '[data-testid="results-table"], [data-testid="empty-results"], [data-testid="error-display"], [data-testid="ddl-result"], [data-testid="update-result"]',
    { timeout: 15000 }
  );
}

async function takeScreenshot(page: Page, name: string) {
  // Hide read-only indicators for cleaner screenshots
  await page.addStyleTag({
    content: `
      [data-testid="readonly-banner"],
      [data-testid="read-only-banner"],
      .readonly-banner,
      [class*="read-only"],
      [class*="readonly"] {
        display: none !important;
      }
      /* Hide any yellow/orange warning banners at top */
      header + div[class*="bg-amber"],
      header + div[class*="bg-yellow"],
      header + div[class*="bg-orange"],
      .bg-amber-50,
      .bg-yellow-50 {
        display: none !important;
      }
      /* Hide read-only text in table header and status bar */
      span:has-text("Read-only"),
      *[class*="text-amber"],
      *[class*="text-orange"] {
        visibility: hidden !important;
      }
    `
  });

  // Also remove read-only text via JavaScript
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      if (el.textContent?.includes('Read-only') && el.children.length === 0) {
        (el as HTMLElement).style.visibility = 'hidden';
      }
    });
  });

  await page.waitForTimeout(100);

  const filepath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: false });
  console.log(`Saved: ${filepath}`);
}

async function clearStorage(page: Page) {
  await page.evaluate(`(async () => {
    localStorage.clear();

    const deleteIdb = (name) =>
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
        } catch (e) {
          // ignore missing dir
        }
        try {
          await root.removeEntry('wasm-sqlite-editor', { recursive: true });
        } catch (e) {
          // ignore missing dir
        }
      } catch (e) {
        // ignore OPFS errors
      }
    }
  })()`);
}

async function main() {
  // Use a fresh temporary user data directory to avoid any locks
  const userDataDir = `/tmp/playwright-screenshots-${Date.now()}`;
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = browser.pages()[0] || await browser.newPage();

  try {
    const DB_NAME = 'screenshots-demo';

    // Create database with sample data
    await createAndOpenDatabase(page, DB_NAME);

    const sampleSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  role TEXT DEFAULT 'user',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id INTEGER,
  status TEXT DEFAULT 'active',
  budget REAL,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  assignee_id INTEGER,
  priority INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  due_date TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (assignee_id) REFERENCES users(id)
);

INSERT INTO users (name, email, role) VALUES
  ('Alice Chen', 'alice@example.com', 'admin'),
  ('Bob Wilson', 'bob@example.com', 'developer'),
  ('Carol Davis', 'carol@example.com', 'designer'),
  ('David Kim', 'david@example.com', 'developer'),
  ('Eve Miller', 'eve@example.com', 'manager');

INSERT INTO projects (name, owner_id, status, budget) VALUES
  ('Website Redesign', 1, 'active', 50000.00),
  ('Mobile App', 2, 'active', 75000.00),
  ('API Integration', 4, 'planning', 25000.00);

INSERT INTO tasks (project_id, title, assignee_id, priority, due_date) VALUES
  (1, 'Design homepage mockup', 3, 2, '2024-02-15'),
  (1, 'Implement responsive layout', 2, 1, '2024-02-20'),
  (1, 'User testing', 5, 0, '2024-02-28'),
  (2, 'Setup React Native project', 2, 2, '2024-02-10'),
  (2, 'Create authentication flow', 4, 2, '2024-02-18'),
  (2, 'Design app icons', 3, 1, '2024-02-12'),
  (3, 'Define API endpoints', 4, 2, '2024-03-01'),
  (3, 'Write documentation', 1, 1, '2024-03-10');
`;

    await runSql(page, sampleSql);
    await waitForReady(page);

    // 1. Take screenshot of main interface (welcome/main)
    console.log('Taking main interface screenshot...');
    await page.goto('http://localhost:5173');
    await waitForReady(page);

    // Expand the database in sidebar
    const dbTree = page.getByTestId(`db-tree-${DB_NAME}`);
    if (await dbTree.isVisible()) {
      await page.getByTestId(`db-row-${DB_NAME}`).click();
      await page.waitForTimeout(500);
    }
    await takeScreenshot(page, 'main-interface');

    // 2. Data Grid screenshot
    console.log('Taking data grid screenshot...');
    await page.getByTestId('item-table-users').click();
    await page.getByTestId('data-grid').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
    await takeScreenshot(page, 'data-grid');

    // 3. SQL Editor screenshot
    console.log('Taking SQL editor screenshot...');
    await page.getByTestId('tab-sql').click();
    await page.waitForTimeout(300);

    // Clear and type a nice query
    const editor = page.getByTestId('codemirror-editor');
    const content = editor.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(`SELECT
  u.name AS user_name,
  p.name AS project,
  COUNT(t.id) AS task_count,
  SUM(CASE WHEN t.completed = 1 THEN 1 ELSE 0 END) AS completed
FROM users u
LEFT JOIN projects p ON p.owner_id = u.id
LEFT JOIN tasks t ON t.project_id = p.id
GROUP BY u.id, p.id
ORDER BY task_count DESC;`);

    await page.getByTestId('run-button').click();
    await page.getByTestId('results-table').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
    await takeScreenshot(page, 'sql-editor');

    // 4. Table Designer screenshot
    console.log('Taking table designer screenshot...');
    await page.getByTestId('item-table-tasks').click();
    await page.getByTestId('data-grid').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('tab-designer').click();
    await page.getByTestId('table-designer').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
    await takeScreenshot(page, 'table-designer');

    // 5. ERD screenshot
    console.log('Taking ERD screenshot...');
    await page.getByTestId('tab-erd').click();
    await page.getByTestId('erd-view').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000); // Wait for layout to settle
    await takeScreenshot(page, 'erd-diagram');

    // 6. Query Builder screenshot
    console.log('Taking query builder screenshot...');
    await page.getByTestId('tab-query-builder').click();
    await page.getByTestId('query-builder-view').waitFor({ state: 'visible', timeout: 10000 });

    // Drag some tables to the canvas
    const usersItem = page.getByTestId('table-item-users');
    const projectsItem = page.getByTestId('table-item-projects');
    const canvas = page.getByTestId('query-builder-canvas');

    await usersItem.dragTo(canvas, { force: true });
    await page.waitForTimeout(300);
    await projectsItem.dragTo(canvas, { targetPosition: { x: 350, y: 100 }, force: true });
    await page.waitForTimeout(500);

    // Select some columns
    const usersBox = page.locator('[data-testid="table-box"]', { hasText: 'users' });
    const selectAllBtn = usersBox.locator('[data-testid="select-all-button"]');
    if (await selectAllBtn.isVisible()) {
      await selectAllBtn.click();
    }
    await page.waitForTimeout(300);
    await takeScreenshot(page, 'query-builder');

    console.log('\nAll screenshots saved to docs/screenshots/');
  } catch (error) {
    console.error('Error taking screenshots:', error);
    throw error;
  } finally {
    await browser.close();
    // Clean up the temporary user data directory
    const fs = await import('fs');
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
