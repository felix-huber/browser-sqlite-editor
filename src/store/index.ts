/**
 * Zustand Store for WASM SQLite Editor
 *
 * Central state management for:
 * - Database registry (list of all databases)
 * - Active database and schema
 * - Lock state for multi-tab coordination
 * - Storage health status
 *
 * Also exports async actions for database operations:
 * - loadRegistry, openDb, closeDb, createDb, deleteDb, renameDb, refreshSchema
 */

import { create } from 'zustand';
import type {
  DatabaseEntry,
  StorageMode,
  StorageStatus,
  LockHolder,
  PersistenceStatus,
} from '../types';
import { getWorkerClient, type WorkerClient } from '../lib/worker-client';
import { getLockManager, type WebLockManager } from '../worker/web-locks';
import { migrateHistory, deleteHistory } from '../lib/history';

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
  /** Current persistence status for status bar */
  persistenceStatus: PersistenceStatus;
  /** Last persistence error message (when status is 'error') */
  persistenceError: string | null;
  /** Number of consecutive failed IDB save attempts */
  failedSaveAttempts: number;
  /** Timestamp of last successful save (ISO 8601) */
  lastSuccessfulSave: string | null;
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
  /** Set persistence status */
  setPersistenceStatus: (status: PersistenceStatus, error?: string | null) => void;
  /** Increment failed save attempts counter */
  incrementFailedSaveAttempts: () => void;
  /** Clear failed save attempts and update last successful save timestamp */
  clearFailedSaveAttempts: () => void;
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
  persistenceStatus: 'saved',
  persistenceError: null,
  failedSaveAttempts: 0,
  lastSuccessfulSave: null,
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

  setPersistenceStatus: (persistenceStatus, error = null) =>
    set({ persistenceStatus, persistenceError: error }),

  incrementFailedSaveAttempts: () =>
    set((state) => ({ failedSaveAttempts: state.failedSaveAttempts + 1 })),

  clearFailedSaveAttempts: () =>
    set({ failedSaveAttempts: 0, lastSuccessfulSave: new Date().toISOString() }),

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

/**
 * Get the current persistence status
 */
export function usePersistenceStatus(): PersistenceStatus {
  return useDatabaseStore((state) => state.persistenceStatus);
}

/**
 * Get the persistence error message (if any)
 */
export function usePersistenceError(): string | null {
  return useDatabaseStore((state) => state.persistenceError);
}

/**
 * Get whether storage is full (quota exceeded).
 * Use this to gate write operations throughout the app.
 */
export function useIsStorageFull(): boolean {
  return useDatabaseStore((state) => state.storageStatus === 'quota_exceeded');
}

/**
 * Check if writes are allowed (not read-only AND not storage full)
 */
export function useCanWrite(): boolean {
  return useDatabaseStore(
    (state) => !state.isReadOnly && state.storageStatus !== 'quota_exceeded'
  );
}

/**
 * Get the number of failed save attempts
 */
export function useFailedSaveAttempts(): number {
  return useDatabaseStore((state) => state.failedSaveAttempts);
}

/**
 * Get the last successful save timestamp
 */
export function useLastSuccessfulSave(): string | null {
  return useDatabaseStore((state) => state.lastSuccessfulSave);
}

/**
 * Check if persistence is in degraded state (after 3+ failed save attempts)
 */
export function useIsDegradedPersistence(): boolean {
  return useDatabaseStore((state) => state.storageStatus === 'degraded');
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

// =============================================================================
// Database Action Dependencies (for testing)
// =============================================================================

/**
 * Dependencies for database actions (allows injection for testing)
 */
export interface DatabaseActionDeps {
  workerClient: WorkerClient;
  lockManager: WebLockManager;
}

/** Default dependencies using singletons */
const defaultDeps: DatabaseActionDeps = {
  get workerClient() {
    return getWorkerClient();
  },
  get lockManager() {
    return getLockManager();
  },
};

/** Current dependencies (can be overridden for testing) */
let _deps: DatabaseActionDeps = defaultDeps;

/**
 * Set dependencies for database actions (for testing)
 */
export function setActionDeps(deps: Partial<DatabaseActionDeps>): void {
  _deps = { ...defaultDeps, ...deps };
}

/**
 * Reset dependencies to defaults
 */
export function resetActionDeps(): void {
  _deps = defaultDeps;
}

/**
 * Get current dependencies (for testing inspection)
 */
export function getActionDeps(): DatabaseActionDeps {
  return _deps;
}

// =============================================================================
// Database Actions
// =============================================================================

/**
 * Load the database registry from the worker and update the store
 *
 * Fetches the registry from the worker and populates the databases[] array.
 */
export async function loadRegistry(): Promise<void> {
  const registry = await _deps.workerClient.getRegistry();
  useDatabaseStore.getState().setDatabases(registry.databases);
}

/**
 * Open a database by ID
 *
 * 1. Acquires a lock (exclusive if available, otherwise read-only)
 * 2. Opens the database via the worker
 * 3. Loads the schema
 * 4. Updates activeDbId, isReadOnly, lockHolder, and schema in the store
 *
 * @param id Database ID to open
 */
export async function openDb(id: string): Promise<void> {
  const store = useDatabaseStore.getState();

  // Try to acquire the write lock
  const lockResult = await _deps.lockManager.acquireLock(id);

  // Open the database via worker
  await _deps.workerClient.openDb(id);

  // Determine lock state
  const isWriter = lockResult.acquired;
  const isReadOnly = !isWriter;
  const lockHolder: LockHolder = isWriter ? 'self' : 'other';

  // Set active database and read-only state
  store.setActiveDb(id);
  store.setReadOnly(isReadOnly);
  store.setLockHolder(lockHolder);

  // Load schema
  const schema = await _deps.workerClient.getSchema();
  store.setSchema({
    tables: schema.tables,
    views: schema.views,
    indexes: schema.indexes,
  });
}

/**
 * Close the currently active database
 *
 * 1. Releases the lock if held
 * 2. Closes the database via the worker
 * 3. Clears activeDbId, schema, and lock state in the store
 */
export async function closeDb(): Promise<void> {
  const store = useDatabaseStore.getState();
  const activeDbId = store.activeDbId;

  if (!activeDbId) {
    return; // Nothing to close
  }

  // Release the lock if we hold it
  if (store.lockHolder === 'self') {
    await _deps.lockManager.releaseLock(activeDbId);
  }

  // Close the database via worker
  await _deps.workerClient.closeDb();

  // Clear state
  store.setActiveDb(null);
  store.setSchema(null);
  store.setReadOnly(false);
  store.setLockHolder(null);
}

/**
 * Create a new database
 *
 * 1. Creates the database via the worker
 * 2. Reloads the registry to get the new entry
 * 3. Opens the new database
 *
 * @param name Name for the new database
 */
export async function createDb(name: string): Promise<void> {
  // Create via worker
  await _deps.workerClient.createDb(name);

  // Reload registry to get the new entry
  await loadRegistry();

  // Open the newly created database
  await openDb(name);
}

/**
 * Delete a database
 *
 * 1. Closes the database if it's currently active
 * 2. Deletes the database storage via the worker
 * 3. Removes query history for the database
 * 4. Removes from the registry
 *
 * @param id Database ID to delete
 */
export async function deleteDb(id: string): Promise<void> {
  const store = useDatabaseStore.getState();

  // Close if this is the active database
  if (store.activeDbId === id) {
    await closeDb();
  }

  // Delete via worker (handles storage deletion: DB file, sidecar, registry entry)
  await _deps.workerClient.deleteDb(id);

  // Delete query history for this database (qh:<db> key in localStorage)
  deleteHistory(id);

  // Remove from local registry state
  const updatedDatabases = store.databases.filter((db) => db.name !== id);
  store.setDatabases(updatedDatabases);
}

/**
 * Rename a database
 *
 * Updates the database name in storage and registry,
 * and migrates query history to the new name.
 *
 * @param id Current database ID/name
 * @param newName New name for the database
 */
export async function renameDb(id: string, newName: string): Promise<void> {
  const store = useDatabaseStore.getState();

  // Rename via worker (handles storage rename)
  await _deps.workerClient.renameDb(id, newName);

  // Migrate query history from old name to new name
  migrateHistory(id, newName);

  // Update local registry state
  const updatedDatabases = store.databases.map((db) =>
    db.name === id ? { ...db, name: newName } : db
  );
  store.setDatabases(updatedDatabases);

  // If this was the active database, update activeDbId without resetting schema
  if (store.activeDbId === id) {
    // Use direct set to preserve schema (setActiveDb resets schema to null)
    useDatabaseStore.setState({ activeDbId: newName });
  }
}

/**
 * Refresh the schema for the active database
 *
 * Reloads tables, views, and indexes from the worker.
 */
export async function refreshSchema(): Promise<void> {
  const store = useDatabaseStore.getState();

  if (!store.activeDbId) {
    return; // No active database
  }

  const schema = await _deps.workerClient.getSchema();
  store.setSchema({
    tables: schema.tables,
    views: schema.views,
    indexes: schema.indexes,
  });
}
