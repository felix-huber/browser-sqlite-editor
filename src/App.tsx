/**
 * Main Application Component
 *
 * Wires together all the application components:
 * - Sidebar navigation with database tree
 * - Welcome screen when no database is active
 * - NewDatabaseDialog for creating databases
 * - SQL Editor for queries
 */

import { useEffect, useState, useCallback, useRef, Suspense, lazy } from 'react';
import { UpdateBanner } from './shared/components/UpdateBanner';
import { ReadOnlyBanner } from './shared/components/ReadOnlyBanner';
import { StorageFullBanner } from './shared/components/StorageFullBanner';
import { PersistenceErrorBanner } from './shared/components/PersistenceErrorBanner';
import { QuotaExceededModal } from './shared/components/QuotaExceededModal';
import { PersistenceErrorModal } from './shared/components/PersistenceErrorModal';
import { SizeWarningToast } from './shared/components/SizeWarningToast';
import { UnsavedPrompt, type UnsavedPromptAction } from './shared/components/UnsavedPrompt';
import { useFocusTrap } from './shared/hooks/useFocusTrap';
import { NewDatabaseDialog } from './shared/components/NewDatabaseDialog';
import { ConfirmDialog } from './shared/components/ConfirmDialog';
import { Welcome } from './features/welcome/Welcome';
import { Sidebar } from './features/sidebar';
import type { GridEditActions } from './features/grid/DataGrid';
import { ImportDialog } from './features/import/ImportDialog';
import { StatusBar } from './shared/layout/StatusBar';
import { OpenDatabaseButton } from './shared/layout/OpenDatabaseButton';
import { importData, createTableAndImport, type ColumnType } from './core/io/import';
import { sanitizeDbName, validateDbName, isNameAvailable } from './core/db/db-name';
import {
  useDatabaseStore,
  useDatabases,
  useTables,
  useViews,
  useIsReadOnly,
  useStorageStatus,
  loadRegistry,
  createDb,
  openDb,
  closeDb,
  refreshSchema,
  refreshSizeWarning,
} from './store';
import { getWorkerClient, WorkerClient } from './core/worker/client';
import { DEBUG } from './shared/utils/debug';
import { useGlobalShortcutHandlers } from './shared/hooks/useKeyboardShortcuts';
import { useUnsavedPrompt, type DirtyState } from './shared/hooks/useUnsavedPrompt';
import { loadHistory, addToHistory } from './core/sql/history';
import type { QueryResult, QueryHistoryItem, DatabaseRegistry } from './types';

const ERDView = lazy(() => import('./features/erd/ERDView'));
const QueryBuilderView = lazy(() => import('./features/query-builder/QueryBuilderView'));
const SqlEditorPanel = lazy(() => import('./features/sql/SqlEditorPanel'));
const TableView = lazy(() => import('./features/table/TableView'));
const TableDesignerView = lazy(() => import('./features/designer/TableDesignerView'));

/** View types for the main content area */
type ViewType = 'welcome' | 'table' | 'sql' | 'erd' | 'designer' | 'query-builder';

interface ActiveView {
  type: ViewType;
  tableName?: string;
  viewName?: string;
}

type TestApi = {
  getRegistry: () => Promise<DatabaseRegistry | null>;
  refreshSizeWarning: () => Promise<void>;
  /** Simulate a size warning for testing the toast UI without needing actual large files */
  simulateSizeWarning: (dbId: string, sizeBytes: number, storageMode: 'opfs' | 'idb') => void;
  /** Clear the current size warning */
  clearSizeWarning: () => void;
  /** Close the currently open database (for test isolation) */
  closeDatabase: () => Promise<void>;
  /** Reset the store to initial state (for test isolation) */
  resetStore: () => void;
  /** Check if a database is currently open */
  hasActiveDatabase: () => boolean;
};

function App() {
  const databases = useDatabases();
  const activeDbId = useDatabaseStore((state) => state.activeDbId);
  const tables = useTables();
  const views = useViews();
  const isReadOnly = useIsReadOnly();
  const storageStatus = useStorageStatus();

  // UI State
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newDbDialogOpen, setNewDbDialogOpen] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>({ type: 'welcome' });
  const [pendingView, setPendingView] = useState<ActiveView | null>(null);
  const [lastTableSelection, setLastTableSelection] = useState<string | null>(null);
  const [lastViewSelection, setLastViewSelection] = useState<string | null>(null);
  const [sqlInitialValue, setSqlInitialValue] = useState<string | undefined>(undefined);
  const [sqlEditorKey, setSqlEditorKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [importError, setImportError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importDialogFile, setImportDialogFile] = useState<File | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [showPersistenceModal, setShowPersistenceModal] = useState(false);
  const [quotaModalShownForDb, setQuotaModalShownForDb] = useState<string | null>(null);
  const [persistenceModalShown, setPersistenceModalShown] = useState(false);
  const gridEditActionsRef = useRef<GridEditActions | null>(null);
  const dirtyStateRef = useRef<DirtyState>({
    grid: false,
    designer: false,
    sql: false,
    queryBuilder: false,
    erd: false,
  });
  const handleSaveDirtyState = useCallback(async () => {
    const state = dirtyStateRef.current;
    if (state.grid && gridEditActionsRef.current?.hasEdit) {
      return gridEditActionsRef.current.commit();
    }
    return false;
  }, []);
  const {
    setDirty,
    checkUnsaved,
    handlePromptAction,
    isPromptOpen,
    promptContext,
    canSave,
    dirtyState,
  } = useUnsavedPrompt({ enableBeforeUnload: true, onSave: handleSaveDirtyState });

  useEffect(() => {
    dirtyStateRef.current = dirtyState;
  }, [dirtyState]);

  const handleUnsavedAction = useCallback(
    (action: UnsavedPromptAction) => {
      if (action === 'discard') {
        const state = dirtyStateRef.current;
        if (state.grid && gridEditActionsRef.current?.hasEdit) {
          gridEditActionsRef.current.cancel();
        }
      }
      handlePromptAction(action);
    },
    [handlePromptAction]
  );

  const confirmNavigation = useCallback(
    async (action: string) => {
      const result = await checkUnsaved(action);
      return result.success;
    },
    [checkUnsaved]
  );

  const isAnyDialogOpen =
    newDbDialogOpen ||
    Boolean(importError) ||
    importDialogOpen ||
    Boolean(exportError) ||
    showQuotaModal ||
    showPersistenceModal ||
    isPromptOpen;
  const { containerRef: appFocusTrapRef } = useFocusTrap<HTMLDivElement>({
    isActive: !isAnyDialogOpen,
    autoFocus: false,
    returnFocus: false,
  });

  // Worker client ref
  const workerClientRef = useRef<WorkerClient | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef<Promise<void> | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Query history state
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);

  // Initialize worker on mount
  useEffect(() => {
    let isActive = true;
    const initPromise = (async () => {
      try {
        // Create worker
        const worker = new Worker(
          new URL('./worker/index.ts', import.meta.url),
          { type: 'module' }
        );
        workerRef.current = worker;

        // Initialize worker client
        const client = getWorkerClient();
        client.init(worker);
        workerClientRef.current = client;

        // Wait for worker to be ready
        await client.ping();

        // Send debug mode to worker
        if (DEBUG) {
          await client.request({ type: 'setDebugMode', enabled: true });
        }

        if (!isActive) return;

        // Load registry
        await loadRegistry();
      } catch (err) {
        if (isActive) {
          console.error('Failed to initialize:', err);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    })();

    workerReadyRef.current = initPromise;

    return () => {
      isActive = false;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      workerClientRef.current = null;
      workerReadyRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hostname = window.location.hostname;
    const isLocalhost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1';
    const isAutomation = navigator.webdriver ?? false;
    if (!isAutomation && !isLocalhost) return;

    const testApi: TestApi = {
      getRegistry: async () => {
        const ready = workerReadyRef.current;
        if (ready) {
          try {
            await ready;
          } catch {
            return null;
          }
        }

        const databases = useDatabaseStore.getState().databases;
        return { v: 1, databases };
      },
      refreshSizeWarning: async () => {
        const { refreshSizeWarning } = await import('./store');
        await refreshSizeWarning();
      },
      simulateSizeWarning: (dbId: string, sizeBytes: number, storageMode: 'opfs' | 'idb') => {
        import('./store').then(({ checkSizeWarning }) => {
          checkSizeWarning(dbId, sizeBytes, storageMode);
        });
      },
      clearSizeWarning: () => {
        import('./store').then(({ clearSizeWarning }) => {
          clearSizeWarning();
        });
      },
      closeDatabase: async () => {
        const { closeDb } = await import('./store');
        await closeDb();
      },
      resetStore: () => {
        useDatabaseStore.getState().reset();
      },
      hasActiveDatabase: () => {
        return useDatabaseStore.getState().activeDbId !== null;
      },
    };

    const win = window as Window & { __sqliteEditorTest?: TestApi };
    win.__sqliteEditorTest = testApi;

    return () => {
      if (win.__sqliteEditorTest === testApi) {
        delete win.__sqliteEditorTest;
      }
    };
  }, []);

  // Reset view and load history when active database changes
  useEffect(() => {
    if (activeDbId) {
      const nextView = pendingView ?? { type: 'sql' };
      setActiveView(nextView);
      setPendingView(null);
      // Load query history for this database
      setHistory(loadHistory(activeDbId));
      setQuotaModalShownForDb(null);
      if (!pendingView) {
        setLastTableSelection(null);
        setLastViewSelection(null);
      }
      setSqlInitialValue(undefined);
      setSqlEditorKey((key) => key + 1);
    } else {
      setActiveView({ type: 'welcome' });
      setHistory([]);
      setQuotaModalShownForDb(null);
      setLastTableSelection(null);
      setLastViewSelection(null);
      setSqlInitialValue(undefined);
    }
  }, [activeDbId, pendingView]);

  // Show quota exceeded modal once per DB/session
  useEffect(() => {
    if (storageStatus === 'quota_exceeded') {
      if (activeDbId && quotaModalShownForDb !== activeDbId) {
        setShowQuotaModal(true);
        setQuotaModalShownForDb(activeDbId);
      } else if (!activeDbId) {
        setShowQuotaModal(true);
      }
      return;
    }

    if (storageStatus === 'ok') {
      setShowQuotaModal(false);
    }
  }, [storageStatus, activeDbId, quotaModalShownForDb]);

  // Show persistence error modal once per degraded session
  useEffect(() => {
    if (storageStatus === 'degraded' && !persistenceModalShown) {
      setShowPersistenceModal(true);
      setPersistenceModalShown(true);
      return;
    }

    if (storageStatus === 'ok') {
      setShowPersistenceModal(false);
      setPersistenceModalShown(false);
    }
  }, [storageStatus, persistenceModalShown]);

  // Handle creating a new database
  const handleCreateDb = useCallback(async (name: string): Promise<boolean> => {
    const ok = await confirmNavigation('create database');
    if (!ok) return false;
    try {
      await createDb(name);
      setNewDbDialogOpen(false);
      return true;
    } catch (err) {
      console.error('Failed to create database:', err);
      throw err;
    }
  }, [confirmNavigation]);

  // Handle opening a database (from recent list)
  const handleSelectDatabase = useCallback(async (dbName: string) => {
    if (dbName === activeDbId) {
      return true;
    }
    const ok = await confirmNavigation('switch database');
    if (!ok) return false;
    try {
      await openDb(dbName);
      return true;
    } catch (err) {
      console.error('Failed to open database:', err);
      return false;
    }
  }, [activeDbId, confirmNavigation]);

  // Handle SQLite file import
  const handleSqliteImport = useCallback(async (file: File) => {
    const ok = await confirmNavigation('import database');
    if (!ok) return;
    try {
      setImportError(null);
      const ready = workerReadyRef.current;
      if (ready) {
        await ready;
      }
      const client = workerClientRef.current;
      if (!client) throw new Error('Worker not initialized');

      // Extract database name from file name (remove extension)
      const baseName = file.name.replace(/\.(sqlite|db|sqlite3)$/i, '') || 'imported';
      const importResult = await client.importFile(file, baseName);
      await loadRegistry();
      // Open the imported database (also triggers size warning check)
      await openDb(importResult.dbName ?? baseName);
      // Re-check size after import (in case file was large)
      await refreshSizeWarning();
    } catch (err) {
      console.error('Failed to import SQLite file:', err);
      setImportError(err instanceof Error ? err.message : 'Failed to import database');
    }
  }, [confirmNavigation]);

  const resolveImportDbName = useCallback(
    (file: File): string => {
      const base = file.name.replace(/\.[^/.]+$/, '') || 'imported';
      const sanitized = sanitizeDbName(base) || 'imported';
      let candidate = sanitized;
      const validation = validateDbName(candidate);
      if (!validation.valid) {
        candidate = 'imported';
      }
      const existingNames = databases.map((db) => db.name);
      let counter = 0;
      while (!isNameAvailable(candidate, existingNames)) {
        counter += 1;
        candidate = `${sanitized} (${counter})`;
      }
      return candidate;
    },
    [databases]
  );

  const ensureImportDatabase = useCallback(
    async (file: File): Promise<string> => {
      if (activeDbId) return activeDbId;
      const name = resolveImportDbName(file);
      await createDb(name);
      return name;
    },
    [activeDbId, resolveImportDbName]
  );

  const handleDataFileImport = useCallback(
    async (file: File) => {
      const ok = await confirmNavigation('import data');
      if (!ok) return;
      try {
        await ensureImportDatabase(file);
        setImportDialogFile(file);
        setImportDialogOpen(true);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Failed to start data import');
      }
    },
    [confirmNavigation, ensureImportDatabase]
  );

  const handleImportInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        await handleDataFileImport(file);
        event.target.value = '';
      }
    },
    [handleDataFileImport]
  );

  const handleOpenSample = useCallback(async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}sakila.db`);
      if (!response.ok) {
        throw new Error('Failed to load sample database');
      }
      const blob = await response.blob();
      const file = new File([blob], 'sakila.db', { type: 'application/x-sqlite3' });
      await handleSqliteImport(file);
    } catch (err) {
      console.error('Failed to open sample database:', err);
      setImportError(err instanceof Error ? err.message : 'Failed to open sample database');
    }
  }, [handleSqliteImport]);

  // Handle reset app - clear all storage and reload
  const handleResetApp = useCallback(async () => {
    const client = workerClientRef.current;
    if (!client) throw new Error('Worker not initialized');

    // Clear localStorage entries
    try {
      // Clear query history keys (qh:*)
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('qh:') || key.startsWith('erd-layout:') || key === 'sqlite-editor-settings' || key.startsWith('sqlite-lock:'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (err) {
      console.warn('Failed to clear localStorage:', err);
    }

    // Clear service worker caches
    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }
    } catch (err) {
      console.warn('Failed to clear caches:', err);
    }

    // Reset worker storage (OPFS, IndexedDB registry)
    await client.resetApp();

    // Reset store state
    useDatabaseStore.getState().reset();

    // Terminate the worker to ensure all file handles and IDB connections are fully released
    // This is critical for the IndexedDB delete operations to succeed on page reload
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    workerClientRef.current = null;
  }, []);

  // Handle table selection from sidebar
  const handleSelectTable = useCallback(async (dbName: string, tableName: string) => {
    // Open the database if not already active
    if (dbName !== activeDbId) {
      const ok = await confirmNavigation('switch database');
      if (!ok) return;
      setPendingView({ type: 'table', tableName });
      try {
        await openDb(dbName);
        setLastTableSelection(tableName);
        setLastViewSelection(null);
        return;
      } catch (err) {
        console.error('Failed to open database:', err);
        setPendingView(null);
        return;
      }
    }
    const ok = await confirmNavigation('switch table');
    if (!ok) return;
    setLastTableSelection(tableName);
    setLastViewSelection(null);
    setActiveView({ type: 'table', tableName });
  }, [activeDbId, confirmNavigation]);

  // Handle view selection from sidebar
  const handleSelectView = useCallback(async (dbName: string, viewName: string) => {
    if (dbName !== activeDbId) {
      const ok = await confirmNavigation('switch database');
      if (!ok) return;
      setPendingView({ type: 'table', viewName });
      try {
        await openDb(dbName);
        setLastViewSelection(viewName);
        setLastTableSelection(null);
        return;
      } catch (err) {
        console.error('Failed to open database:', err);
        setPendingView(null);
        return;
      }
    }
    const ok = await confirmNavigation('switch view');
    if (!ok) return;
    setLastViewSelection(viewName);
    setLastTableSelection(null);
    setActiveView({ type: 'table', viewName });
  }, [activeDbId, confirmNavigation]);

  // Handle close database
  const handleCloseDb = useCallback(async () => {
    const ok = await confirmNavigation('close database');
    if (!ok) return;
    try {
      await closeDb();
    } catch (err) {
      console.error('Failed to close database:', err);
    }
  }, [confirmNavigation]);

  // Execute SQL query
  const handleExecuteQuery = useCallback(async (sql: string): Promise<QueryResult> => {
    const client = workerClientRef.current;
    if (!client) throw new Error('Worker not initialized');

    const result = await client.query(sql);

    // Add to history
    if (activeDbId) {
      addToHistory(activeDbId, sql);
      // Reload history to update UI
      setHistory(loadHistory(activeDbId));
    }

    const sqlWithoutComments = sql
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    const shouldRefresh = sqlWithoutComments
      .split(';')
      .some((statement) => {
        const trimmed = statement.trim().toUpperCase();
        return (
          trimmed.startsWith('CREATE ') ||
          trimmed.startsWith('ALTER ') ||
          trimmed.startsWith('DROP ') ||
          trimmed.startsWith('RENAME ')
        );
      });

    // Check for write operations that may grow the database
    const mightGrowDb = sqlWithoutComments
      .split(';')
      .some((statement) => {
        const trimmed = statement.trim().toUpperCase();
        return (
          trimmed.startsWith('INSERT ') ||
          trimmed.startsWith('CREATE ') ||
          trimmed.startsWith('UPDATE ') ||
          trimmed.includes(' IMPORT') ||
          trimmed.includes('ATTACH ')
        );
      });

    if (shouldRefresh) {
      await refreshSchema();
    }

    // Re-check size after operations that may grow the database
    if (mightGrowDb) {
      await refreshSizeWarning();
    }

    return result;
  }, [activeDbId]);

  // Cancel query
  const handleCancelQuery = useCallback(async () => {
    const client = workerClientRef.current;
    if (client) {
      await client.cancel();
    }
  }, []);

  const handleImportData = useCallback(
    async (options: {
      columns: Array<{ name: string; type: string }>;
      rows: unknown[][];
      tableName: string;
      appendToExisting: boolean;
      file: File;
    }) => {
      const client = workerClientRef.current;
      if (!client) throw new Error('Worker not initialized');
      if (!activeDbId) throw new Error('No active database');

      // Create executor with skipAutoRollback to allow multi-call transactions
      const executor = {
        exec: async (sql: string, params?: unknown[]) => {
          await client.exec(sql, params, { skipAutoRollback: true });
        },
        run: async (sql: string, params?: unknown[]) => {
          const result = await client.exec(sql, params, { skipAutoRollback: true });
          return { changes: result.rowsAffected ?? 0 };
        },
      };

      const importOptions = {
        tableName: options.tableName,
        columns: options.columns.map((col) => ({
          name: col.name,
          type: col.type as ColumnType,
        })),
        rows: options.rows,
      };

      const result = options.appendToExisting
        ? await importData(executor, importOptions)
        : await createTableAndImport(executor, importOptions);

      if (!result.success) {
        const parts: string[] = [];
        if (result.error?.rowNumber) {
          parts.push(`Row ${result.error.rowNumber}`);
        }
        if (result.error?.type) {
          parts.push(result.error.type);
        }
        const prefix = parts.length > 0 ? `${parts.join(' - ')}: ` : '';
        throw new Error(`${prefix}${result.error?.message ?? 'Import failed'}`);
      }

      await refreshSchema();
      // Re-check size after data import
      await refreshSizeWarning();
      setLastTableSelection(options.tableName);
      setLastViewSelection(null);
      setActiveView({ type: 'table', tableName: options.tableName });
    },
    [activeDbId]
  );

  const handleExportDb = useCallback(async () => {
    if (!activeDbId) return;
    const client = workerClientRef.current;
    if (!client) {
      setExportError('Worker not initialized');
      return;
    }
    try {
      const blob = await client.exportDb(activeDbId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${activeDbId}.sqlite`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export database');
    }
  }, [activeDbId]);

  // Keyboard shortcuts
  useGlobalShortcutHandlers({
    onNewDatabase: () => setNewDbDialogOpen(true),
    onCloseDatabase: handleCloseDb,
  });

  const resolveTableView = useCallback((): ActiveView => {
    if (lastTableSelection) {
      return { type: 'table', tableName: lastTableSelection };
    }
    if (lastViewSelection) {
      return { type: 'table', viewName: lastViewSelection };
    }
    if (tables.length > 0) {
      return { type: 'table', tableName: tables[0] };
    }
    if (views.length > 0) {
      return { type: 'table', viewName: views[0] };
    }
    return { type: 'table' };
  }, [lastTableSelection, lastViewSelection, tables, views]);

  const handleOpenSqlTab = useCallback(async () => {
    const ok = await confirmNavigation('switch to SQL editor');
    if (!ok) return;
    setActiveView({ type: 'sql' });
  }, [confirmNavigation]);

  const openSqlWithQuery = useCallback(
    async (sql: string) => {
      const ok = await confirmNavigation('open SQL editor');
      if (!ok) return;
      setSqlInitialValue(sql);
      setSqlEditorKey((key) => key + 1);
      setActiveView({ type: 'sql' });
    },
    [confirmNavigation]
  );

  const handleOpenTableTab = useCallback(async () => {
    const ok = await confirmNavigation('switch table');
    if (!ok) return;
    const nextView = resolveTableView();
    if (nextView.tableName) {
      setLastTableSelection(nextView.tableName);
      setLastViewSelection(null);
    } else if (nextView.viewName) {
      setLastViewSelection(nextView.viewName);
      setLastTableSelection(null);
    }
    setActiveView(nextView);
  }, [confirmNavigation, resolveTableView]);

  const handleOpenDesignerTab = useCallback(async () => {
    const ok = await confirmNavigation('open table designer');
    if (!ok) return;
    const tableName = lastTableSelection ?? (tables.length > 0 ? tables[0] : undefined);
    if (tableName) {
      setActiveView({ type: 'designer', tableName });
      setLastTableSelection(tableName);
      setLastViewSelection(null);
    } else {
      setActiveView({ type: 'designer' });
    }
  }, [confirmNavigation, lastTableSelection, tables]);

  const handleOpenErdTab = useCallback(async () => {
    const ok = await confirmNavigation('open ERD');
    if (!ok) return;
    setActiveView({ type: 'erd' });
  }, [confirmNavigation]);

  const handleOpenQueryBuilderTab = useCallback(async () => {
    const ok = await confirmNavigation('open query builder');
    if (!ok) return;
    setActiveView({ type: 'query-builder' });
  }, [confirmNavigation]);

  const handleDesignerOpenTable = useCallback(
    async (tableName: string) => {
      const ok = await confirmNavigation('open table');
      if (!ok) return;
      setLastTableSelection(tableName);
      setLastViewSelection(null);
      setActiveView({ type: 'table', tableName });
    },
    [confirmNavigation]
  );

  const handleOpenDesignerFromErd = useCallback(
    async (tableName: string) => {
      const ok = await confirmNavigation('open table designer');
      if (!ok) return;
      setLastTableSelection(tableName);
      setLastViewSelection(null);
      setActiveView({ type: 'designer', tableName });
    },
    [confirmNavigation]
  );

  const handleGridEditStateChange = useCallback(
    (isEditing: boolean) => {
      setDirty('grid', isEditing);
    },
    [setDirty]
  );

  const handleGridEditActionsChange = useCallback((actions: GridEditActions | null) => {
    gridEditActionsRef.current = actions;
  }, []);

  const handleDesignerDirtyChange = useCallback(
    (dirty: boolean) => {
      setDirty('designer', dirty);
    },
    [setDirty]
  );

  const handleQueryBuilderDirtyChange = useCallback(
    (dirty: boolean) => {
      setDirty('queryBuilder', dirty);
    },
    [setDirty]
  );

  const handleERDDirtyChange = useCallback(
    (dirty: boolean) => {
      setDirty('erd', dirty);
    },
    [setDirty]
  );

  // Render main content based on active view
  const renderMainContent = () => {
    if (!activeDbId) {
      return (
        <div className="relative flex-1 flex min-h-0">
          {isLoading && (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center bg-navy-50/80"
              aria-live="polite"
            >
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-navy-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <div className="text-navy-500">Initializing...</div>
              </div>
            </div>
          )}
          <Welcome
            onNewDatabase={() => setNewDbDialogOpen(true)}
            onSqliteImport={handleSqliteImport}
            onCsvImport={handleDataFileImport}
            onJsonImport={handleDataFileImport}
            onOpenSample={handleOpenSample}
            onSelectDatabase={handleSelectDatabase}
            showRecentDatabases={databases.length > 0}
            onResetApp={handleResetApp}
          />
        </div>
      );
    }

    const lazyFallback = (
      <div className="flex-1 flex items-center justify-center text-navy-500">
        Loading…
      </div>
    );

    switch (activeView.type) {
      case 'table': {
        const tableName = activeView.tableName || activeView.viewName || '';
        if (!tableName) {
          return (
            <div className="flex-1 flex items-center justify-center text-navy-500">
              Select a table or view from the sidebar.
            </div>
          );
        }
        return (
          <Suspense fallback={lazyFallback}>
            <TableView
              tableName={tableName}
              viewName={activeView.viewName}
              isReadOnly={isReadOnly}
              onEditStateChange={handleGridEditStateChange}
              onEditActionsChange={handleGridEditActionsChange}
              onOpenSql={openSqlWithQuery}
            />
          </Suspense>
        );
      }
      case 'designer':
        return (
          <Suspense fallback={lazyFallback}>
            <TableDesignerView
              tableName={activeView.tableName}
              isReadOnly={isReadOnly}
              onOpenTable={handleDesignerOpenTable}
              onDirtyChange={handleDesignerDirtyChange}
            />
          </Suspense>
        );
      case 'erd':
        return (
          <Suspense fallback={lazyFallback}>
            <ERDView
              onOpenDesigner={handleOpenDesignerFromErd}
              onDirtyChange={handleERDDirtyChange}
            />
          </Suspense>
        );
      case 'query-builder':
        return (
          <Suspense fallback={lazyFallback}>
            <QueryBuilderView
              isReadOnly={isReadOnly}
              onOpenSql={openSqlWithQuery}
              onDirtyChange={handleQueryBuilderDirtyChange}
            />
          </Suspense>
        );
      case 'sql':
        return (
          <Suspense fallback={lazyFallback}>
            <SqlEditorPanel
              key={sqlEditorKey}
              onExecute={handleExecuteQuery}
              onCancel={handleCancelQuery}
              history={history}
              isReadOnly={isReadOnly}
              initialValue={sqlInitialValue}
            />
          </Suspense>
        );
      case 'welcome':
      default:
        if (isLoading) {
          return (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-navy-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <div className="text-navy-500">Initializing...</div>
              </div>
            </div>
          );
        }
        return (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="text-center">
              <h2 className="text-xl font-semibold text-navy-800 mb-2">
                Database: {activeDbId}
              </h2>
              <p className="text-navy-500 mb-4">
                Select a table from the sidebar or use the SQL Editor
              </p>
              <button
                onClick={handleOpenSqlTab}
                className="px-4 py-2 bg-navy-600 text-white rounded-lg hover:bg-navy-700 transition-colors"
              >
                Open SQL Editor
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <>
      <UpdateBanner />
      <div ref={appFocusTrapRef} className="h-screen flex flex-col bg-navy-50 text-navy-900">
        {/* Banners */}
        {isReadOnly && <ReadOnlyBanner />}
        {storageStatus === 'quota_exceeded' && (
          <StorageFullBanner onFreeSpaceClick={() => setShowQuotaModal(true)} />
        )}
        {storageStatus === 'degraded' && (
          <PersistenceErrorBanner onDetailsClick={() => setShowPersistenceModal(true)} />
        )}

        {/* Header */}
        <header className="h-12 bg-white border-b border-navy-200 flex items-center px-4 gap-4 shrink-0">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-navy-600 rounded-sm" />
            <span className="font-semibold text-sm tracking-tight">SQLite Editor</span>
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-navy-200" />

          {/* Sidebar Toggle */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 text-navy-500 hover:bg-navy-100 rounded transition-colors"
            aria-label="Toggle sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <OpenDatabaseButton onFileSelect={handleSqliteImport} />
            <button
              onClick={() => setNewDbDialogOpen(true)}
              className="px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-navy-100 rounded transition-colors"
              data-testid="header-new-database-button"
            >
              New Database
            </button>
          </div>

          <div className="flex-1" />

          {/* View Tabs (when database is active) */}
          {activeDbId && (
            <div className="flex items-center gap-1 bg-navy-100 rounded-lg p-0.5">
              <button
                onClick={handleOpenSqlTab}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeView.type === 'sql'
                    ? 'bg-white text-navy-900 shadow-sm'
                    : 'text-navy-600 hover:text-navy-900'
                }`}
                data-testid="tab-sql"
              >
                SQL
              </button>
              <button
                onClick={handleOpenTableTab}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeView.type === 'table'
                    ? 'bg-white text-navy-900 shadow-sm'
                    : 'text-navy-600 hover:text-navy-900'
                }`}
                data-testid="tab-table"
              >
                Table
              </button>
              <button
                onClick={handleOpenDesignerTab}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeView.type === 'designer'
                    ? 'bg-white text-navy-900 shadow-sm'
                    : 'text-navy-600 hover:text-navy-900'
                }`}
                data-testid="tab-designer"
              >
                Designer
              </button>
              <button
                onClick={handleOpenQueryBuilderTab}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeView.type === 'query-builder'
                    ? 'bg-white text-navy-900 shadow-sm'
                    : 'text-navy-600 hover:text-navy-900'
                }`}
                data-testid="tab-query-builder"
              >
                Query Builder
              </button>
              <button
                onClick={handleOpenErdTab}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeView.type === 'erd'
                    ? 'bg-white text-navy-900 shadow-sm'
                    : 'text-navy-600 hover:text-navy-900'
                }`}
                data-testid="tab-erd"
              >
                ERD
              </button>
            </div>
          )}

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {activeDbId && (
              <>
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-navy-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="import-data-button"
                  disabled={isReadOnly}
                >
                  Import Data
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".csv,.tsv,.json"
                  onChange={handleImportInputChange}
                  className="hidden"
                  data-testid="import-data-input"
                />
                <button
                  onClick={handleExportDb}
                  className="px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-navy-100 rounded transition-colors"
                  data-testid="export-db-button"
                >
                  Download DB
                </button>
                <button
                  onClick={handleCloseDb}
                  className="px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-navy-100 rounded transition-colors"
                >
                  Close DB
                </button>
              </>
            )}
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <Sidebar
            collapsed={sidebarCollapsed}
            onOpenDatabase={handleSelectDatabase}
            onSelectTable={handleSelectTable}
            onSelectView={handleSelectView}
          />

          {/* Main Area */}
          <main className="flex-1 flex flex-col overflow-hidden bg-navy-50">
            {renderMainContent()}
          </main>
        </div>

        {/* Status Bar */}
        <StatusBar />
      </div>

      {/* Dialogs */}
      <UnsavedPrompt
        isOpen={isPromptOpen}
        context={promptContext}
        canSave={canSave}
        onAction={handleUnsavedAction}
      />

      <NewDatabaseDialog
        isOpen={newDbDialogOpen}
        onClose={() => setNewDbDialogOpen(false)}
        onCreate={handleCreateDb}
        existingNames={databases.map((db) => db.name)}
        isReadOnly={isReadOnly}
      />

      <QuotaExceededModal
        isOpen={showQuotaModal}
        onClose={() => setShowQuotaModal(false)}
        onStorageFreed={() => {
          setShowQuotaModal(false);
          setQuotaModalShownForDb(activeDbId ?? null);
        }}
      />

      <PersistenceErrorModal
        isOpen={showPersistenceModal}
        onClose={() => setShowPersistenceModal(false)}
        onRetrySuccess={() => setPersistenceModalShown(false)}
        onDiscardChanges={() => setPersistenceModalShown(false)}
      />

      <ImportDialog
        isOpen={importDialogOpen}
        onClose={() => {
          setImportDialogOpen(false);
          setImportDialogFile(null);
        }}
        onImport={handleImportData}
        existingTables={tables}
        isReadOnly={isReadOnly}
        initialFile={importDialogFile}
      />

      {/* Import Error Dialog */}
      {importError && (
        <ConfirmDialog
          isOpen={true}
          title="Import Failed"
          message={importError}
          confirmLabel="OK"
          onConfirm={() => setImportError(null)}
          onCancel={() => setImportError(null)}
        />
      )}

      {exportError && (
        <ConfirmDialog
          isOpen={true}
          title="Export Failed"
          message={exportError}
          confirmLabel="OK"
          onConfirm={() => setExportError(null)}
          onCancel={() => setExportError(null)}
        />
      )}

      {/* Size Warning Toast */}
      <SizeWarningToast />
    </>
  );
}

export default App;
