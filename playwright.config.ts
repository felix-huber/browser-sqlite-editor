import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration with enhanced debug output.
 *
 * Run with:
 *   npm run test:e2e          - Standard run with progress output
 *   npm run test:e2e:ui       - Interactive UI mode
 *   npm run test:e2e:headed   - Visible browser
 *   DEBUG=pw:api npm run test:e2e - Full Playwright API debug logs
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // Enhanced reporters for better debug output:
  // - 'list' shows real-time test progress with pass/fail indicators
  // - 'html' generates detailed report with traces
  // - 'json' for CI/programmatic access
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['json', { outputFile: 'playwright-report/results.json' }],
      ]
    : [
        ['list', { printSteps: true }],
        ['html', { outputFolder: 'playwright-report', open: 'on-failure' }],
        ['json', { outputFile: 'playwright-report/results.json' }],
      ],
  timeout: 30000,
  // Expect timeout for better debugging of slow assertions
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:4173',
    // Capture traces on first retry for debugging failures
    trace: 'on-first-retry',
    // Capture screenshots on failure for visual debugging
    screenshot: 'only-on-failure',
    // Capture video on first retry to see what happened
    video: 'on-first-retry',
    // Add action timeout for better debugging
    actionTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
