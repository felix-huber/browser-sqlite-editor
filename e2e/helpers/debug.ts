import { test, type Page, type TestInfo } from '@playwright/test';

/**
 * Debug utilities for E2E tests.
 *
 * These helpers provide structured debug output that appears in the console
 * during test runs and in the HTML report.
 *
 * Usage:
 *   import { step, debug, logPageState, logStorageState } from './helpers/debug';
 *
 *   test('my test', async ({ page }) => {
 *     await step('Creating database', async () => {
 *       // ... operations
 *     });
 *
 *     debug('Database created with ID:', dbId);
 *     await logPageState(page);
 *   });
 */

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

/**
 * Format a timestamp for debug output
 */
function timestamp(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
}

/**
 * Log a debug message with timestamp.
 * These messages appear in the console and are captured in test output.
 */
export function debug(message: string, ...args: unknown[]): void {
  const prefix = `${colors.dim}[${timestamp()}]${colors.reset} ${colors.cyan}DEBUG${colors.reset}`;
  console.log(prefix, message, ...args);
}

/**
 * Log a step start message with emphasis
 */
export function stepStart(name: string): void {
  const prefix = `${colors.dim}[${timestamp()}]${colors.reset} ${colors.blue}▶${colors.reset}`;
  console.log(`${prefix} ${colors.bright}${name}${colors.reset}`);
}

/**
 * Log a step completion message
 */
export function stepEnd(name: string, durationMs: number): void {
  const prefix = `${colors.dim}[${timestamp()}]${colors.reset} ${colors.green}✓${colors.reset}`;
  console.log(`${prefix} ${name} ${colors.dim}(${durationMs}ms)${colors.reset}`);
}

/**
 * Log a warning message
 */
export function warn(message: string, ...args: unknown[]): void {
  const prefix = `${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}WARN${colors.reset}`;
  console.log(prefix, message, ...args);
}

/**
 * Log an error message
 */
export function error(message: string, ...args: unknown[]): void {
  const prefix = `${colors.dim}[${timestamp()}]${colors.reset} ${colors.red}ERROR${colors.reset}`;
  console.log(prefix, message, ...args);
}

/**
 * Execute a step with debug output.
 * The step name and duration are logged.
 *
 * @example
 * await step('Load database', async () => {
 *   await page.goto('/');
 *   await page.click('[data-testid="load-db"]');
 * });
 */
export async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  stepStart(name);
  const start = Date.now();
  try {
    const result = await fn();
    stepEnd(name, Date.now() - start);
    return result;
  } catch (err) {
    const prefix = `${colors.dim}[${timestamp()}]${colors.reset} ${colors.red}✗${colors.reset}`;
    console.log(`${prefix} ${name} ${colors.red}FAILED${colors.reset} ${colors.dim}(${Date.now() - start}ms)${colors.reset}`);
    throw err;
  }
}

/**
 * Log the current page state for debugging.
 * Outputs URL, title, and visible text content.
 */
export async function logPageState(page: Page): Promise<void> {
  const url = page.url();
  const title = await page.title();

  debug('Page State:', {
    url,
    title,
  });
}

/**
 * Log the current storage state (localStorage, IndexedDB databases)
 */
export async function logStorageState(page: Page): Promise<void> {
  const storageInfo = await page.evaluate(async () => {
    // Get localStorage summary
    const localStorageKeys = Object.keys(localStorage);
    const localStorageSummary: Record<string, string> = {};
    localStorageKeys.slice(0, 10).forEach((key) => {
      const value = localStorage.getItem(key);
      localStorageSummary[key] = value ? (value.length > 50 ? `${value.slice(0, 50)}...` : value) : '';
    });
    if (localStorageKeys.length > 10) {
      localStorageSummary['...'] = `${localStorageKeys.length - 10} more keys`;
    }

    // List IndexedDB databases
    let idbDatabases: string[] = [];
    try {
      const dbs = await indexedDB.databases();
      idbDatabases = dbs.map((db) => db.name || 'unnamed').filter(Boolean);
    } catch {
      idbDatabases = ['(indexedDB.databases() not supported)'];
    }

    // Check OPFS availability
    let opfsAvailable = false;
    try {
      opfsAvailable = !!(navigator.storage && 'getDirectory' in navigator.storage);
    } catch {
      // OPFS not available
    }

    return {
      localStorage: localStorageSummary,
      localStorageKeyCount: localStorageKeys.length,
      indexedDBDatabases: idbDatabases,
      opfsAvailable,
    };
  });

  debug('Storage State:', storageInfo);
}

/**
 * Log the database registry contents
 */
export async function logRegistryState(page: Page): Promise<void> {
  const registry = await page.evaluate(async () => {
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
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

      const tx = db.transaction('registry', 'readonly');
      const store = tx.objectStore('registry');

      const result = await new Promise<{ key: string; data: { databases: unknown[] } } | undefined>(
        (resolve, reject) => {
          const req = store.get('registry');
          req.onsuccess = () =>
            resolve(req.result as { key: string; data: { databases: unknown[] } } | undefined);
          req.onerror = () => reject(req.error);
        }
      );

      db.close();

      if (result?.data?.databases) {
        return {
          count: result.data.databases.length,
          databases: result.data.databases,
        };
      }
      return { count: 0, databases: [] };
    } catch {
      return { count: 0, databases: [], error: 'Failed to read registry' };
    }
  });

  debug('Registry State:', registry);
}

/**
 * Log visible elements matching a selector
 */
export async function logVisibleElements(page: Page, selector: string): Promise<void> {
  const elements = await page.locator(selector).all();
  const visibleInfo = await Promise.all(
    elements.map(async (el, i) => {
      const visible = await el.isVisible();
      const text = visible ? await el.textContent() : null;
      return { index: i, visible, text: text?.slice(0, 50) };
    })
  );

  debug(`Elements matching "${selector}":`, visibleInfo.filter((e) => e.visible));
}

/**
 * Log any console errors from the page
 */
export function setupConsoleErrorLogging(page: Page): void {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      error('Browser console error:', msg.text());
    }
  });

  page.on('pageerror', (err) => {
    error('Page error:', err.message);
  });
}

/**
 * Wait for a condition with progress logging
 */
export async function waitFor(
  description: string,
  condition: () => Promise<boolean>,
  timeoutMs = 10000,
  intervalMs = 100
): Promise<void> {
  stepStart(`Waiting for: ${description}`);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      stepEnd(`Wait: ${description}`, Date.now() - start);
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  error(`Timeout waiting for: ${description} (${timeoutMs}ms)`);
  throw new Error(`Timeout waiting for: ${description}`);
}

/**
 * Decorator for test functions that adds automatic debug setup
 */
export function withDebug(
  testFn: (args: { page: Page; testInfo: TestInfo }) => Promise<void>
): (args: { page: Page; testInfo: TestInfo }) => Promise<void> {
  return async ({ page, testInfo }) => {
    setupConsoleErrorLogging(page);
    debug(`Starting test: ${testInfo.title}`);
    const start = Date.now();

    try {
      await testFn({ page, testInfo });
      debug(`Test passed: ${testInfo.title} (${Date.now() - start}ms)`);
    } catch (err) {
      error(`Test failed: ${testInfo.title} (${Date.now() - start}ms)`);
      await logPageState(page);
      await logStorageState(page);
      throw err;
    }
  };
}
