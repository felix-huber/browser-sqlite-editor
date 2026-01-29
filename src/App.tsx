/**
 * Main Application Component
 *
 * Wires together all the application components:
 * - Sidebar navigation with database tree
 * - Welcome screen when no database is active
 * - NewDatabaseDialog for creating databases
 * - SQL Editor for queries
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { UpdateBanner } from './components/common/UpdateBanner';
import { ReadOnlyBanner } from './components/common/ReadOnlyBanner';
import { StorageFullBanner } from './components/common/StorageFullBanner';
import { PersistenceErrorBanner } from './components/common/PersistenceErrorBanner';
import { QuotaExceededModal } from './components/common/QuotaExceededModal';
import { PersistenceErrorModal } from './components/common/PersistenceErrorModal';
import { useFocusTrap } from './hooks/useFocusTrap';
import { NewDatabaseDialog } from './components/common/NewDatabaseDialog';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { Welcome } from './components/welcome/Welcome';
import { Sidebar } from './components/sidebar';
import { SqlEditorPanel } from './components/sql';
import { StatusBar } from './components/layout/StatusBar';
import { OpenDatabaseButton } from './components/layout/OpenDatabaseButton';
import {
  useDatabaseStore,
  useDatabases,
  useIsReadOnly,
  useStorageStatus,
  loadRegistry,
  createDb,
  openDb,
  closeDb,
} from './store';
import { getWorkerClient, WorkerClient } from './lib/worker-client';
import { useGlobalShortcutHandlers } from './hooks/useKeyboardShortcuts';
import { loadHistory, addToHistory } from './lib/history';
import type { QueryResult, QueryHistoryItem, DatabaseRegistry } from './types';

/** View types for the main content area */
type ViewType = 'welcome' | 'table' | 'sql' | 'erd' | 'designer' | 'query-builder';

interface ActiveView {
  type: ViewType;
  tableName?: string;
  viewName?: string;
}

type TestApi = {
  getRegistry: () => Promise<DatabaseRegistry | null>;
};

function App() {
  const databases = useDatabases();
  const activeDbId = useDatabaseStore((state) => state.activeDbId);
  const isReadOnly = useIsReadOnly();
  const storageStatus = useStorageStatus();

  // UI State
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newDbDialogOpen, setNewDbDialogOpen] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>({ type: 'welcome' });
  const [isLoading, setIsLoading] = useState(true);
  const [importError, setImportError] = useState<string | null>(null);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [showPersistenceModal, setShowPersistenceModal] = useState(false);
  const [quotaModalShownForDb, setQuotaModalShownForDb] = useState<string | null>(null);
  const [persistenceModalShown, setPersistenceModalShown] = useState(false);
  const isAnyDialogOpen =
    newDbDialogOpen || Boolean(importError) || showQuotaModal || showPersistenceModal;
  const { containerRef: appFocusTrapRef } = useFocusTrap<HTMLDivElement>({
    isActive: !isAnyDialogOpen,
    autoFocus: false,
    returnFocus: false,
  });

  // Worker client ref
  const workerClientRef = useRef<WorkerClient | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef<Promise<void> | null>(null);

  // Query history state
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);

  // Initialize worker on mount
  useEffect(() => {
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

        // Load registry
        await loadRegistry();
      } catch (err) {
        console.error('Failed to initialize:', err);
      } finally {
        setIsLoading(false);
      }
    })();

    workerReadyRef.current = initPromise;

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
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
      // When a database is opened, show SQL editor by default
      setActiveView({ type: 'sql' });
      // Load query history for this database
      setHistory(loadHistory(activeDbId));
      setQuotaModalShownForDb(null);
    } else {
      setActiveView({ type: 'welcome' });
      setHistory([]);
      setQuotaModalShownForDb(null);
    }
  }, [activeDbId]);

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
  const handleCreateDb = useCallback(async (name: string) => {
    try {
      await createDb(name);
      setNewDbDialogOpen(false);
    } catch (err) {
      console.error('Failed to create database:', err);
    }
  }, []);

  // Handle opening a database (from recent list)
  const handleSelectDatabase = useCallback(async (dbName: string) => {
    try {
      await openDb(dbName);
    } catch (err) {
      console.error('Failed to open database:', err);
    }
  }, []);

  // Handle SQLite file import
  const handleSqliteImport = useCallback(async (file: File) => {
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
      // Open the imported database
      await openDb(importResult.dbName ?? baseName);
    } catch (err) {
      console.error('Failed to import SQLite file:', err);
      setImportError(err instanceof Error ? err.message : 'Failed to import database');
    }
  }, []);

  const handleOpenSample = useCallback(async () => {
    try {
      const response = await fetch('/sakila.db');
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

  // Handle table selection from sidebar
  const handleSelectTable = useCallback(async (dbName: string, tableName: string) => {
    // Open the database if not already active
    if (dbName !== activeDbId) {
      try {
        await openDb(dbName);
      } catch (err) {
        console.error('Failed to open database:', err);
        return;
      }
    }
    setActiveView({ type: 'table', tableName });
  }, [activeDbId]);

  // Handle view selection from sidebar
  const handleSelectView = useCallback(async (dbName: string, viewName: string) => {
    if (dbName !== activeDbId) {
      try {
        await openDb(dbName);
      } catch (err) {
        console.error('Failed to open database:', err);
        return;
      }
    }
    setActiveView({ type: 'table', viewName });
  }, [activeDbId]);

  // Handle close database
  const handleCloseDb = useCallback(async () => {
    try {
      await closeDb();
    } catch (err) {
      console.error('Failed to close database:', err);
    }
  }, []);

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

    return result;
  }, [activeDbId]);

  // Cancel query
  const handleCancelQuery = useCallback(async () => {
    const client = workerClientRef.current;
    if (client) {
      await client.cancel();
    }
  }, []);

  // Keyboard shortcuts
  useGlobalShortcutHandlers({
    onNewDatabase: () => setNewDbDialogOpen(true),
    onCloseDatabase: handleCloseDb,
  });

  // Render main content based on active view
  const renderMainContent = () => {
    if (!activeDbId) {
      return (
        <div className="relative flex-1 flex">
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
            onOpenSample={handleOpenSample}
            onSelectDatabase={handleSelectDatabase}
            showRecentDatabases={databases.length > 0}
          />
        </div>
      );
    }

    switch (activeView.type) {
      case 'table': {
        // For now, redirect to SQL editor with a SELECT query
        // Quote identifier to prevent SQL injection
        const tableName = activeView.tableName || activeView.viewName || '';
        const quotedName = `"${tableName.replace(/"/g, '""')}"`;
        return (
          <SqlEditorPanel
            onExecute={handleExecuteQuery}
            onCancel={handleCancelQuery}
            history={history}
            isReadOnly={isReadOnly}
            initialValue={`SELECT * FROM ${quotedName} LIMIT 100;`}
          />
        );
      }
      case 'sql':
        return (
          <SqlEditorPanel
            onExecute={handleExecuteQuery}
            onCancel={handleCancelQuery}
            history={history}
            isReadOnly={isReadOnly}
          />
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
                onClick={() => setActiveView({ type: 'sql' })}
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
                onClick={() => setActiveView({ type: 'sql' })}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeView.type === 'sql'
                    ? 'bg-white text-navy-900 shadow-sm'
                    : 'text-navy-600 hover:text-navy-900'
                }`}
              >
                SQL
              </button>
              <button
                onClick={() => setActiveView({ type: 'erd' })}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeView.type === 'erd'
                    ? 'bg-white text-navy-900 shadow-sm'
                    : 'text-navy-600 hover:text-navy-900'
                }`}
              >
                ERD
              </button>
            </div>
          )}

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {activeDbId && (
              <button
                onClick={handleCloseDb}
                className="px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-navy-100 rounded transition-colors"
              >
                Close DB
              </button>
            )}
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <Sidebar
            collapsed={sidebarCollapsed}
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
    </>
  );
}

export default App;
