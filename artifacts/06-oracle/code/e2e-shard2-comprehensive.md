# E2E Shard 2 OPFS Failures - Comprehensive Analysis Document

**Issue:** GitHub Issue #23 - E2E shard 2 OPFS failures
**Priority:** BLOCKER - All "Table Designer - Edit Mode" tests fail in CI

---

## 1. Problem Statement

### Summary
E2E tests in shard 2 fail consistently in CI (GitHub Actions, Ubuntu, Playwright Chromium headless) but pass locally. Specifically, ALL "Table Designer - Edit Mode" tests fail, while "Table Designer - Create Mode" tests pass.

### Environment
- **CI:** GitHub Actions, Ubuntu latest, Playwright Chromium headless
- **Local:** macOS, Playwright Chromium (passes)
- **Sharding:** Tests split into 2 shards; shard 1 passes, shard 2 fails

### Failure Pattern
The tests fail at `openTable()` which tries to locate `item-table-people` in the sidebar after running `setupDbWithTables()`. The element is never found, suggesting the tables were never created.

### Immediate Error Message
```
Error: expect(locator).toBeVisible() failed
Locator: getByTestId('item-table-people')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

at openTable (e2e/helpers/app.ts:175:22)
at openDesignerForTable (e2e/table-designer.spec.ts:60:3)
```

This indicates that when `setupDbWithTables()` runs SQL to create tables, the SQL execution completes but the tables are not actually persisted or visible in the UI.

---

## 2. Failed CI Runs

### Most Recent Failures (from `gh run list --status failure`)

| Run ID | Commit | Time | Description |
|--------|--------|------|-------------|
| 21551319855 | c53974e | 2026-01-31T21:36:11Z | fix: use static database name in table-designer tests |
| 21550845001 | 13a906a | 2026-01-31T21:00:25Z | fix: use base playwright test for table-designer |
| 21550466852 | b1e84f6 | 2026-01-31T20:29:56Z | fix: ignore .cjs files in ESLint config |

### Key Observations from CI Logs

1. **Shard 2 specific:** All failures occur in shard 2 (`--shard=2/2`)
2. **Create Mode tests PASS:** Tests 119-129 in `Table Designer - Create Mode` all pass
3. **Edit Mode tests FAIL:** Tests 130-153 in `Table Designer - Edit Mode` all fail
4. **Pattern:** Each test times out after ~10 seconds waiting for `item-table-people`

### Successful vs Failed Test Groups

**PASSING (Shard 2):**
- Table Designer - Create Mode (tests 119-129) - 13 tests
- Table Designer Integration Checks (tests 155-156)
- Performance tests (tests 157-160)

**FAILING (Shard 2):**
- Table Designer - Edit Mode (tests 130-153) - ALL 8 unique tests (24 attempts with retries)

---

## 3. Error Logs (from run 21551319855)

```
2026-01-31T21:46:49.0069528Z   x  130 [chromium] > e2e/table-designer.spec.ts:173:3 > Table Designer - Edit Mode > diff preview appears for existing table (9.9s)
2026-01-31T21:47:01.4969226Z   x  131 [chromium] > e2e/table-designer.spec.ts:173:3 > Table Designer - Edit Mode > diff preview appears for existing table (retry #1) (10.9s)
2026-01-31T21:47:12.5805721Z   x  132 [chromium] > e2e/table-designer.spec.ts:173:3 > Table Designer - Edit Mode > diff preview appears for existing table (retry #2) (9.9s)

Error: expect(locator).toBeVisible() failed

Locator: getByTestId('item-table-people')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

   at helpers/app.ts:175

     173 |   await expandDatabaseInSidebar(page, dbName);
     174 |   const item = page.getByTestId(`item-table-${tableName}`);
   > 175 |   await expect(item).toBeVisible({ timeout: 5000 });
         |                      ^
     176 |   await item.click();

     at openTable (e2e/helpers/app.ts:175:22)
     at openDesignerForTable (e2e/table-designer.spec.ts:60:3)
     at e2e/table-designer.spec.ts:174:5
```

---

## 4. Source Code Files

### 4.1 e2e/fixtures/index.ts (clearStorage fixture)

```typescript
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

      // Include ALL known databases (VFS storage too)
      const knownDbs = ['sqlite-editor-registry', 'idb-sqlite', 'idb-batch-atomic'];

      if (typeof indexedDB.databases === 'function') {
        try {
          const dbs = await indexedDB.databases();
          for (const db of dbs) {
            if (db.name) {
              await deleteIdb(db.name);
            }
          }
        } catch {
          // Fall back to known list
          for (const name of knownDbs) {
            await deleteIdb(name);
          }
        }
      } else {
        for (const name of knownDbs) {
          await deleteIdb(name);
        }
      }

      // Clear ALL OPFS directories (not just known ones)
      if (navigator.storage?.getDirectory) {
        try {
          const root = await navigator.storage.getDirectory();
          const dirsToDelete: string[] = [];
          // @ts-expect-error - entries() is available
          for await (const [name, handle] of root.entries()) {
            if (handle.kind === 'directory') {
              dirsToDelete.push(name);
            }
          }
          for (const name of dirsToDelete) {
            try {
              await root.removeEntry(name, { recursive: true });
            } catch {
              // ignore locked dirs
            }
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
```

### 4.2 e2e/helpers/app.ts (createAndOpenDatabase, etc.)

```typescript
import { expect, type Page } from '@playwright/test';

/**
 * Dismiss the UnsavedPrompt modal if it appears.
 */
export async function dismissUnsavedPromptIfVisible(page: Page, timeout = 2000) {
  const discardButton = page.getByTestId('unsaved-prompt-discard');
  try {
    await discardButton.waitFor({ state: 'visible', timeout });
    await discardButton.click();
    await page.getByTestId('unsaved-prompt-backdrop').waitFor({ state: 'hidden', timeout: 2000 });
  } catch {
    // Modal didn't appear, which is fine
  }
}

export async function waitForReady(page: Page) {
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

async function waitForWorkerReady(page: Page) {
  await page.waitForFunction(async () => {
    const api = (window as Window & { __sqliteEditorTest?: { getRegistry?: () => Promise<unknown> } }).__sqliteEditorTest;
    if (!api?.getRegistry) return false;
    const registry = await api.getRegistry();
    return registry !== null;
  }, { timeout: 15000 });
}

export async function createAndOpenDatabase(page: Page, dbName: string) {
  await page.goto('/');
  await expect(page.locator('[data-testid="welcome-screen"]')).toBeVisible();
  // Ensure OPFS directories exist (may have been deleted by test fixtures)
  await page.evaluate(async () => {
    if (navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        const appDir = await root.getDirectoryHandle('wasm-sqlite-editor', { create: true });
        await appDir.getDirectoryHandle('databases', { create: true });
      } catch {
        // OPFS not available, worker will use IDB fallback
      }
    }
  });
  await waitForWorkerReady(page);
  await page.getByTestId('new-database-button').click();
  await expect(page.getByTestId('new-database-dialog')).toBeVisible();
  await page.getByTestId('database-name-input').fill(dbName);
  const createButton = page.getByTestId('create-button');
  await expect(createButton).toBeEnabled({ timeout: 5000 });
  await createButton.click();
  // Handle UnsavedPrompt modal if it appears
  await dismissUnsavedPromptIfVisible(page);
  // Wait for dialog to close with retry logic
  try {
    await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 15000 });
  } catch {
    const createError = page.getByTestId('create-error');
    if (await createError.isVisible().catch(() => false)) {
      throw new Error(`Database creation failed: ${await createError.textContent()}`);
    }
    // Try clicking create again if still visible
    if (await page.getByTestId('new-database-dialog').isVisible().catch(() => false)) {
      const retryButton = page.getByTestId('create-button');
      if (await retryButton.isEnabled().catch(() => false)) {
        await retryButton.click();
        await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 15000 });
      } else {
        throw new Error('Create dialog stuck - button disabled and dialog still visible');
      }
    }
  }
  const recent = page.getByTestId(`recent-db-${dbName}`);
  if (await recent.isVisible().catch(() => false)) {
    await recent.click();
    await dismissUnsavedPromptIfVisible(page);
  }
  await waitForReady(page);
  await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 15000 });
}

export async function runSql(page: Page, sql: string) {
  await page.getByTestId('tab-sql').click();
  await dismissUnsavedPromptIfVisible(page);
  const directInput = page.getByTestId('sql-input');
  if (await directInput.count()) {
    await directInput.fill(sql, { force: true });
  } else {
    const editor = page.getByTestId('codemirror-editor');
    await expect(editor).toBeVisible({ timeout: 10000 });
    const content = editor.locator('.cm-content');
    if (await content.count()) {
      await content.click();
    } else {
      await editor.click();
    }
    await page.keyboard.press('Control+A');
    await page.keyboard.type(sql);
  }
  await expect(page.getByTestId('run-button')).toBeEnabled();
  await page.getByTestId('run-button').click();
  await page.waitForSelector('[data-testid="results-table"], [data-testid="empty-results"], [data-testid="error-display"]', { timeout: 15000 });
}

export async function expandDatabaseInSidebar(page: Page, dbName: string) {
  const dbTree = page.getByTestId(`db-tree-${dbName}`);
  await expect(dbTree).toBeVisible({ timeout: 5000 });
  const expanded = await dbTree.getAttribute('aria-expanded');
  if (expanded !== 'true') {
    const dbRow = page.getByTestId(`db-row-${dbName}`);
    await dbRow.click();
  }
}

export async function openTable(page: Page, dbName: string, tableName: string) {
  await expandDatabaseInSidebar(page, dbName);
  const item = page.getByTestId(`item-table-${tableName}`);
  await expect(item).toBeVisible({ timeout: 5000 });
  await item.click();
  await dismissUnsavedPromptIfVisible(page);
  await expect(page.getByTestId('data-grid')).toBeVisible({ timeout: 10000 });
}
```

### 4.3 e2e/table-designer.spec.ts (the failing tests)

```typescript
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  createAndOpenDatabase,
  openDatabaseFromWelcome,
  openTable,
  runSql,
  waitForReady,
  expandDatabaseInSidebar,
} from './helpers/app';

/**
 * E2E Tests for Table Designer
 *
 * IMPORTANT: These tests use static database names to avoid OPFS resource
 * exhaustion issues. Each test reuses the same database name which effectively
 * replaces the previous database.
 */

const DB_NAME = 'table-designer-db';

async function setupEmptyDb(page: Page) {
  await createAndOpenDatabase(page, DB_NAME);
  await waitForReady(page);
  return DB_NAME;
}

async function setupDbWithTables(page: Page) {
  await createAndOpenDatabase(page, DB_NAME);
  // Run each statement separately for reliability
  const statements = [
    'PRAGMA foreign_keys = ON',
    `CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      age INTEGER,
      note TEXT
    )`,
    `INSERT OR REPLACE INTO people (id, name, age, note) VALUES (1, 'Ada', 30, 'Note')`,
    'CREATE INDEX IF NOT EXISTS idx_people_name ON people(name)',
    `CREATE TRIGGER IF NOT EXISTS people_update AFTER UPDATE ON people BEGIN UPDATE people SET note = note; END`,
    `CREATE TABLE IF NOT EXISTS generated_table (
      id INTEGER PRIMARY KEY,
      name TEXT,
      name_upper TEXT GENERATED ALWAYS AS (UPPER(name)) STORED
    )`,
  ];
  for (const stmt of statements) {
    await runSql(page, stmt);
  }
  await waitForReady(page);
  // Wait for sidebar to show the created tables
  await expandDatabaseInSidebar(page, DB_NAME);
  await expect(page.getByTestId('item-table-people')).toBeVisible({ timeout: 10000 });
  return DB_NAME;
}

async function openDesigner(page: Page) {
  await page.getByTestId('tab-designer').click();
  await expect(page.getByTestId('table-designer')).toBeVisible();
}

async function openDesignerForTable(page: Page, dbName: string, tableName: string) {
  await openTable(page, dbName, tableName);
  await openDesigner(page);
}

// ...column helper functions...

test.describe('Table Designer - Create Mode', () => {
  let dbName = '';
  test.beforeEach(async ({ page }) => {
    dbName = await setupEmptyDb(page);
    await openDesigner(page);
  });

  // ... Create Mode tests (PASS) ...
});

test.describe('Table Designer - Edit Mode', () => {
  let dbName = '';
  test.beforeEach(async ({ page }) => {
    dbName = await setupDbWithTables(page);  // <-- FAILS HERE
  });

  test('diff preview appears for existing table', async ({ page }) => {
    await openDesignerForTable(page, dbName, 'people');
    await expect(page.getByTestId('ddl-diff-preview').first()).toBeVisible();
  });

  // ... more Edit Mode tests (ALL FAIL) ...
});
```

### 4.4 src/worker/db-registry.ts (Database Registry)

Key sections:

```typescript
/** OPFS root directory for SQLite editor */
const OPFS_DIR = '/wasm-sqlite-editor';
const DATABASES_SUBDIR = 'databases';
const OPFS_REGISTRY_PATH = `${OPFS_DIR}/registry.json`;

// Registry manages database entries with CRUD operations and self-healing
export class DatabaseRegistry {
  private data: RegistryData = { databases: [] };
  private storageMode: StorageMode = 'idb';
  private initialized = false;

  async init(): Promise<HealingResult> {
    const opfsAvailable = await this.adapter.isOpfsAvailable();
    this.storageMode = opfsAvailable ? 'opfs' : 'idb';
    const healingResult = await this.loadAndHeal();
    this.initialized = true;
    return healingResult;
  }
  // ...
}
```

### 4.5 src/worker/storage.ts (OPFS Path Resolution)

```typescript
export async function resolveDbPath(
  dbName: string,
  options: { allowCreate?: boolean } = {}
): Promise<{ path: string; vfsName?: string }> {
  const registry = getRegistry();
  if (!registry.isInitialized()) {
    await registry.init();
  }
  const entry = registry.getDatabaseByName(dbName);
  let storageMode = entry?.storageType ?? registry.getStorageMode();
  if (storageMode === 'opfs') {
    const availability = await checkOPFSAvailability();
    if (!availability.available) {
      storageMode = 'idb';
    } else if (!options.allowCreate) {
      const exists = await databaseExistsInOPFS(toFilename(dbName));
      if (!exists) {
        storageMode = 'idb';
      }
    }
  }
  if (storageMode === 'opfs') {
    return { path: getOPFSPath(toFilename(dbName)), vfsName: OPFS_VFS_NAME };
  }
  if (storageMode === 'idb') {
    return { path: dbName, vfsName: IDB_VFS_NAME };
  }
  return { path: dbName };
}
```

### 4.6 src/worker/handlers/registry.ts (Database Creation Handler)

```typescript
export async function handleCreateDbRequest(
  request: Extract<WorkerRequest, { type: 'createDb' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const { path, vfsName } = await resolveDbPath(request.name, { allowCreate: true });
    await openDatabase(path, vfsName, { createIfMissing: true });
    const registry = getRegistry();
    if (!registry.isInitialized()) {
      await registry.init();
    }
    await registry.registerDatabase(request.name);
    postResponse({ type: 'success' }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to create database: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}
```

### 4.7 src/core/engine/opfs-vfs.ts (OPFS VFS)

```typescript
export const OPFS_VFS_NAME = 'opfs-coop-sync';
export const IDB_VFS_NAME = 'idb-batch-atomic';

export async function checkOPFSAvailability(): Promise<OPFSAvailability> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { available: false, reason: 'navigator.storage API not available' };
  }
  if (typeof crossOriginIsolated !== 'boolean' || !crossOriginIsolated) {
    return { available: false, reason: 'crossOriginIsolated is not true' };
  }
  // ... sync access handle checks ...
}

export function getOPFSPath(dbName: string): string {
  return `/${APP_DIR}/${DATABASES_SUBDIR}/${dbName}`;
}
```

### 4.8 playwright.config.ts

```typescript
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: '**/perf/**',
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
```

---

## 5. Previous Fix Attempts

### Attempt 1: Commit 13a906a - Use base playwright test
**Change:** Switched from custom `test` fixture (with clearStorage) to `@playwright/test` directly
**Rationale:** The clearStorage fixture was clearing OPFS which caused sqlite3_open_v2 failures
**Result:** FAILED - Did not fix the issue

```diff
-import { test, expect } from './fixtures';
+import { test, expect } from '@playwright/test';
```

### Attempt 2: Commit c53974e - Use static database name
**Change:** Use single static DB_NAME instead of unique names per test
**Rationale:** Unique names caused OPFS resource exhaustion
**Result:** FAILED - Edit Mode tests still fail

```diff
-const DB_PREFIX = 'table-designer-db';
-function createDbName() { return DB_PREFIX; }
+const DB_NAME = 'table-designer-db';

-const dbName = createDbName();
-await createAndOpenDatabase(page, dbName);
+await createAndOpenDatabase(page, DB_NAME);
```

### Attempt 3: Commit 3562be1 - Wait for sidebar tables
**Change:** Added explicit wait for `item-table-people` in `setupDbWithTables()`
**Rationale:** Tables might not be visible immediately after SQL execution
**Result:** FAILED - The wait times out, tables are never created

```diff
+  // Wait for sidebar to show the created tables
+  await expandDatabaseInSidebar(page, DB_NAME);
+  await expect(page.getByTestId('item-table-people')).toBeVisible({ timeout: 10000 });
```

---

## 6. Hypotheses

### Hypothesis 1: OPFS FileSystemSyncAccessHandle Exhaustion
**Theory:** Each test opens a new database but OPFS sync handles are not properly released, causing subsequent opens to fail silently.
**Evidence:** Create Mode tests pass (new DB each time works), Edit Mode tests fail (after multiple SQL operations)
**Counter-evidence:** Using static DB_NAME didn't help

### Hypothesis 2: Worker VFS State Not Reset Between Tests
**Theory:** The wa-sqlite VFS (OPFSCoopSyncVFS) maintains internal state that is not reset between tests, causing the second test suite to fail.
**Evidence:** Edit Mode runs after Create Mode in shard 2
**Counter-evidence:** Each test runs `createAndOpenDatabase` which should create fresh connection

### Hypothesis 3: IndexedDB Registry JSON Corruption
**Theory:** The registry JSON becomes corrupted or inconsistent between tests in CI
**Evidence:** Registry self-healing logic exists suggesting this is a known issue
**Counter-evidence:** Would expect explicit errors

### Hypothesis 4: Shard Ordering Causes State Pollution
**Theory:** Something in shard 2 tests that run BEFORE table-designer pollutes the state
**Evidence:** Shard 2 runs import.spec.ts tests before table-designer tests
**Counter-evidence:** Would need to identify specific polluting test

### Hypothesis 5: Headless Chromium OPFS Limitations
**Theory:** Chromium headless has different OPFS behavior than headed mode
**Evidence:** Passes locally (headed), fails in CI (headless)
**Counter-evidence:** Would expect all OPFS tests to fail, not just Edit Mode

### Hypothesis 6: Test Isolation - Browser Context Not Fresh
**Theory:** Playwright isn't creating fresh browser contexts between tests, causing storage to persist unexpectedly
**Evidence:** Using same DB_NAME could cause collisions
**Counter-evidence:** Playwright should create new context per test by default

### Hypothesis 7: SQL Execution Succeeds But Tables Not Persisted
**Theory:** The `runSql()` calls complete without error but the SQLite changes are not actually committed to OPFS
**Evidence:** Tables never appear in sidebar despite SQL execution "succeeding"
**Counter-evidence:** Create Mode tests (which also use runSql) pass

### Hypothesis 8: Race Condition in Worker Initialization
**Theory:** After Create Mode tests, the worker is in a partially initialized state that causes Edit Mode tests to fail
**Evidence:** Sequential test execution within same process
**Counter-evidence:** Worker should be fully reinitialized each test

---

## 7. Key Questions for Oracle

### Root Cause Questions
1. **What is the EXACT root cause of this failure?** Why do Create Mode tests pass but Edit Mode tests fail?

2. **Why does shard 2 fail but local runs pass?** What is different about CI that causes this?

3. **Why does the table 'people' never appear in the sidebar?** Is the CREATE TABLE SQL being executed? Is it being persisted?

### Solution Questions
4. **How should OPFS/VFS state be properly reset between tests?** Should we force close all handles? Should we use fresh browser contexts?

5. **Should we force IndexedDB fallback in CI?** Would bypassing OPFS entirely fix this?

6. **Should each test get a fresh browser context?** Would `test.describe.configure({ mode: 'serial' })` with fresh contexts help?

### Code Change Requests
7. **Provide EXACT code changes as unified diffs** that will fix this issue with high confidence.

8. **Explain the confidence level** in your solution and any risks.

---

## 8. Additional Context

### CI Environment Details
- GitHub Actions Ubuntu runner
- Chromium headless via Playwright
- `npm run build && npm run preview` starts app
- Tests run with `playwright test --shard=2/2`
- Cross-origin isolation is enabled (required for OPFS)

### OPFS Architecture
- Uses `@journeyapps/wa-sqlite` with OPFSCoopSyncVFS
- Databases stored at `/wasm-sqlite-editor/databases/*.sqlite`
- Registry stored at `/wasm-sqlite-editor/registry.json`
- Falls back to `IDBBatchAtomicVFS` if OPFS unavailable

### Test Architecture
- `e2e/fixtures/index.ts` - Custom fixtures with auto `clearStorage`
- `e2e/helpers/app.ts` - Helper functions for common operations
- Worker communicates via `WorkerClient` in main thread
- Tests use `page.evaluate()` for OPFS operations from main thread

### What Works
- Shard 1 passes completely
- Create Mode tests in shard 2 pass
- Local execution (all tests) passes
- Import tests (shard 2) pass

### What Fails
- ALL Edit Mode tests in shard 2 fail
- Failure point is always "table not visible in sidebar"
- Retries (2 per test) do not help

---

## 9. Request for Oracle

**CRITICAL:** This is a BLOCKER issue preventing all CI passes. We need:

1. **Root cause analysis** - Exactly WHY this fails in CI shard 2 but not locally
2. **EXACT code changes as unified diffs** - Ready to apply fixes
3. **Explanation of WHY** the fix works and why previous attempts failed
4. **Confidence level** in the solution (high/medium/low)
5. **Alternative approaches** if primary fix doesn't work

Focus areas:
- OPFS/SQLite/VFS state management
- Test isolation and cleanup
- Worker lifecycle between tests
- Browser context management
- Chromium headless vs headed differences
