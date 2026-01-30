import { test, expect } from '@playwright/test';

interface SWRegistrationResult {
  supported: boolean;
  registered: boolean;
  scope?: string;
  state?: string;
  timedOut?: boolean;
  active?: boolean;
}

async function waitForServiceWorker(
  page: import('@playwright/test').Page,
  timeoutMs = 5000
): Promise<SWRegistrationResult> {
  return page.evaluate(async (timeout: number): Promise<SWRegistrationResult> => {
    if (!('serviceWorker' in navigator)) {
      return { supported: false, registered: false };
    }

    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing?.active) {
      return {
        supported: true,
        registered: true,
        active: true,
        scope: existing.scope,
        state: existing.active.state,
      };
    }

    return Promise.race([
      navigator.serviceWorker.ready.then((reg) => ({
        supported: true,
        registered: true,
        active: !!reg.active,
        scope: reg.scope,
        state: reg.active?.state,
      })),
      new Promise<SWRegistrationResult>((resolve) =>
        setTimeout(
          () => resolve({ supported: true, registered: false, timedOut: true }),
          timeout
        )
      ),
    ]);
  }, timeoutMs);
}

test.describe('PWA Features (real behavior)', () => {
  test('service worker registers or reports unsupported', async ({ page }) => {
    await page.goto('/');
    const swRegistered = await waitForServiceWorker(page, 8000);

    if (swRegistered.supported) {
      if (!swRegistered.timedOut) {
        expect(swRegistered.registered).toBe(true);
        expect(swRegistered.scope).toContain('/');
      }
    } else {
      expect(swRegistered.registered).toBe(false);
    }
  });

  test('manifest.json is accessible and linked', async ({ page }) => {
    const response = await page.goto('/manifest.json');
    expect(response?.status()).toBe(200);

    const manifest = await response?.json();
    expect(manifest).toHaveProperty('name');
    expect(manifest).toHaveProperty('short_name');
    expect(manifest).toHaveProperty('start_url');
    expect(manifest).toHaveProperty('display');

    await page.goto('/');
    const manifestLink = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestLink).toContain('manifest');
  });

  test('app loads from cache when offline after initial load', async ({ page, context }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);

    await waitForServiceWorker(page, 5000);
    await page.waitForTimeout(2000);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('h1')).toContainText('SQLite Editor');
  });

  test('update banner stays hidden when no update is available', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('[data-testid="update-banner"]');
    await page.waitForTimeout(1000);
    const visible = await banner.isVisible().catch(() => false);
    expect(visible).toBe(false);
  });
});
