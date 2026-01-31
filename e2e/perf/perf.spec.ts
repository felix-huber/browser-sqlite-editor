/**
 * Performance & Memory Regression Test Suite
 *
 * Chromium-only tests using Chrome DevTools Protocol (CDP) for:
 * - Import heap sampling (100MB fixture, peak <= 250MB)
 * - Export memory (no OOM)
 * - Trace + metrics artifacts for CI
 *
 * Run with: npm run test:perf -- --project=chromium
 */

import { test, expect, type Page, type CDPSession } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Configuration - per acceptance criteria
// =============================================================================

const THRESHOLDS = {
  /** Maximum peak heap during 100MB import (MB) - per acceptance criteria */
  IMPORT_PEAK_HEAP_MB: 250,
  /** Maximum peak heap during export (MB) */
  EXPORT_PEAK_HEAP_MB: 500,
};

const FIXTURE_SIZES = {
  SMALL_MB: 10,
  LARGE_MB: 100,
};

const RESULTS_DIR = path.join(__dirname, 'results');

// =============================================================================
// Types
// =============================================================================

interface HeapSample {
  timestamp: number;
  usedHeapSizeMB: number;
  totalHeapSizeMB: number;
}

interface PerfResult {
  timestamp: string;
  test: string;
  peakHeapMB: number;
  threshold: number;
  passed: boolean;
  samples: HeapSample[];
  fixtureSizeMB: number;
}

// =============================================================================
// Helpers
// =============================================================================

function ensureResultsDir(): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

function saveResult(result: PerfResult): void {
  ensureResultsDir();
  const filename = `${result.test}-${Date.now()}.json`;
  fs.writeFileSync(path.join(RESULTS_DIR, filename), JSON.stringify(result, null, 2));
}

function saveTrace(traceName: string, traceData: unknown): void {
  ensureResultsDir();
  fs.writeFileSync(path.join(RESULTS_DIR, `${traceName}-trace.json`), JSON.stringify(traceData));
}

/**
 * Create a CDP session and start heap profiler sampling
 */
async function startHeapSampling(page: Page): Promise<{ client: CDPSession; samples: HeapSample[] }> {
  const client = await page.context().newCDPSession(page);
  const samples: HeapSample[] = [];

  await client.send('HeapProfiler.enable');
  await client.send('Performance.enable');

  // Collect baseline
  await client.send('HeapProfiler.collectGarbage');
  const baselineMetrics = await client.send('Performance.getMetrics');
  const baselineUsed = baselineMetrics.metrics.find((m) => m.name === 'JSHeapUsedSize')?.value || 0;
  const baselineTotal = baselineMetrics.metrics.find((m) => m.name === 'JSHeapTotalSize')?.value || 0;

  samples.push({
    timestamp: Date.now(),
    usedHeapSizeMB: baselineUsed / (1024 * 1024),
    totalHeapSizeMB: baselineTotal / (1024 * 1024),
  });

  return { client, samples };
}

/**
 * Sample heap during operation (call periodically)
 */
async function sampleHeap(client: CDPSession, samples: HeapSample[]): Promise<void> {
  const metrics = await client.send('Performance.getMetrics');
  const used = metrics.metrics.find((m) => m.name === 'JSHeapUsedSize')?.value || 0;
  const total = metrics.metrics.find((m) => m.name === 'JSHeapTotalSize')?.value || 0;

  samples.push({
    timestamp: Date.now(),
    usedHeapSizeMB: used / (1024 * 1024),
    totalHeapSizeMB: total / (1024 * 1024),
  });
}

/**
 * Stop heap sampling and return peak usage
 */
async function stopHeapSampling(
  client: CDPSession,
  samples: HeapSample[]
): Promise<{ peakHeapMB: number; samples: HeapSample[] }> {
  // Final sample after GC
  await client.send('HeapProfiler.collectGarbage');
  await sampleHeap(client, samples);

  await client.send('HeapProfiler.disable');
  await client.send('Performance.disable');
  await client.detach();

  const peakHeapMB = Math.max(...samples.map((s) => s.usedHeapSizeMB));
  return { peakHeapMB, samples };
}

/**
 * Sample heap concurrently while an async operation runs.
 * This is critical for catching peak memory during long-running browser operations.
 * Samples every intervalMs, targeting minSamples during the operation.
 */
async function sampleHeapDuring<T>(
  client: CDPSession,
  samples: HeapSample[],
  operation: Promise<T>,
  intervalMs = 50,
  minSamples = 20
): Promise<T> {
  let samplingActive = true;
  let sampleCount = 0;

  // Start concurrent sampling loop
  const samplingLoop = (async () => {
    while (samplingActive) {
      await sampleHeap(client, samples);
      sampleCount++;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  })();

  try {
    // Run the operation
    const result = await operation;

    // Ensure minimum samples even if operation was fast
    while (sampleCount < minSamples && samplingActive) {
      await sampleHeap(client, samples);
      sampleCount++;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return result;
  } finally {
    samplingActive = false;
    // Let the sampling loop finish its current iteration
    await samplingLoop.catch(() => {});
  }
}

/**
 * Start Chrome tracing for detailed timeline (returns client with handler already attached)
 */
async function startTracingWithHandler(page: Page): Promise<{ client: CDPSession; traceChunks: unknown[] }> {
  const client = await page.context().newCDPSession(page);
  const traceChunks: unknown[] = [];

  // Attach handler BEFORE starting tracing to avoid missing events
  client.on('Tracing.dataCollected', (event) => {
    traceChunks.push(...(event.value as unknown[]));
  });

  await client.send('Tracing.start', {
    traceConfig: {
      includedCategories: ['devtools.timeline', 'v8.execute', 'blink.user_timing', 'v8.gc'],
      excludedCategories: ['*'],
    },
  });

  return { client, traceChunks };
}

/**
 * Stop tracing and return trace events
 */
async function stopTracing(client: CDPSession, traceChunks: unknown[]): Promise<unknown[]> {
  await client.send('Tracing.end');

  await new Promise<void>((resolve) => {
    client.once('Tracing.tracingComplete', () => resolve());
  });

  await client.detach();
  return traceChunks;
}

/**
 * Clear all storage for clean test state
 */
async function clearAllStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear();

    const deleteIdb = (name: string): Promise<void> => {
      return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    };

    await deleteIdb('sqlite-editor-registry');
    await deleteIdb('idb-sqlite');

    try {
      if (navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        try {
          await root.removeEntry('sqlite-editor', { recursive: true });
        } catch {
          /* ignore */
        }
        try {
          await root.removeEntry('wasm-sqlite-editor', { recursive: true });
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  });
}

// =============================================================================
// Tests
// =============================================================================

test.describe.serial('Performance & Memory Regression', () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP heap sampling requires Chromium');

    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('import 10MB fixture: heap sampling baseline', async ({ page }) => {
    const sizeMB = FIXTURE_SIZES.SMALL_MB;

    // Start heap sampling
    const { client: heapClient, samples } = await startHeapSampling(page);

    // Start tracing with handler attached before tracing starts
    const { client: traceClient, traceChunks } = await startTracingWithHandler(page);

    // Sample heap DURING the import operation by running sampling concurrently
    const importResult = await sampleHeapDuring(
      heapClient,
      samples,
      page.evaluate(
        async ({ sizeMB: size }) => {
          const pageSize = 4096;
          const totalBytes = size * 1024 * 1024;
          const numPages = Math.ceil(totalBytes / pageSize);
          const bytes = new Uint8Array(numPages * pageSize);

          // SQLite header
          const magic = 'SQLite format 3\0';
          for (let i = 0; i < magic.length; i++) {
            bytes[i] = magic.charCodeAt(i);
          }
          bytes[16] = (pageSize >> 8) & 0xff;
          bytes[17] = pageSize & 0xff;
          bytes[18] = 0x01;
          bytes[19] = 0x01;
          bytes[21] = 0x40;
          bytes[22] = 0x20;
          bytes[23] = 0x20;
          bytes[28] = (numPages >> 24) & 0xff;
          bytes[29] = (numPages >> 16) & 0xff;
          bytes[30] = (numPages >> 8) & 0xff;
          bytes[31] = numPages & 0xff;
          bytes[43] = 0x01;
          bytes[47] = 0x04;
          bytes[59] = 0x01;
          bytes[100] = 0x0d;
          bytes[105] = 0x10;

          const startMs = performance.now();

          // Simulate import to IDB
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('idb-sqlite', 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = (event) => {
              const database = (event.target as IDBOpenDBRequest).result;
              if (!database.objectStoreNames.contains('databases')) {
                database.createObjectStore('databases', { keyPath: 'name' });
              }
            };
          });

          const tx = db.transaction('databases', 'readwrite');
          const store = tx.objectStore('databases');
          await new Promise<void>((resolve, reject) => {
            const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
            const req = store.put({
              name: `perf-test-${size}mb`,
              blob,
              updatedAt: new Date().toISOString(),
            });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
          db.close();

          return { timeMs: performance.now() - startMs, sizeBytes: bytes.length };
        },
        { sizeMB }
      ),
      50, // sample every 50ms
      10 // minimum 10 samples
    );

    // Stop sampling
    const { peakHeapMB } = await stopHeapSampling(heapClient, samples);

    // Stop tracing
    const traceEvents = await stopTracing(traceClient, traceChunks);
    saveTrace(`import-${sizeMB}mb`, { traceEvents });

    // Save result
    const result: PerfResult = {
      timestamp: new Date().toISOString(),
      test: `import-${sizeMB}mb`,
      peakHeapMB,
      threshold: THRESHOLDS.IMPORT_PEAK_HEAP_MB,
      passed: peakHeapMB <= THRESHOLDS.IMPORT_PEAK_HEAP_MB,
      samples,
      fixtureSizeMB: sizeMB,
    };
    saveResult(result);

    console.log(`Import ${sizeMB}MB: peak heap = ${peakHeapMB.toFixed(2)}MB, time = ${importResult.timeMs.toFixed(0)}ms`);
    expect(peakHeapMB).toBeLessThanOrEqual(THRESHOLDS.IMPORT_PEAK_HEAP_MB);
  });

  test('import 100MB fixture: peak JS heap <= 250MB', async ({ page }) => {
    test.setTimeout(120000); // 2 min timeout for large fixture

    const sizeMB = FIXTURE_SIZES.LARGE_MB;

    // Start heap sampling
    const { client: heapClient, samples } = await startHeapSampling(page);

    // Start tracing with handler attached before tracing starts
    const { client: traceClient, traceChunks } = await startTracingWithHandler(page);

    // Sample heap DURING the import operation by running sampling concurrently
    const importResult = await sampleHeapDuring(
      heapClient,
      samples,
      page.evaluate(
        async ({ sizeMB: size }) => {
          const pageSize = 4096;
          const totalBytes = size * 1024 * 1024;
          const numPages = Math.ceil(totalBytes / pageSize);

          // Generate in chunks to avoid single large allocation
          const chunkSize = 10 * 1024 * 1024; // 10MB chunks
          const chunks: Uint8Array[] = [];
          let remaining = totalBytes;
          let isFirst = true;

          while (remaining > 0) {
            const thisChunkSize = Math.min(chunkSize, remaining);
            const chunk = new Uint8Array(thisChunkSize);

            if (isFirst) {
              // SQLite header in first chunk
              const magic = 'SQLite format 3\0';
              for (let i = 0; i < magic.length; i++) {
                chunk[i] = magic.charCodeAt(i);
              }
              chunk[16] = (pageSize >> 8) & 0xff;
              chunk[17] = pageSize & 0xff;
              chunk[18] = 0x01;
              chunk[19] = 0x01;
              chunk[21] = 0x40;
              chunk[22] = 0x20;
              chunk[23] = 0x20;
              chunk[28] = (numPages >> 24) & 0xff;
              chunk[29] = (numPages >> 16) & 0xff;
              chunk[30] = (numPages >> 8) & 0xff;
              chunk[31] = numPages & 0xff;
              chunk[43] = 0x01;
              chunk[47] = 0x04;
              chunk[59] = 0x01;
              chunk[100] = 0x0d;
              chunk[105] = 0x10;
              isFirst = false;
            }

            chunks.push(chunk);
            remaining -= thisChunkSize;
          }

          const startMs = performance.now();

          // Import to IDB
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('idb-sqlite', 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = (event) => {
              const database = (event.target as IDBOpenDBRequest).result;
              if (!database.objectStoreNames.contains('databases')) {
                database.createObjectStore('databases', { keyPath: 'name' });
              }
            };
          });

          const tx = db.transaction('databases', 'readwrite');
          const store = tx.objectStore('databases');
          await new Promise<void>((resolve, reject) => {
            const blob = new Blob(chunks, { type: 'application/x-sqlite3' });
            const req = store.put({
              name: `perf-test-${size}mb`,
              blob,
              updatedAt: new Date().toISOString(),
            });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
          db.close();

          // Clear chunks to allow GC
          chunks.length = 0;

          return { timeMs: performance.now() - startMs, sizeBytes: totalBytes };
        },
        { sizeMB }
      ),
      50, // sample every 50ms
      30 // minimum 30 samples for 100MB operation
    );

    // Stop sampling
    const { peakHeapMB } = await stopHeapSampling(heapClient, samples);

    // Stop tracing
    const traceEvents = await stopTracing(traceClient, traceChunks);
    saveTrace(`import-${sizeMB}mb`, { traceEvents });

    // Save result
    const result: PerfResult = {
      timestamp: new Date().toISOString(),
      test: `import-${sizeMB}mb`,
      peakHeapMB,
      threshold: THRESHOLDS.IMPORT_PEAK_HEAP_MB,
      passed: peakHeapMB <= THRESHOLDS.IMPORT_PEAK_HEAP_MB,
      samples,
      fixtureSizeMB: sizeMB,
    };
    saveResult(result);

    console.log(
      `Import ${sizeMB}MB: peak heap = ${peakHeapMB.toFixed(2)}MB (threshold: ${THRESHOLDS.IMPORT_PEAK_HEAP_MB}MB), time = ${importResult.timeMs.toFixed(0)}ms`
    );

    // CRITICAL: This is the main acceptance criterion
    expect(peakHeapMB).toBeLessThanOrEqual(THRESHOLDS.IMPORT_PEAK_HEAP_MB);
  });

  test('export large DB: no OOM', async ({ page }) => {
    test.setTimeout(120000);

    // First import a 100MB fixture
    const sizeMB = FIXTURE_SIZES.LARGE_MB;
    await page.evaluate(
      async ({ sizeMB: size }) => {
        const pageSize = 4096;
        const totalBytes = size * 1024 * 1024;
        const numPages = Math.ceil(totalBytes / pageSize);
        const bytes = new Uint8Array(numPages * pageSize);

        const magic = 'SQLite format 3\0';
        for (let i = 0; i < magic.length; i++) {
          bytes[i] = magic.charCodeAt(i);
        }
        bytes[16] = (pageSize >> 8) & 0xff;
        bytes[17] = pageSize & 0xff;
        bytes[18] = 0x01;
        bytes[19] = 0x01;
        bytes[21] = 0x40;
        bytes[22] = 0x20;
        bytes[23] = 0x20;
        bytes[28] = (numPages >> 24) & 0xff;
        bytes[29] = (numPages >> 16) & 0xff;
        bytes[30] = (numPages >> 8) & 0xff;
        bytes[31] = numPages & 0xff;
        bytes[43] = 0x01;
        bytes[47] = 0x04;
        bytes[59] = 0x01;
        bytes[100] = 0x0d;
        bytes[105] = 0x10;

        // Store in registry
        const registryDb = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('sqlite-editor-registry', 1);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve(req.result);
          req.onupgradeneeded = (event) => {
            const database = (event.target as IDBOpenDBRequest).result;
            if (!database.objectStoreNames.contains('registry')) {
              database.createObjectStore('registry', { keyPath: 'key' });
            }
          };
        });

        const dbName = 'export-test-db';
        const id = `${Date.now().toString(36)}-export`;

        const tx = registryDb.transaction('registry', 'readwrite');
        const store = tx.objectStore('registry');
        await new Promise<void>((resolve, reject) => {
          const req = store.put({
            key: 'registry',
            data: {
              databases: [
                {
                  id,
                  name: dbName,
                  storageType: 'idb',
                  createdAt: new Date().toISOString(),
                  lastOpenedAt: new Date().toISOString(),
                },
              ],
            },
          });
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        registryDb.close();

        // Store in idb-sqlite
        const sqliteDb = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('idb-sqlite', 1);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve(req.result);
          req.onupgradeneeded = (event) => {
            const database = (event.target as IDBOpenDBRequest).result;
            if (!database.objectStoreNames.contains('databases')) {
              database.createObjectStore('databases', { keyPath: 'name' });
            }
          };
        });

        const sqliteTx = sqliteDb.transaction('databases', 'readwrite');
        const sqliteStore = sqliteTx.objectStore('databases');
        await new Promise<void>((resolve, reject) => {
          const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
          const req = sqliteStore.put({
            name: dbName,
            blob,
            updatedAt: new Date().toISOString(),
          });
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        sqliteDb.close();

        return { sizeBytes: bytes.length };
      },
      { sizeMB }
    );

    // Start heap sampling for export
    const { client: heapClient, samples } = await startHeapSampling(page);
    const { client: traceClient, traceChunks } = await startTracingWithHandler(page);

    // Sample heap DURING the export operation by running sampling concurrently
    const exportResult = await sampleHeapDuring(
      heapClient,
      samples,
      page.evaluate(async () => {
        const startMs = performance.now();

        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('idb-sqlite', 1);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve(req.result);
        });

        const tx = db.transaction('databases', 'readonly');
        const store = tx.objectStore('databases');

        const data = await new Promise<{ blob: Blob } | undefined>((resolve, reject) => {
          const req = store.get('export-test-db');
          req.onsuccess = () => resolve(req.result as { blob: Blob } | undefined);
          req.onerror = () => reject(req.error);
        });

        if (!data) {
          throw new Error('Database not found');
        }

        // Read the blob to simulate export
        const arrayBuffer = await data.blob.arrayBuffer();
        db.close();

        return { timeMs: performance.now() - startMs, sizeBytes: arrayBuffer.byteLength };
      }),
      50, // sample every 50ms
      20 // minimum 20 samples
    );

    const { peakHeapMB } = await stopHeapSampling(heapClient, samples);
    const traceEvents = await stopTracing(traceClient, traceChunks);
    saveTrace('export-large', { traceEvents });

    const result: PerfResult = {
      timestamp: new Date().toISOString(),
      test: 'export-large',
      peakHeapMB,
      threshold: THRESHOLDS.EXPORT_PEAK_HEAP_MB,
      passed: peakHeapMB <= THRESHOLDS.EXPORT_PEAK_HEAP_MB,
      samples,
      fixtureSizeMB: sizeMB,
    };
    saveResult(result);

    console.log(
      `Export ${sizeMB}MB: peak heap = ${peakHeapMB.toFixed(2)}MB, time = ${exportResult.timeMs.toFixed(0)}ms`
    );

    // Export should not OOM (stay under threshold)
    expect(peakHeapMB).toBeLessThanOrEqual(THRESHOLDS.EXPORT_PEAK_HEAP_MB);
  });

  test('results summary: verify all metrics', async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP required');

    ensureResultsDir();

    // List all result files
    const files = fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json') && !f.includes('trace'));

    if (files.length === 0) {
      console.log('No performance results found - this is the first run');
      return;
    }

    console.log('\n=== Performance Test Summary ===\n');

    let allPassed = true;
    const failures: string[] = [];

    for (const file of files) {
      try {
        const result: PerfResult = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf-8'));
        const status = result.passed ? 'PASS' : 'FAIL';
        console.log(
          `${result.test}: peak=${result.peakHeapMB.toFixed(2)}MB threshold=${result.threshold}MB [${status}]`
        );

        if (!result.passed) {
          allPassed = false;
          failures.push(`${result.test} (${result.peakHeapMB.toFixed(2)}MB > ${result.threshold}MB)`);
        }
      } catch {
        // Skip invalid files
      }
    }

    console.log('\n================================\n');

    // Fail the summary test if any threshold was violated
    expect(allPassed, `Threshold violations: ${failures.join(', ')}`).toBe(true);
  });
});
