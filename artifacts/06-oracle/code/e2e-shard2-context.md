# E2E CI Shard 2 Failure Analysis Context

## Problem Summary

All table-designer E2E tests fail in CI shard 2 with:
```
Error: Database creation failed: Failed to open database '/wasm-sqlite-editor/databases/table-designer-db-XXX.sqlite': sqlite3_open_v2
```

Also observed:
```
[DatabaseRegistry] Failed to migrate registry: SyntaxError: Unexpected end of JSON input
```

## Environment Details

- CI: GitHub Actions, Ubuntu latest, Node 20
- Browser: Playwright Chromium
- Sharding: 2 shards (`--shard=1/2` and `--shard=2/2`)
- Tests run sequentially (`fullyParallel: false`, `workers: 1`)

## Key Observations

1. **Shard 1 PASSES** - import.spec.ts, migration.spec.ts work fine
2. **Shard 2 FAILS** - table-designer tests ALL fail
3. **Tests before table-designer in shard 2 pass** - import-export.spec.ts, multitab.spec.ts work
4. **Error is sqlite3_open_v2** - low-level SQLite file open failure
5. **Registry JSON parse error** - suggests corrupted state between tests

## File Order in Shard 2 (alphabetical)

Based on test file names, shard 2 likely includes:
- import-export.spec.ts (PASSES)
- migration.spec.ts (PASSES if in shard 2)
- multitab.spec.ts (PASSES)
- offline.spec.ts
- persistence.spec.ts
- **table-designer.spec.ts (FAILS)**
- ...and others

## Attempted Fixes (did not help)

### Fix 1: Use base playwright test (commit 13a906a)
Hypothesis: The custom fixture with OPFS cleanup was causing issues.
Result: Still fails.

### Fix 2: Use static database name (commit c53974e)
Hypothesis: Dynamic database names caused resource exhaustion.
Result: Still fails.

## Code Analysis

### table-designer.spec.ts (lines 1-30)
```typescript
import { test, expect } from '@playwright/test';
// Uses base playwright test, NOT the custom fixture

const DB_NAME = 'table-designer-db';  // Static name

async function setupEmptyDb(page: Page) {
  await createAndOpenDatabase(page, DB_NAME);  // This fails
  await waitForReady(page);
  return DB_NAME;
}
```

### e2e/fixtures/index.ts - clearStorage fixture
```typescript
export const test = base.extend<{
  clearStorage: void;
}>({
  clearStorage: [async ({ page: _page }, use) => {
    await _page.goto('/', { waitUntil: 'domcontentloaded' });
    await _page.evaluate(async () => {
      // Clears localStorage, IndexedDB, and OPFS
      if (navigator.storage?.getDirectory) {
        try {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry('sqlite-editor', { recursive: true });
          await root.removeEntry('wasm-sqlite-editor', { recursive: true });
        } catch { /* ignore */ }
      }
    });
    // Recreates OPFS directories
    await _page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const appDir = await root.getDirectoryHandle('wasm-sqlite-editor', { create: true });
      await appDir.getDirectoryHandle('databases', { create: true });
    });
    // Waits for worker to initialize
    await _page.waitForFunction(async () => {
      const api = window.__sqliteEditorTest;
      if (!api?.getRegistry) return false;
      const registry = await api.getRegistry();
      return registry !== null;
    }, { timeout: 30000 });
    await use();
  }, { auto: true }],
});
```

### e2e/helpers/app.ts - createAndOpenDatabase
```typescript
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
        // OPFS not available
      }
    }
  });
  await waitForWorkerReady(page);
  await page.getByTestId('new-database-button').click();
  // ... dialog interaction
  // Error happens during the create button click
}
```

### src/worker/db-registry.ts - loadAndHeal (lines 1289-1320)
```typescript
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
  // ...
}
```

### src/core/engine/db-engine.ts - open method
```typescript
async open(name: string, vfsName?: string, options?: {...}): Promise<void> {
  // ...
  try {
    let flags = readOnly ? SQLITE_OPEN_READONLY : SQLITE_OPEN_READWRITE;
    if (!readOnly && createIfMissing) {
      flags |= SQLITE_OPEN_CREATE;
    }
    // This is where sqlite3_open_v2 is called
    this.db = await this.sqlite3.open_v2(name, flags, vfsName);
    // ...
  } catch (err) {
    throw new Error(`Failed to open database '${name}': ${normalized.message}`);
  }
}
```

## Hypotheses

### Hypothesis 1: OPFS SyncAccessHandle Resource Exhaustion
OPFS uses FileSystemSyncAccessHandle which has limited resources per origin.
If previous tests don't properly close handles, new tests can't open new files.

Evidence:
- Tests pass individually
- Fails when run in sequence
- sqlite3_open_v2 is the failure point

### Hypothesis 2: Registry State Corruption
The registry JSON becomes corrupted when tests run in parallel or when
cleanup happens while worker is still writing.

Evidence:
- "Unexpected end of JSON input" error
- Tests that use clearStorage fixture might interrupt writes

### Hypothesis 3: Worker Singleton State
The DatabaseEngine singleton might not be fully reset between tests,
leaving stale file handles or connections.

Evidence:
- getEngine() returns a singleton
- Worker message queue chains operations sequentially
- No explicit engine reset between tests

### Hypothesis 4: OPFS Directory Handle Race Condition
Creating directories while worker is initializing could cause race conditions.

Evidence:
- Both fixture and app.ts helper create directories
- Worker also initializes VFS which creates directories
- Multiple sources of truth for directory state

## Key Code Paths

1. **Test starts** -> page.goto('/') -> Worker receives 'ready'
2. **Worker init** -> initializeVFS() -> ensureAppDirectories()
3. **Fixture clearStorage** -> Deletes OPFS directories -> Recreates them
4. **createAndOpenDatabase** -> Also creates OPFS directories (redundant)
5. **waitForWorkerReady** -> Calls getRegistry -> registry.init() -> loadAndHeal()
6. **Create button** -> Worker createDb -> resolveDbPath -> openDatabase
7. **FAILURE** -> sqlite3_open_v2 fails

## Questions for Analysis

1. What happens to open FileSystemSyncAccessHandles when OPFS directory is deleted?
2. Is the VFS properly re-initialized after OPFS cleanup?
3. Could the worker's WASM module cache stale OPFS handles?
4. Should tests wait for VFS re-initialization after OPFS cleanup?
5. Is there a race between fixture cleanup and worker initialization?

## Potential Solutions

1. **Add VFS reset** - After OPFS cleanup, signal worker to reinitialize VFS
2. **Sequential cleanup** - Ensure worker is fully stopped before cleanup
3. **Lazy VFS init** - Don't initialize VFS until first database operation
4. **Browser context isolation** - Use fresh context per test (expensive)
5. **Skip OPFS cleanup** - Just delete files, not directories
6. **Add retry logic** - Retry sqlite3_open_v2 with backoff

## CI Configuration

```yaml
e2e:
  runs-on: ubuntu-latest
  strategy:
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
