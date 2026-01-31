# E2E OPFS Isolation Fix - Oracle Consultation Context

## Problem Statement

E2E shard 2 consistently fails with sqlite3_open_v2 errors for ALL table-designer tests in CI. The tests pass locally and in shard 1, but fail when run sequentially in shard 2 after other tests.

## Error Details

### Primary Error
```
Error: Database creation failed: Failed to open database '/wasm-sqlite-editor/databases/table-designer-db-XXX.sqlite': sqlite3_open_v2
```

### Secondary Error (Registry Corruption)
```
[DatabaseRegistry] Failed to migrate registry: SyntaxError: Unexpected end of JSON input
```

## Environment

- **CI**: GitHub Actions, Ubuntu latest, Node 20
- **Browser**: Playwright Chromium (headless)
- **Sharding**: 2 shards (`--shard=1/2` and `--shard=2/2`)
- **Test Config**: Sequential (`fullyParallel: false`, `workers: 1`, `retries: 2`)
- **Storage**: OPFS primary, IndexedDB fallback

## Relevant Code Sections

### 1. Test Fixtures (`e2e/fixtures/index.ts`)

The clearStorage fixture attempts to clean OPFS/IDB before each test:

```typescript
export const test = base.extend<{
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
```

### 2. Test Helper (`e2e/helpers/app.ts` - `createAndOpenDatabase`)

```typescript
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
  // ... rest of function
}
```

### 3. Failing Tests (`e2e/table-designer.spec.ts`)

```typescript
import { test, expect } from '@playwright/test';
// NOTE: Uses base playwright test, NOT the custom fixture with clearStorage

const DB_NAME = 'table-designer-db';

async function setupEmptyDb(page: Page) {
  await createAndOpenDatabase(page, DB_NAME);  // <-- This fails
  await waitForReady(page);
  return DB_NAME;
}

test.describe('Table Designer - Create Mode', () => {
  let dbName = '';
  test.beforeEach(async ({ page }) => {
    dbName = await setupEmptyDb(page);
    await openDesigner(page);
  });
  // ... tests
});
```

### 4. Database Registry (`src/worker/db-registry.ts`)

The registry manages database metadata with self-healing:

```typescript
async init(): Promise<HealingResult> {
  const opfsAvailable = await this.adapter.isOpfsAvailable();
  this.storageMode = opfsAvailable ? 'opfs' : 'idb';
  const healingResult = await this.loadAndHeal();
  this.initialized = true;
  return healingResult;
}

private async loadAndHeal(): Promise<HealingResult> {
  // ... migration logic

  // Load registry data
  try {
    const rawData = await this.adapter.readRegistry(this.storageMode);
    if (rawData) {
      this.data = rawData;
    } else {
      this.data = { databases: [] };
    }
  } catch {
    // JSON parse error or other corruption
    result.wasCorrupted = true;
    this.data = { databases: [] };
  }
  // ... self-healing continues
}
```

### 5. Storage Path Resolution (`src/worker/storage.ts`)

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
  // ...
}
```

## Previous Fix Attempts

### Attempt 1: Use Base Playwright Test (commit 13a906a)
**Hypothesis**: The custom fixture with OPFS cleanup was causing issues.
**Change**: Switched table-designer.spec.ts to use `@playwright/test` instead of custom fixture.
**Result**: STILL FAILS. The issue persists even without the clearStorage fixture.

### Attempt 2: Use Static Database Name (commit c53974e)
**Hypothesis**: Dynamic database names (with random suffixes) caused OPFS resource exhaustion.
**Change**: Changed to static `table-designer-db` name shared across all tests.
**Result**: STILL FAILS. Same sqlite3_open_v2 error.

### Attempt 3: Add OPFS Directory Recreation in Helper
**Hypothesis**: OPFS directories might be deleted by fixtures and not recreated.
**Change**: Added directory recreation in `createAndOpenDatabase()`.
**Result**: STILL FAILS.

## Key Observations

1. **Shard 1 PASSES**: Tests like import.spec.ts, migration.spec.ts work fine
2. **Shard 2 FAILS**: Only table-designer tests fail (ALL of them)
3. **Earlier tests in shard 2 pass**: import-export.spec.ts, multitab.spec.ts work
4. **Error is sqlite3_open_v2**: Low-level SQLite file open failure
5. **Registry JSON parse error**: "Unexpected end of JSON input" suggests corrupted state
6. **Tests pass locally**: Only fails in CI with sharding
7. **designer.spec.ts uses custom fixture, table-designer.spec.ts does not**: Both have issues

## Hypotheses

### H1: OPFS FileSystemSyncAccessHandle Resource Exhaustion
OPFS uses FileSystemSyncAccessHandle which has limited resources per origin. If previous tests don't properly close handles, new tests can't open new files.

**Evidence**:
- Tests pass individually
- Fails when run in sequence
- sqlite3_open_v2 is the failure point
- Works in shard 1 but not shard 2 (different test mix)

### H2: Worker/VFS State Not Reset Between Tests
The WASM SQLite module and VFS maintain state that isn't properly cleared between tests. The worker uses singletons (getEngine(), getRegistry()) that may hold stale references.

**Evidence**:
- Registry JSON corruption suggests ongoing writes during cleanup
- Worker message queue chains operations sequentially
- No explicit engine reset mechanism between tests

### H3: Race Condition Between Page Navigation and Worker State
When page.goto('/') is called, the worker may still be processing operations from the previous test. The new page loads before the worker is ready.

**Evidence**:
- Multiple sources of directory creation (fixture, helper, worker)
- waitForWorkerReady() only checks registry, not VFS state
- OPFS handles may be locked from previous test

### H4: OPFS Directory Handle Inheritance Across Page Loads
Chromium may cache OPFS directory handles across page navigations within the same browser context, causing conflicts when directories are deleted and recreated.

**Evidence**:
- Same browser context used across tests (Playwright default)
- Directory deletion silently fails with "ignore locked dirs"
- VFS may hold stale handles

## Key Question

**What structural fix is needed to ensure OPFS/IDB state is properly isolated between tests?**

Specifically:
1. Should tests use fresh browser contexts?
2. Should the worker expose a "reset" command that closes all handles?
3. Is there a way to wait for OPFS handles to be released?
4. Should we switch to IDB-only mode for E2E tests?
5. Is there a race condition in the VFS initialization that needs synchronization?

## File Relationships

```
Test Flow:
  page.goto('/')
    -> App.tsx loads
    -> Worker initializes
    -> VFS registers
    -> Registry loads (with self-healing)

  createAndOpenDatabase()
    -> page.evaluate() creates OPFS dirs (main thread)
    -> waitForWorkerReady() polls getRegistry()
    -> Worker: createDb -> resolveDbPath -> sqlite3_open_v2
    -> FAILURE at sqlite3_open_v2 (can't open file)

Storage Layers:
  1. OPFS (preferred): /wasm-sqlite-editor/databases/*.sqlite
  2. IndexedDB (fallback): idb-batch-atomic database
  3. Registry: /wasm-sqlite-editor/registry.json (OPFS) or sqlite-editor-registry (IDB)
```

## CI Configuration

```yaml
e2e:
  runs-on: ubuntu-latest
  strategy:
    fail-fast: false
    matrix:
      shard: [1, 2]
  steps:
    - run: npm run test:e2e -- --shard=${{ matrix.shard }}/2
```

Playwright config:
```typescript
{
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
}
```

## Desired Outcome

A fix that:
1. Ensures complete OPFS/IDB isolation between tests
2. Works reliably in CI with sharding
3. Doesn't significantly increase test runtime
4. Is maintainable and doesn't require changes to every test file
