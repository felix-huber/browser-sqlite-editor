/**
 * Tests for App component bug fixes
 *
 * Covers:
 * - BASE_URL usage for sakila.db fetch
 * - Test API methods (closeDatabase, resetStore, hasActiveDatabase)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// BASE_URL Tests (Fix #2)
// =============================================================================

describe('App - BASE_URL for static assets', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('should use BASE_URL when fetching sakila.db', async () => {
    // Mock BASE_URL
    vi.stubEnv('BASE_URL', '/custom-path/');

    let _fetchedUrl: string | undefined;
    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      _fetchedUrl = url.toString();
      return Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test'], { type: 'application/x-sqlite3' })),
      });
    });
    globalThis.fetch = mockFetch;

    // Import the code that uses BASE_URL
    // The actual App component uses import.meta.env.BASE_URL which Vite injects
    // We verify the pattern is correct by checking the source code
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const appPath = resolve(__dirname, '../App.tsx');
    const appContent = readFileSync(appPath, 'utf-8');

    // Verify the fetch uses BASE_URL template string
    expect(appContent).toContain('`${import.meta.env.BASE_URL}sakila.db`');

    // Verify it's NOT using a hardcoded path
    expect(appContent).not.toMatch(/fetch\s*\(\s*['"]\/sakila\.db['"]\s*\)/);
  });

  it('should not hardcode absolute path for sakila.db', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const appPath = resolve(__dirname, '../App.tsx');
    const appContent = readFileSync(appPath, 'utf-8');

    // Verify no hardcoded /sakila.db fetch (the bug)
    // The correct pattern is `${import.meta.env.BASE_URL}sakila.db`
    const hardcodedPattern = /await\s+fetch\s*\(\s*['"]\/sakila\.db['"]\s*\)/;
    expect(appContent).not.toMatch(hardcodedPattern);
  });

  it('should use BASE_URL interpolation in handleOpenSample', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const appPath = resolve(__dirname, '../App.tsx');
    const appContent = readFileSync(appPath, 'utf-8');

    // Find the handleOpenSample function and verify it uses BASE_URL
    const handleOpenSampleMatch = appContent.match(
      /const handleOpenSample\s*=\s*useCallback\s*\(\s*async\s*\(\s*\)\s*=>\s*\{[\s\S]*?fetch\s*\([^)]+\)/
    );
    expect(handleOpenSampleMatch).not.toBeNull();
    expect(handleOpenSampleMatch![0]).toContain('import.meta.env.BASE_URL');
  });
});

// =============================================================================
// Test API Methods Tests (Fix #6)
// =============================================================================

describe('App - Test API methods', () => {
  it('should expose test API methods on window for localhost', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const appPath = resolve(__dirname, '../App.tsx');
    const appContent = readFileSync(appPath, 'utf-8');

    // Verify TestApi type definition includes all required methods
    expect(appContent).toContain('closeDatabase: () => Promise<void>');
    expect(appContent).toContain('resetStore: () => void');
    expect(appContent).toContain('hasActiveDatabase: () => boolean');
  });

  it('should implement closeDatabase method correctly', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const appPath = resolve(__dirname, '../App.tsx');
    const appContent = readFileSync(appPath, 'utf-8');

    // Verify closeDatabase calls closeDb from store
    expect(appContent).toContain('closeDatabase: async () => {');
    expect(appContent).toMatch(/closeDatabase[\s\S]*?closeDb\(\)/);
  });

  it('should implement resetStore method correctly', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const appPath = resolve(__dirname, '../App.tsx');
    const appContent = readFileSync(appPath, 'utf-8');

    // Verify resetStore calls reset on the store
    expect(appContent).toContain('resetStore: () => {');
    expect(appContent).toContain('useDatabaseStore.getState().reset()');
  });

  it('should implement hasActiveDatabase method correctly', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const appPath = resolve(__dirname, '../App.tsx');
    const appContent = readFileSync(appPath, 'utf-8');

    // Verify hasActiveDatabase checks activeDbId
    expect(appContent).toContain('hasActiveDatabase: () => {');
    expect(appContent).toContain('useDatabaseStore.getState().activeDbId !== null');
  });

  it('should only expose test API for localhost/automation', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const appPath = resolve(__dirname, '../App.tsx');
    const appContent = readFileSync(appPath, 'utf-8');

    // Verify there are checks for localhost/automation before exposing
    expect(appContent).toMatch(/isLocalhost|isAutomation/);
    expect(appContent).toContain("hostname === 'localhost'");
    expect(appContent).toContain('navigator.webdriver');
  });
});
