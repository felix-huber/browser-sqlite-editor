/**
 * Store and persistence-related types.
 */

/**
 * Database registry stored in OPFS/IndexedDB
 */
export interface DatabaseRegistry {
  /** Schema version for future migrations */
  v: 1;
  /** List of persisted databases */
  databases: DatabaseEntry[];
}

/**
 * Metadata for a persisted database
 */
export interface DatabaseEntry {
  /** Display name (user-facing) */
  name: string;
  /** Filename in storage (e.g., "chinook.sqlite") */
  file: string;
  /** When the database was created (ISO 8601 UTC) */
  createdAt: string;
  /** When the database was last opened (ISO 8601 UTC) */
  lastOpenedAt: string;
  /** Whether PRAGMA foreign_keys is enabled for this DB */
  fkEnforced: boolean;
}

/**
 * ERD layout metadata stored per-database
 */
export interface ERDLayout {
  /** Schema version for future migrations */
  v: 1;
  /** Table positions keyed by table name */
  tables: Record<string, TablePosition>;
}

/**
 * Position of a table on the ERD canvas
 */
export interface TablePosition {
  x: number;
  y: number;
}

/**
 * Storage mode for persistence
 */
export type StorageMode = 'opfs' | 'idb';

/**
 * Persistence status for status bar
 */
export type PersistenceStatus = 'saved' | 'unsaved' | 'saving' | 'error';

/**
 * Lock holder state
 */
export type LockHolder = 'self' | 'other' | null;

/**
 * Storage status for quota/degradation tracking
 */
export type StorageStatus = 'ok' | 'quota_exceeded' | 'degraded';

/**
 * Active view in main area
 */
export type ActiveView = 'grid' | 'designer' | 'sql' | 'query-builder' | 'erd';

/**
 * Lock state for multi-tab coordination
 */
export interface LockState {
  /** Whether current tab is in read-only mode */
  isReadOnly: boolean;
  /** Who holds the write lock */
  lockHolder: LockHolder;
  /** Whether the lock holder's heartbeat is stale (for fallback mode) */
  lockStale: boolean;
}

/**
 * Main application state (Zustand store)
 */
export interface AppState {
  // --- Registry ---
  /** List of all persisted databases */
  databases: DatabaseEntry[];
  /** Currently active database name (null if none) */
  activeDb: string | null;

  // --- Schema (for active DB) ---
  /** Tables in active database */
  tables: string[];
  /** Views in active database */
  views: string[];
  /** Indexes in active database (user-created) */
  indexes: string[];

  // --- UI State ---
  /** Width of the sidebar in pixels */
  sidebarWidth: number;
  /** Currently selected table/view name */
  activeTable: string | null;
  /** Current view in main area */
  activeView: ActiveView;

  // --- Unsaved-Edit Check (navigation guard) ---
  /** True while a grid cell is being edited (not yet committed) */
  gridEditInProgress: boolean;
  /** True when table designer has unapplied changes */
  designerDraftInProgress: boolean;
  /** True when ERD FK dialog has unapplied changes */
  erdDraftInProgress: boolean;
  /** True when query builder state would be lost on navigation */
  queryBuilderDraftInProgress: boolean;

  // --- Persistence Status ---
  /** Current storage mode */
  storageMode: StorageMode;
  /** Current persistence status */
  persistenceStatus: PersistenceStatus;
  /** Current storage health status */
  storageStatus: StorageStatus;

  // --- Lock State ---
  /** Whether current tab is in read-only mode */
  isReadOnly: boolean;
  /** Who holds the write lock */
  lockHolder: LockHolder;
  /** Whether the lock holder's heartbeat is stale (for fallback mode) */
  lockStale: boolean;
}

/**
 * Action types for Zustand store
 */
export interface AppActions {
  // Registry actions
  loadRegistry: () => Promise<void>;
  openDb: (name: string) => Promise<void>;
  closeDb: () => Promise<void>;
  createDb: (name: string) => Promise<void>;
  deleteDb: (name: string) => Promise<void>;
  renameDb: (oldName: string, newName: string) => Promise<void>;

  // Schema actions
  loadSchema: () => Promise<void>;
  refreshSchema: () => Promise<void>;

  // UI actions
  setSidebarWidth: (width: number) => void;
  setActiveTable: (table: string | null) => void;
  setActiveView: (view: ActiveView) => void;

  // Edit tracking actions
  setGridEditInProgress: (inProgress: boolean) => void;
  setDesignerDraftInProgress: (inProgress: boolean) => void;
  setErdDraftInProgress: (inProgress: boolean) => void;
  setQueryBuilderDraftInProgress: (inProgress: boolean) => void;

  // Persistence actions
  setPersistenceStatus: (status: PersistenceStatus) => void;
  setStorageStatus: (status: StorageStatus) => void;

  // Lock actions
  acquireLock: (dbName: string) => Promise<boolean>;
  releaseLock: () => Promise<void>;
  setLockState: (state: Partial<LockState>) => void;
}

/**
 * Complete store type (state + actions)
 */
export type AppStore = AppState & AppActions;
