/**
 * SettingsPanel Component
 *
 * A modal panel for managing application and database settings.
 *
 * Features:
 * - Storage section: mode, usage, clear all data
 * - Database section: FK enforcement toggle, journal mode display
 * - UI preferences: theme, default page size, auto-save toggle
 *
 * Opens via Cmd/Ctrl+, keyboard shortcut
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDatabaseStore, useStorageMode, useActiveDb } from '../../store';
import { getWorkerClient } from '../../lib/worker-client';

// =============================================================================
// Types
// =============================================================================

export type Theme = 'light' | 'dark' | 'system';

export interface GlobalSettings {
  theme: Theme;
  defaultPageSize: number;
  autoSave: boolean;
}

export interface StorageInfo {
  mode: 'opfs' | 'idb' | null;
  usedBytes: number;
  quotaBytes: number;
}

export interface DatabaseSettings {
  fkEnforced: boolean;
  journalMode: string;
}

export interface SettingsPanelProps {
  /** Whether the panel is open */
  isOpen: boolean;
  /** Callback when panel should close */
  onClose: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const SETTINGS_STORAGE_KEY = 'sqlite-editor-settings';
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500];

const DEFAULT_SETTINGS: GlobalSettings = {
  theme: 'system',
  defaultPageSize: 100,
  autoSave: true,
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Load global settings from localStorage
 */
export function loadGlobalSettings(): GlobalSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_SETTINGS;
}

/**
 * Save global settings to localStorage
 */
export function saveGlobalSettings(settings: GlobalSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Apply theme to document
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
  } else {
    root.classList.toggle('dark', theme === 'dark');
  }
}

// =============================================================================
// Custom Hooks
// =============================================================================

/**
 * Hook to manage storage info
 */
function useStorageInfo(): StorageInfo {
  const storageMode = useStorageMode();
  const [info, setInfo] = useState<StorageInfo>({
    mode: storageMode,
    usedBytes: 0,
    quotaBytes: 0,
  });

  useEffect(() => {
    async function fetchStorageInfo() {
      try {
        if (navigator.storage?.estimate) {
          const estimate = await navigator.storage.estimate();
          setInfo({
            mode: storageMode,
            usedBytes: estimate.usage ?? 0,
            quotaBytes: estimate.quota ?? 0,
          });
        }
      } catch {
        // Ignore errors
      }
    }
    fetchStorageInfo();
  }, [storageMode]);

  return info;
}

/**
 * Hook to manage database settings (FK enforcement, journal mode)
 */
function useDatabaseSettings(): {
  settings: DatabaseSettings | null;
  toggleForeignKeys: () => Promise<void>;
  isLoading: boolean;
} {
  const activeDb = useActiveDb();
  const [settings, setSettings] = useState<DatabaseSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Load settings when active DB changes
  useEffect(() => {
    if (!activeDb) {
      setSettings(null);
      return;
    }

    async function loadSettings() {
      try {
        const client = getWorkerClient();

        // Get FK status
        const fkResult = await client.query('PRAGMA foreign_keys');
        const fkEnabled = fkResult.rows[0]?.[0] === 1;

        // Get journal mode
        const journalResult = await client.query('PRAGMA journal_mode');
        const journalMode = String(journalResult.rows[0]?.[0] ?? 'unknown');

        setSettings({
          fkEnforced: fkEnabled,
          journalMode,
        });
      } catch {
        setSettings(null);
      }
    }
    loadSettings();
  }, [activeDb]);

  const toggleForeignKeys = useCallback(async () => {
    if (!activeDb || !settings || isLoading) return;

    setIsLoading(true);
    try {
      const client = getWorkerClient();
      const newValue = settings.fkEnforced ? 0 : 1;
      await client.exec(`PRAGMA foreign_keys = ${newValue}`);

      // Verify the change took effect
      const result = await client.query('PRAGMA foreign_keys');
      const fkEnabled = result.rows[0]?.[0] === 1;

      setSettings(prev => prev ? { ...prev, fkEnforced: fkEnabled } : null);
    } catch (err) {
      console.error('Failed to toggle foreign keys:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeDb, settings, isLoading]);

  return { settings, toggleForeignKeys, isLoading };
}

// =============================================================================
// Component
// =============================================================================

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(loadGlobalSettings);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const storageInfo = useStorageInfo();
  const { settings: dbSettings, toggleForeignKeys, isLoading: isFkLoading } = useDatabaseSettings();
  const activeDb = useActiveDb();
  const databases = useDatabaseStore(state => state.databases);

  const panelRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Update global settings
  const updateSettings = useCallback((updates: Partial<GlobalSettings>) => {
    setGlobalSettings(prev => {
      const newSettings = { ...prev, ...updates };
      saveGlobalSettings(newSettings);

      // Apply theme immediately if changed
      if (updates.theme !== undefined) {
        applyTheme(updates.theme);
      }

      return newSettings;
    });
  }, []);

  // Handle clear all data
  const handleClearData = useCallback(async () => {
    setIsClearing(true);
    try {
      const client = getWorkerClient();

      // Delete all databases
      for (const db of databases) {
        await client.deleteDb(db.name);
      }

      // Clear registry
      localStorage.removeItem(SETTINGS_STORAGE_KEY);

      // Reload to reset state
      window.location.reload();
    } catch (err) {
      console.error('Failed to clear data:', err);
      setIsClearing(false);
      setShowClearConfirm(false);
    }
  }, [databases]);

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) {
    return null;
  }

  const usagePercent = storageInfo.quotaBytes > 0
    ? (storageInfo.usedBytes / storageInfo.quotaBytes) * 100
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      data-testid="settings-panel-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-panel-title"
    >
      <div
        ref={panelRef}
        className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        data-testid="settings-panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-navy-200">
          <h2
            id="settings-panel-title"
            className="text-xl font-semibold text-navy-900"
          >
            Settings
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-navy-500 hover:bg-navy-100 rounded transition-colors"
            aria-label="Close settings"
            data-testid="settings-close-button"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* Storage Section */}
          <section data-testid="storage-section">
            <h3 className="text-sm font-semibold text-navy-900 uppercase tracking-wide mb-4">
              Storage
            </h3>

            {/* Storage Mode */}
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-navy-700">Storage Mode</span>
              <span className="text-sm font-medium text-navy-900" data-testid="storage-mode">
                {storageInfo.mode === 'opfs' ? 'OPFS' : storageInfo.mode === 'idb' ? 'IndexedDB' : 'Unknown'}
              </span>
            </div>

            {/* Storage Usage */}
            <div className="py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-navy-700">Storage Usage</span>
                <span className="text-sm font-medium text-navy-900" data-testid="storage-usage">
                  {formatBytes(storageInfo.usedBytes)} of {formatBytes(storageInfo.quotaBytes)}
                </span>
              </div>
              <div className="h-2 bg-navy-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-navy-600 rounded-full transition-all"
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                  data-testid="storage-usage-bar"
                />
              </div>
            </div>

            {/* Clear All Data */}
            <div className="pt-4">
              {!showClearConfirm ? (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
                  data-testid="clear-data-button"
                >
                  Clear All Data
                </button>
              ) : (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800 mb-3">
                    This will delete all databases and settings. This action cannot be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleClearData}
                      disabled={isClearing}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                      data-testid="confirm-clear-button"
                    >
                      {isClearing ? 'Clearing...' : 'Yes, Delete Everything'}
                    </button>
                    <button
                      onClick={() => setShowClearConfirm(false)}
                      disabled={isClearing}
                      className="px-4 py-2 text-sm font-medium text-navy-700 border border-navy-300 rounded-lg hover:bg-navy-50 transition-colors"
                      data-testid="cancel-clear-button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Database Section */}
          {activeDb && (
            <section data-testid="database-section">
              <h3 className="text-sm font-semibold text-navy-900 uppercase tracking-wide mb-4">
                Database: {activeDb.name}
              </h3>

              {/* Foreign Keys Toggle */}
              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm text-navy-700">Foreign Key Enforcement</span>
                  <p className="text-xs text-navy-500">PRAGMA foreign_keys</p>
                </div>
                <button
                  onClick={toggleForeignKeys}
                  disabled={isFkLoading || !dbSettings}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    dbSettings?.fkEnforced
                      ? 'bg-navy-600'
                      : 'bg-navy-300'
                  } ${isFkLoading ? 'opacity-50' : ''}`}
                  role="switch"
                  aria-checked={dbSettings?.fkEnforced ?? false}
                  aria-label="Toggle foreign key enforcement"
                  data-testid="fk-toggle"
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                      dbSettings?.fkEnforced ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Journal Mode */}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-navy-700">Journal Mode</span>
                <span className="text-sm font-medium text-navy-900 uppercase" data-testid="journal-mode">
                  {dbSettings?.journalMode ?? 'Unknown'}
                </span>
              </div>
            </section>
          )}

          {/* UI Preferences Section */}
          <section data-testid="ui-preferences-section">
            <h3 className="text-sm font-semibold text-navy-900 uppercase tracking-wide mb-4">
              UI Preferences
            </h3>

            {/* Theme */}
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-navy-700">Theme</span>
              <select
                value={globalSettings.theme}
                onChange={(e) => updateSettings({ theme: e.target.value as Theme })}
                className="px-3 py-1.5 text-sm border border-navy-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-600"
                data-testid="theme-select"
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </div>

            {/* Default Page Size */}
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-navy-700">Default Page Size</span>
              <select
                value={globalSettings.defaultPageSize}
                onChange={(e) => updateSettings({ defaultPageSize: Number(e.target.value) })}
                className="px-3 py-1.5 text-sm border border-navy-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-600"
                data-testid="page-size-select"
              >
                {PAGE_SIZE_OPTIONS.map(size => (
                  <option key={size} value={size}>{size} rows</option>
                ))}
              </select>
            </div>

            {/* Auto-Save */}
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-navy-700">Auto-Save</span>
                <p className="text-xs text-navy-500">Automatically save changes (OPFS mode)</p>
              </div>
              <button
                onClick={() => updateSettings({ autoSave: !globalSettings.autoSave })}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  globalSettings.autoSave
                    ? 'bg-navy-600'
                    : 'bg-navy-300'
                }`}
                role="switch"
                aria-checked={globalSettings.autoSave}
                aria-label="Toggle auto-save"
                data-testid="autosave-toggle"
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                    globalSettings.autoSave ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </section>

          {/* Keyboard Shortcuts Reference */}
          <section data-testid="shortcuts-section">
            <h3 className="text-sm font-semibold text-navy-900 uppercase tracking-wide mb-4">
              Keyboard Shortcuts
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between py-1">
                <span className="text-navy-700">Open Settings</span>
                <kbd className="px-2 py-0.5 bg-navy-100 text-navy-700 rounded text-xs font-mono">
                  {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} + ,
                </kbd>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-navy-200 bg-navy-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-navy-700 border border-navy-300 rounded-lg hover:bg-white transition-colors"
            data-testid="settings-done-button"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Keyboard Shortcut Hook
// =============================================================================

/**
 * Hook to handle Cmd/Ctrl+, keyboard shortcut for opening settings
 */
export function useSettingsShortcut(onOpen: () => void): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.includes('Mac');
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key === ',') {
        e.preventDefault();
        onOpen();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onOpen]);
}

export default SettingsPanel;
