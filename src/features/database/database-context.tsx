/**
 * Database Context for Single-Writer Lock State
 *
 * Provides React context for database connection state including:
 * - Read-only mode indication (when another tab holds the write lock)
 * - Lock holder information for multi-tab coordination
 * - Writer takeover capability when previous writer is stale
 *
 * This context integrates with the worker-level db-manager for accurate
 * lock state reporting based on actual Web Locks acquisition.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

// =============================================================================
// Types
// =============================================================================

/**
 * Lock holder state for UI display
 */
export type LockHolderState = 'self' | 'other' | 'none';

/**
 * Database connection state
 */
export interface DatabaseConnectionState {
  /** Whether the database is currently open */
  isOpen: boolean;
  /** Current database ID (null if no database is open) */
  dbId: string | null;
  /** Whether this connection is in read-only mode */
  isReadOnly: boolean;
  /** Who holds the write lock */
  lockHolder: LockHolderState;
  /** Whether the lock holder appears stale (crashed tab) */
  isLockHolderStale: boolean;
}

/**
 * Database context value with state and actions
 */
export interface DatabaseContextValue extends DatabaseConnectionState {
  /** Update the connection state (called after open/close) */
  setConnectionState: (state: Partial<DatabaseConnectionState>) => void;
  /** Check if writes are allowed */
  canWrite: boolean;
}

// =============================================================================
// Context
// =============================================================================

const initialState: DatabaseConnectionState = {
  isOpen: false,
  dbId: null,
  isReadOnly: false,
  lockHolder: 'none',
  isLockHolderStale: false,
};

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export interface DatabaseProviderProps {
  children: ReactNode;
  /** Initial state (for testing) */
  initialState?: Partial<DatabaseConnectionState>;
}

/**
 * Database context provider
 *
 * Manages database connection state for read-only mode indication
 * and lock holder tracking.
 */
export function DatabaseProvider({
  children,
  initialState: providedInitialState,
}: DatabaseProviderProps): JSX.Element {
  const [state, setState] = useState<DatabaseConnectionState>({
    ...initialState,
    ...providedInitialState,
  });

  const setConnectionState = useCallback(
    (update: Partial<DatabaseConnectionState>) => {
      setState((prev) => ({ ...prev, ...update }));
    },
    []
  );

  const canWrite = useMemo(() => {
    return state.isOpen && !state.isReadOnly && state.lockHolder === 'self';
  }, [state.isOpen, state.isReadOnly, state.lockHolder]);

  const value = useMemo<DatabaseContextValue>(
    () => ({
      ...state,
      setConnectionState,
      canWrite,
    }),
    [state, setConnectionState, canWrite]
  );

  return (
    <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Use the database context
 *
 * @throws Error if used outside DatabaseProvider
 */
export function useDatabaseContext(): DatabaseContextValue {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabaseContext must be used within a DatabaseProvider');
  }
  return context;
}

/**
 * Check if the current database connection is read-only
 *
 * Returns true when:
 * - Another tab holds the write lock
 * - The database was opened in forced read-only mode
 */
export function useIsReadOnly(): boolean {
  const context = useContext(DatabaseContext);
  return context?.isReadOnly ?? false;
}

/**
 * Check if writes are allowed
 *
 * Returns true when:
 * - Database is open
 * - This tab holds the write lock
 * - Not in read-only mode
 */
export function useCanWrite(): boolean {
  const context = useContext(DatabaseContext);
  return context?.canWrite ?? false;
}

/**
 * Get the lock holder state
 */
export function useLockHolder(): LockHolderState {
  const context = useContext(DatabaseContext);
  return context?.lockHolder ?? 'none';
}

/**
 * Check if the lock holder appears stale (potential for takeover)
 */
export function useIsLockHolderStale(): boolean {
  const context = useContext(DatabaseContext);
  return context?.isLockHolderStale ?? false;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create connection state from db-manager open result
 *
 * Use this to translate worker-level lock state to UI context state.
 *
 * @param dbId Database identifier
 * @param openResult Result from openDatabaseWithLock
 * @returns Connection state for context update
 */
export function connectionStateFromOpenResult(
  dbId: string,
  openResult: { success: boolean; isWriter: boolean; holderStale: boolean }
): Partial<DatabaseConnectionState> {
  if (!openResult.success) {
    return {
      isOpen: false,
      dbId: null,
      isReadOnly: false,
      lockHolder: 'none',
      isLockHolderStale: false,
    };
  }

  return {
    isOpen: true,
    dbId,
    isReadOnly: !openResult.isWriter,
    lockHolder: openResult.isWriter ? 'self' : 'other',
    isLockHolderStale: openResult.holderStale,
  };
}

/**
 * Create closed connection state
 *
 * Use this when closing a database connection.
 */
export function closedConnectionState(): DatabaseConnectionState {
  return { ...initialState };
}
