/**
 * Query History Management
 *
 * Manages per-database query history stored in localStorage.
 * Keys are prefixed with "qh:" followed by the database name.
 *
 * Features:
 * - Max 50 entries per database (FIFO when full)
 * - Consecutive deduplication (same query not added twice in a row)
 * - Max 10KB per query (truncated if larger)
 * - Quota exceeded handling (removes oldest entries until save succeeds)
 *
 * Also provides migration utilities for renaming databases.
 */

import type { QueryHistoryItem } from '../../types';

// =============================================================================
// Constants
// =============================================================================

/** localStorage key prefix for query history */
const STORAGE_PREFIX = 'qh:';

/** Maximum history items per database */
const MAX_HISTORY_ITEMS = 50;

/** Maximum size of a single query in bytes */
const MAX_QUERY_SIZE_BYTES = 10 * 1024; // 10KB

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
 * Truncate a query to max size if needed
 *
 * @param sql - SQL query to truncate
 * @returns Truncated query
 */
function truncateQuery(sql: string): string {
  // Use TextEncoder to get byte length
  const encoder = new TextEncoder();
  const bytes = encoder.encode(sql);

  if (bytes.length <= MAX_QUERY_SIZE_BYTES) {
    return sql;
  }

  // Binary search for the right truncation point
  let low = 0;
  let high = sql.length;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const truncated = sql.slice(0, mid);
    if (encoder.encode(truncated).length <= MAX_QUERY_SIZE_BYTES - 3) {
      // -3 for "..."
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return sql.slice(0, low) + '...';
}

/**
 * Save query history for a database with quota exceeded handling.
 * If save fails due to quota, removes oldest entries until it succeeds.
 *
 * @param dbName - Database name
 * @param history - History items to save
 * @returns true if saved successfully
 */
export function saveHistory(dbName: string, history: QueryHistoryItem[]): boolean {
  const key = getStorageKey(dbName);

  // Limit to max items
  let items = history.slice(0, MAX_HISTORY_ITEMS);

  // Try saving, removing oldest entries if quota exceeded
  while (true) {
    try {
      localStorage.setItem(key, JSON.stringify(items));
      return true;
    } catch (error) {
      // Check if it's a quota exceeded error
      if (
        error instanceof DOMException &&
        (error.name === 'QuotaExceededError' || error.code === 22)
      ) {
        // If we have items, remove oldest entry and try again
        if (items.length > 0) {
          items = items.slice(0, -1);
          continue;
        }
        // Empty array still failed - give up
        break;
      }
      // Other error, log and fail
      console.error(`Failed to save query history for "${dbName}":`, error);
      return false;
    }
  }

  // All entries removed but still can't save - clear the key
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore - we tried our best
  }
  return false;
}

/**
 * Add a query to the history.
 * Only adds if not a duplicate of the most recent query (consecutive deduplication).
 * Large queries are truncated to 10KB.
 *
 * @param dbName - Database name
 * @param sql - SQL query to add
 * @returns true if saved successfully
 */
export function addToHistory(dbName: string, sql: string): boolean {
  const history = loadHistory(dbName);

  // Truncate query if too large
  const truncatedSql = truncateQuery(sql);

  // Check for consecutive duplicate (don't add if same as most recent)
  if (history.length > 0 && history[0].sql === truncatedSql) {
    return true; // Nothing to do, already at top
  }

  // Add new item at the beginning
  const newItem: QueryHistoryItem = {
    sql: truncatedSql,
    executedAt: new Date().toISOString(),
  };

  history.unshift(newItem);

  return saveHistory(dbName, history);
}

/**
 * Remove a specific history item by index
 *
 * @param dbName - Database name
 * @param index - Index of item to remove (0-based)
 * @returns true if removed successfully
 */
export function removeHistoryItem(dbName: string, index: number): boolean {
  const history = loadHistory(dbName);

  if (index < 0 || index >= history.length) {
    return false;
  }

  history.splice(index, 1);
  return saveHistory(dbName, history);
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
  MAX_QUERY_SIZE_BYTES,
  getStorageKey,
  truncateQuery,
};
