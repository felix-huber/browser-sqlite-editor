/**
 * Query History Management
 *
 * Manages per-database query history stored in localStorage.
 * Keys are prefixed with "qh:" followed by the database name.
 *
 * Also provides migration utilities for renaming databases.
 */

import type { QueryHistoryItem } from '../types';

// =============================================================================
// Constants
// =============================================================================

/** localStorage key prefix for query history */
const STORAGE_PREFIX = 'qh:';

/** Maximum history items per database */
const MAX_HISTORY_ITEMS = 100;

// =============================================================================
// Key Management
// =============================================================================

/**
 * Get the localStorage key for a database's query history
 */
function getStorageKey(dbName: string): string {
  return `${STORAGE_PREFIX}${dbName}`;
}

// =============================================================================
// History Operations
// =============================================================================

/**
 * Load query history for a database
 *
 * @param dbName - Database name
 * @returns Array of history items (newest first), empty array if none
 */
export function loadHistory(dbName: string): QueryHistoryItem[] {
  const key = getStorageKey(dbName);

  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      console.warn(`Query history for "${dbName}" is not an array, resetting`);
      return [];
    }

    return parsed as QueryHistoryItem[];
  } catch (error) {
    console.warn(`Failed to load query history for "${dbName}":`, error);
    return [];
  }
}

/**
 * Save query history for a database
 *
 * @param dbName - Database name
 * @param history - History items to save
 * @returns true if saved successfully
 */
export function saveHistory(dbName: string, history: QueryHistoryItem[]): boolean {
  const key = getStorageKey(dbName);

  try {
    // Limit to max items
    const trimmed = history.slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(key, JSON.stringify(trimmed));
    return true;
  } catch (error) {
    console.error(`Failed to save query history for "${dbName}":`, error);
    return false;
  }
}

/**
 * Add a query to the history
 *
 * @param dbName - Database name
 * @param sql - SQL query to add
 * @returns true if saved successfully
 */
export function addToHistory(dbName: string, sql: string): boolean {
  const history = loadHistory(dbName);

  // Add new item at the beginning
  const newItem: QueryHistoryItem = {
    sql,
    executedAt: new Date().toISOString(),
  };

  // Remove duplicate if exists (keep the newer one)
  const filtered = history.filter((item) => item.sql !== sql);
  filtered.unshift(newItem);

  return saveHistory(dbName, filtered);
}

/**
 * Delete query history for a database
 *
 * @param dbName - Database name
 */
export function deleteHistory(dbName: string): void {
  const key = getStorageKey(dbName);
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn(`Failed to delete query history for "${dbName}":`, error);
  }
}

/**
 * Clear all history for a database
 *
 * @param dbName - Database name
 * @returns true if cleared successfully
 */
export function clearHistory(dbName: string): boolean {
  return saveHistory(dbName, []);
}

// =============================================================================
// Migration Utilities
// =============================================================================

/**
 * Migrate query history from one database name to another
 *
 * This is used when renaming a database. It:
 * 1. Loads history from the old key
 * 2. Saves to the new key
 * 3. Deletes the old key
 *
 * @param oldName - Old database name
 * @param newName - New database name
 * @returns true if migration succeeded (or nothing to migrate)
 */
export function migrateHistory(oldName: string, newName: string): boolean {
  if (oldName === newName) {
    return true; // Nothing to do
  }

  const oldKey = getStorageKey(oldName);
  const newKey = getStorageKey(newName);

  try {
    const stored = localStorage.getItem(oldKey);

    // Nothing to migrate
    if (stored === null) {
      return true;
    }

    // Copy to new key
    localStorage.setItem(newKey, stored);

    // Remove old key
    localStorage.removeItem(oldKey);

    return true;
  } catch (error) {
    console.error(`Failed to migrate query history from "${oldName}" to "${newName}":`, error);
    return false;
  }
}

/**
 * Check if query history exists for a database
 *
 * @param dbName - Database name
 * @returns true if history exists
 */
export function hasHistory(dbName: string): boolean {
  const key = getStorageKey(dbName);
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

// =============================================================================
// Testing Exports
// =============================================================================

export const _testing = {
  STORAGE_PREFIX,
  MAX_HISTORY_ITEMS,
  getStorageKey,
};
