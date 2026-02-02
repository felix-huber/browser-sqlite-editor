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
import type { JoinConfig } from '../features/query-builder/QueryBuilder';
import type { TableBoxNodeType } from '../features/query-builder/TableBox';
import type { WhereCondition } from '../features/query-builder/WhereBuilder';
import type { SortCondition } from '../features/query-builder/OrderByBuilder';
import { getWorkerClient, type WorkerClient } from '../core/worker/client';
import { getLockManager, type WebLockManager } from '../worker/web-locks';
import { migrateHistory, deleteHistory } from '../core/sql/history';

// =============================================================================
// Size Warning Constants
// =============================================================================

/** Size threshold for OPFS mode warnings (100MB) */
export const SIZE_THRESHOLD_OPFS = 100 * 1024 * 1024;

/** Size threshold for IndexedDB mode warnings (50MB) */
export const SIZE_THRESHOLD_IDB = 50 * 1024 * 1024;

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
 * Size warning state
 */
export interface SizeWarningState {
  /** Database ID that triggered the warning */
  dbId: string;
  /** Current size in bytes */
  sizeBytes: number;
  /** Storage mode when warning was triggered */
  storageMode: StorageMode;
  /** Threshold that was exceeded */
  threshold: number;
}

/**
 * Query Builder state for session persistence
 */
export interface QueryBuilderState {
  /** Table nodes on the canvas */
  nodes: TableBoxNodeType[];
  /** Join configurations */
  joins: JoinConfig[];
  /** WHERE conditions */
  whereConditions: WhereCondition[];
  /** Logic operator for WHERE conditions */
  whereLogic: 'AND' | 'OR';
  /** Sort conditions for ORDER BY */
  sortConditions: SortCondition[];
  /** LIMIT value (null for no limit) */
  limit: number | null;
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
  /** Current size warning (for toast display) */
  sizeWarning: SizeWarningState | null;
  /** Set of DB IDs that currently exceed size threshold (for badge display) */
  dbsExceedingThreshold: Set<string>;
  /** Set of DB IDs already warned this session (to prevent re-warning) */
  warnedDbsThisSession: Set<string>;
  /** Query Builder state for the active database (persists during navigation) */
  queryBuilderState: QueryBuilderState | null;
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
  /** Set size warning state */
  setSizeWarning: (warning: SizeWarningState | null) => void;
  /** Add a DB to the exceeding threshold set */
  addDbExceedingThreshold: (dbId: string) => void;
  /** Remove a DB from the exceeding threshold set */
  removeDbExceedingThreshold: (dbId: string) => void;
  /** Mark a DB as warned this session */
  markDbWarned: (dbId: string, storageMode: StorageMode) => void;
  /** Set Query Builder state */
  setQueryBuilderState: (state: QueryBuilderState | null) => void;
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
  sizeWarning: null,
  dbsExceedingThreshold: new Set<string>(),
  warnedDbsThisSession: new Set<string>(),
  queryBuilderState: null,
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

  setSizeWarning: (sizeWarning) => set({ sizeWarning }),

  addDbExceedingThreshold: (dbId) =>
    set((state) => {
      const newSet = new Set(state.dbsExceedingThreshold);
      newSet.add(dbId);
      return { dbsExceedingThreshold: newSet };
    }),

  removeDbExceedingThreshold: (dbId) =>
    set((state) => {
      const newSet = new Set(state.dbsExceedingThreshold);
      newSet.delete(dbId);
      return { dbsExceedingThreshold: newSet };
    }),

  markDbWarned: (dbId, storageMode) =>
    set((state) => {
      const key = `${dbId}:${storageMode}`;
      const newSet = new Set(state.warnedDbsThisSession);
      newSet.add(key);
      return { warnedDbsThisSession: newSet };
    }),

  setQueryBuilderState: (queryBuilderState) => set({ queryBuilderState }),

  reset: () =>
    set({
      ...initialState,
      // Create fresh Set instances to avoid mutations
      dbsExceedingThreshold: new Set<string>(),
      warnedDbsThisSession: new Set<string>(),
      // Clear Query Builder state on reset
      queryBuilderState: null,
    }),
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

/**
 * Get the current size warning (for toast display)
 */
export function useSizeWarning(): SizeWarningState | null {
  return useDatabaseStore((state) => state.sizeWarning);
}

/**
 * Get the set of DBs currently exceeding threshold (for badge display)
 */
export function useDbsExceedingThreshold(): Set<string> {
  return useDatabaseStore((state) => state.dbsExceedingThreshold);
}

/**
 * Get the Query Builder state (for state persistence)
 */
export function useQueryBuilderState(): QueryBuilderState | null {
  return useDatabaseStore((state) => state.queryBuilderState);
}

/**
 * Set the Query Builder state (non-hook version for use outside components)
 */
export function setQueryBuilderState(state: QueryBuilderState | null): void {
  useDatabaseStore.getState().setQueryBuilderState(state);
}

/**
 * Clear Query Builder state
 */
export function clearQueryBuilderState(): void {
  useDatabaseStore.getState().setQueryBuilderState(null);
}

// =============================================================================
// Size Warning Functions
// =============================================================================

/**
 * Check if a database size exceeds the threshold and trigger warning if needed.
 *
 * This function:
 * 1. Determines the threshold based on storage mode
 * 2. Updates the dbsExceedingThreshold set
 * 3. Shows a warning toast if first time for this DB+mode this session
 *
 * @param dbId Database ID
 * @param sizeBytes Current size in bytes
 * @param storageMode Current storage mode
 */
export function checkSizeWarning(
  dbId: string,
  sizeBytes: number,
  storageMode: StorageMode
): void {
  const store = useDatabaseStore.getState();
  const threshold = storageMode === 'opfs' ? SIZE_THRESHOLD_OPFS : SIZE_THRESHOLD_IDB;
  const exceedsThreshold = sizeBytes > threshold;

  if (exceedsThreshold) {
    // Add to badge set
    store.addDbExceedingThreshold(dbId);

    // Check if we've already warned for this DB+mode this session
    const key = `${dbId}:${storageMode}`;
    if (!store.warnedDbsThisSession.has(key)) {
      // Show warning toast
      store.setSizeWarning({
        dbId,
        sizeBytes,
        storageMode,
        threshold,
      });
      // Mark as warned
      store.markDbWarned(dbId, storageMode);
    }
  } else {
    // Remove from badge set if under threshold
    store.removeDbExceedingThreshold(dbId);
  }
}

/**
 * Clear the current size warning (after toast is dismissed)
 */
export function clearSizeWarning(): void {
  useDatabaseStore.getState().setSizeWarning(null);
}

/**
 * Refresh the size warning check for the active database
 * Call this after operations that may grow the database (imports, inserts)
 */
export async function refreshSizeWarning(): Promise<void> {
  const store = useDatabaseStore.getState();
  const activeDbId = store.activeDbId;

  if (!activeDbId) {
    return;
  }

  try {
    const sizeInfo = await _deps.workerClient.getDbSize(activeDbId);
    checkSizeWarning(activeDbId, sizeInfo.sizeBytes, sizeInfo.storageMode);
  } catch {
    // Size check is non-critical, don't fail the operation
  }
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
 * 1. Checks storage type (IDB databases skip lock acquisition - they're multi-tab safe)
 * 2. For OPFS: Acquires a lock (exclusive if available, otherwise read-only)
 * 3. Opens the database via the worker
 * 4. Loads the schema
 * 5. Updates activeDbId, isReadOnly, lockHolder, and schema in the store
 *
 * @param id Database ID to open
 */
export async function openDb(id: string): Promise<void> {
  const store = useDatabaseStore.getState();

  // Check storage type to determine if lock acquisition is needed
  // IDB databases are multi-tab safe and don't need Web Locks
  let storageMode: StorageMode = 'opfs'; // Default assumption
  try {
    const sizeInfo = await _deps.workerClient.getDbSize(id);
    storageMode = sizeInfo.storageMode;
  } catch {
    // If we can't determine storage mode, assume OPFS (safer)
  }

  // IDB databases are multi-tab safe - skip lock acquisition
  // OPFS databases need Web Locks for single-writer guarantee
  let lockResult = { acquired: true, holderStale: false };
  if (storageMode === 'opfs') {
    lockResult = await _deps.lockManager.acquireLock(id);
  }

  // Open the database via worker
  // For IDB, always open with readOnly=false since it's multi-tab safe
  // For OPFS, use the lock result to determine read-only mode
  const readOnly = storageMode === 'opfs' && !lockResult.acquired;
  await _deps.workerClient.openDb(id, { readOnly });

  // Determine lock state
  // IDB databases always have write access (multi-tab safe)
  const isWriter = storageMode === 'idb' || lockResult.acquired;
  const isReadOnly = !isWriter;
  const lockHolder: LockHolder = isWriter ? 'self' : 'other';

  // Set active database, storage mode, and lock state
  store.setActiveDb(id);
  store.setStorageMode(storageMode);
  store.setReadOnly(isReadOnly);
  store.setLockHolder(lockHolder);

  // Load schema
  const schema = await _deps.workerClient.getSchema();
  store.setSchema({
    tables: schema.tables,
    views: schema.views,
    indexes: schema.indexes,
  });

  // Check size warning after database is opened
  try {
    const sizeInfo = await _deps.workerClient.getDbSize(id);
    checkSizeWarning(id, sizeInfo.sizeBytes, sizeInfo.storageMode);
  } catch {
    // Size check is non-critical, don't fail the open
  }
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

  // Release the lock if we hold it (only for OPFS databases)
  // IDB databases don't use Web Locks (they're multi-tab safe)
  if (store.lockHolder === 'self' && store.storageMode === 'opfs') {
    await _deps.lockManager.releaseLock(activeDbId);
  }

  // Close the database via worker
  await _deps.workerClient.closeDb();

  // Clear state
  store.setActiveDb(null);
  store.setSchema(null);
  store.setReadOnly(false);
  store.setLockHolder(null);
  // Clear Query Builder state when database is closed
  store.setQueryBuilderState(null);
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
