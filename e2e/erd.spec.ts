import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  createAndOpenDatabase,
  openDatabaseFromWelcome,
  runSql,
  waitForReady,
} from './helpers/app';

/**
 * E2E Tests for ERD
 */

const DB_NAME = 'erd-db';

const BASE_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER,
  title TEXT
);
`;

async function setupErdDb(page: Page) {
  await createAndOpenDatabase(page, DB_NAME);
  await runSql(page, BASE_SQL);
  await page.getByRole('button', { name: 'ERD' }).click();
  await expect(page.getByTestId('erd-view')).toBeVisible();
  await expect(page.getByTestId('erd-canvas')).toBeVisible();
}

function getTableNode(page: Page, name: string) {
  return page.locator('[data-testid="table-node"]', { hasText: name });
}

async function connectTables(
  page: Page,
  childTable: string,
  childColumn: string,
  parentTable: string,
  parentColumn: string
) {
  const childNode = getTableNode(page, childTable);
  const parentNode = getTableNode(page, parentTable);
  await childNode.hover();
  await parentNode.hover();
  const source = childNode.locator(`[data-handleid="${childColumn}-source"]`);
  const target = parentNode.locator(`[data-handleid="${parentColumn}-target"]`);
  await source.dragTo(target, { force: true });
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('ERD', () => {
  test.beforeEach(async ({ page }) => {
    await setupErdDb(page);
  });

  test('renders nodes for tables', async ({ page }) => {
    await expect(getTableNode(page, 'users')).toBeVisible();
    await expect(getTableNode(page, 'orders')).toBeVisible();
    await expect(getTableNode(page, 'projects')).toBeVisible();
    await expect(getTableNode(page, 'tasks')).toBeVisible();
  });

  test('renders foreign key edges', async ({ page }) => {
    const edges = page.locator('[data-testid^="fk-edge-hitbox-"]');
    await expect(edges).toHaveCount(1);
  });

  test('context menu opens on edge', async ({ page }) => {
    const edge = page.locator('[data-testid^="fk-edge-hitbox-"]').first();
    await edge.click({ button: 'right' });
    await expect(page.getByTestId('fk-edge-context-menu')).toBeVisible();
  });

  test('edit FK dialog opens and saves', async ({ page }) => {
    const edge = page.locator('[data-testid^="fk-edge-hitbox-"]').first();
    await edge.click({ button: 'right' });
    await page.getByTestId('fk-context-menu-edit').click();
    await expect(page.getByTestId('fk-edit-dialog')).toBeVisible();
    await page.getByTestId('fk-edit-on-delete-select').selectOption('CASCADE');
    await page.getByTestId('fk-edit-save-button').click();
    await expect(page.getByTestId('erd-toast-success')).toBeVisible();
  });

  test('delete FK dialog removes edge', async ({ page }) => {
    const edge = page.locator('[data-testid^="fk-edge-hitbox-"]').first();
    await edge.click({ button: 'right' });
    await page.getByTestId('fk-context-menu-delete').click();
    await expect(page.getByTestId('fk-delete-dialog')).toBeVisible();
    await page.getByTestId('fk-delete-confirm-input').fill('orders_user_id_fk');
    await page.getByTestId('fk-delete-confirm-button').click();
    await expect(page.locator('[data-testid^="fk-edge-hitbox-"]')).toHaveCount(0);
  });

  test('creating FK shows validation dialog', async ({ page }) => {
    await connectTables(page, 'tasks', 'project_id', 'projects', 'id');
    await expect(page.getByTestId('fk-validation-dialog')).toBeVisible();
  });

  test('creating FK adds new edge', async ({ page }) => {
    await connectTables(page, 'tasks', 'project_id', 'projects', 'id');
    await page.getByTestId('fk-create-button').click();
    await expect(page.locator('[data-testid^="fk-edge-hitbox-"]')).toHaveCount(2);
  });

  test('read-only mode blocks FK creation', async ({ page }) => {
    const reader = await page.context().newPage();
    await reader.goto('/');
    await openDatabaseFromWelcome(reader, DB_NAME);
    await reader.getByRole('button', { name: 'ERD' }).click();
    await expect(reader.getByTestId('erd-view')).toBeVisible();
    await connectTables(reader, 'tasks', 'project_id', 'projects', 'id');
    await expect(reader.getByTestId('erd-toast-error')).toBeVisible();
    await reader.close();
  });
});

// =============================================================================
// Basic UI Checks
// =============================================================================

test.describe('ERD Integration Checks', () => {
  test('welcome screen visible on load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('welcome-screen')).toBeVisible();
  });

  test('status bar ready state', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
  });
});
