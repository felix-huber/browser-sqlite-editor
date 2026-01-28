/**
 * Zustand Store for WASM SQLite Editor
 *
 * Central state management for:
 * - Database registry (list of all databases)
 * - Active database and schema
 * - Lock state for multi-tab coordination
 * - Storage health status
 */

import { create } from 'zustand';
import type {
  DatabaseEntry,
  StorageMode,
  StorageStatus,
  LockHolder,
} from '../types';

// =============================================================================
// Store State Types
// =============================================================================

/**
 * Schema information for the active database
 */
export interface SchemaState {
  tables: string[];
  views: string[];
  indexes: string[];
}

/**
 * Store state for database and lock management
 */
export interface DatabaseStoreState {
  /** List of all persisted databases */
  databases: DatabaseEntry[];
  /** Currently active database ID (null if none) */
  activeDbId: string | null;
  /** Schema for the active database (null if no database is active) */
  schema: SchemaState | null;
  /** Whether current tab is in read-only mode */
  isReadOnly: boolean;
  /** Who holds the write lock */
  lockHolder: LockHolder;
  /** Current storage health status */
  storageStatus: StorageStatus;
  /** Current storage mode (null if not determined) */
  storageMode: StorageMode | null;
}

/**
 * Store actions for modifying state
 */
export interface DatabaseStoreActions {
  /** Set the list of databases */
  setDatabases: (databases: DatabaseEntry[]) => void;
  /** Set the active database ID (resets schema to null) */
  setActiveDb: (dbId: string | null) => void;
  /** Set the schema for the active database */
  setSchema: (schema: SchemaState | null) => void;
  /** Set read-only mode */
  setReadOnly: (isReadOnly: boolean) => void;
  /** Set the lock holder */
  setLockHolder: (lockHolder: LockHolder) => void;
  /** Set storage status */
  setStorageStatus: (status: StorageStatus) => void;
  /** Set storage mode */
  setStorageMode: (mode: StorageMode | null) => void;
  /** Reset the store to initial state */
  reset: () => void;
}

/**
 * Complete store type
 */
export type DatabaseStore = DatabaseStoreState & DatabaseStoreActions;

// =============================================================================
// Initial State
// =============================================================================

/** Stable empty array for selector defaults (prevents infinite re-renders) */
const EMPTY_ARRAY: string[] = [];

const initialState: DatabaseStoreState = {
  databases: [],
  activeDbId: null,
  schema: null,
  isReadOnly: false,
  lockHolder: null,
  storageStatus: 'ok',
  storageMode: null,
};

// =============================================================================
// Store Creation
// =============================================================================

/**
 * Main Zustand store for database state management
 */
export const useDatabaseStore = create<DatabaseStore>((set) => ({
  // Initial state
  ...initialState,

  // Actions
  setDatabases: (databases) => set({ databases }),

  setActiveDb: (dbId) =>
    set({
      activeDbId: dbId,
      // Reset schema when changing active database
      schema: null,
    }),

  setSchema: (schema) => set({ schema }),

  setReadOnly: (isReadOnly) => set({ isReadOnly }),

  setLockHolder: (lockHolder) => set({ lockHolder }),

  setStorageStatus: (storageStatus) => set({ storageStatus }),

  setStorageMode: (storageMode) => set({ storageMode }),

  reset: () => set(initialState),
}));

// =============================================================================
// Selectors
// =============================================================================

/**
 * Get the currently active database entry, or null if none is active
 */
export function useActiveDb(): DatabaseEntry | null {
  return useDatabaseStore((state) => {
    if (!state.activeDbId) return null;
    return state.databases.find((db) => db.name === state.activeDbId) ?? null;
  });
}

/**
 * Get whether the current tab is in read-only mode
 */
export function useIsReadOnly(): boolean {
  return useDatabaseStore((state) => state.isReadOnly);
}

/**
 * Get the list of tables for the active database
 */
export function useTables(): string[] {
  return useDatabaseStore((state) => state.schema?.tables ?? EMPTY_ARRAY);
}

/**
 * Get the current storage health status
 */
export function useStorageStatus(): StorageStatus {
  return useDatabaseStore((state) => state.storageStatus);
}

/**
 * Get the list of views for the active database
 */
export function useViews(): string[] {
  return useDatabaseStore((state) => state.schema?.views ?? EMPTY_ARRAY);
}

/**
 * Get the list of indexes for the active database
 */
export function useIndexes(): string[] {
  return useDatabaseStore((state) => state.schema?.indexes ?? EMPTY_ARRAY);
}

/**
 * Get the current storage mode
 */
export function useStorageMode(): StorageMode | null {
  return useDatabaseStore((state) => state.storageMode);
}

/**
 * Get the lock holder
 */
export function useLockHolder(): LockHolder {
  return useDatabaseStore((state) => state.lockHolder);
}

/**
 * Get all databases
 */
export function useDatabases(): DatabaseEntry[] {
  return useDatabaseStore((state) => state.databases);
}

// =============================================================================
// Non-hook Accessors (for use outside React components)
// =============================================================================

/**
 * Get the current store state (non-reactive)
 */
export function getState(): DatabaseStoreState {
  return useDatabaseStore.getState();
}

/**
 * Subscribe to store changes
 */
export const subscribe = useDatabaseStore.subscribe;
