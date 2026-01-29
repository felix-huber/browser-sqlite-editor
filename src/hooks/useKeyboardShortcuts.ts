/**
 * useKeyboardShortcuts Hook
 *
 * Centralized keyboard shortcut management for the SQLite Editor.
 *
 * Features:
 * - Platform-aware modifier detection (Cmd on Mac, Ctrl on Windows/Linux)
 * - Scoped shortcuts (global vs component-specific)
 * - Conflict resolution (component shortcuts override global)
 * - Easy registration and cleanup
 *
 * Shortcuts:
 *
 * Global:
 * - Cmd/Ctrl+O: Open database file picker
 * - Cmd/Ctrl+N: New database dialog
 * - Cmd/Ctrl+S: Save/commit pending changes (if any)
 * - Cmd/Ctrl+W: Close current database
 * - Cmd/Ctrl+,: Open settings
 *
 * SQL Editor (registered by SqlEditorPanel):
 * - Cmd/Ctrl+Enter: Execute query
 * - Cmd/Ctrl+Shift+Enter: Execute and explain
 * - Escape: Cancel running query
 *
 * Data Grid (registered by DataGrid):
 * - Enter: Start editing selected cell
 * - Escape: Cancel edit
 * - Delete/Backspace: Clear cell (set NULL) or delete row
 * - Cmd/Ctrl+C: Copy cell value
 * - Arrow keys: Navigate cells
 */

import { useEffect, useCallback, useRef } from 'react';

// =============================================================================
// Types
// =============================================================================

/** Keyboard shortcut definition */
export interface KeyboardShortcut {
  /** Unique identifier for the shortcut */
  id: string;
  /** The key to listen for (e.g., 'Enter', 'o', ',', 'ArrowUp') */
  key: string;
  /** Require Cmd (Mac) or Ctrl (Windows/Linux) */
  meta?: boolean;
  /** Require Shift key */
  shift?: boolean;
  /** Require Alt/Option key */
  alt?: boolean;
  /** Handler function called when shortcut is triggered */
  handler: (event: KeyboardEvent) => void;
  /** Whether to prevent default browser behavior (default: true) */
  preventDefault?: boolean;
  /** Scope for conflict resolution: 'global' or a component name */
  scope?: 'global' | string;
  /** Description for UI display */
  description?: string;
}

/** Shortcut registry for tracking active shortcuts */
export interface ShortcutRegistry {
  shortcuts: Map<string, KeyboardShortcut>;
  activeScopes: Set<string>;
}

/** Shortcut match result */
interface ShortcutMatch {
  shortcut: KeyboardShortcut;
  isMatch: boolean;
}

// =============================================================================
// Platform Detection
// =============================================================================

/**
 * Check if the current platform is macOS
 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac');
}

/**
 * Get the modifier key label for display
 */
export function getModifierLabel(): string {
  return isMac() ? '⌘' : 'Ctrl';
}

/**
 * Get the full shortcut display string
 */
export function getShortcutDisplay(shortcut: Pick<KeyboardShortcut, 'key' | 'meta' | 'shift' | 'alt'>): string {
  const parts: string[] = [];
  const modifier = getModifierLabel();

  if (shortcut.meta) parts.push(modifier);
  if (shortcut.alt) parts.push(isMac() ? '⌥' : 'Alt');
  if (shortcut.shift) parts.push(isMac() ? '⇧' : 'Shift');

  // Format the key nicely
  let keyDisplay = shortcut.key;
  if (keyDisplay === 'Enter') keyDisplay = '↩';
  else if (keyDisplay === 'Escape') keyDisplay = 'Esc';
  else if (keyDisplay === 'ArrowUp') keyDisplay = '↑';
  else if (keyDisplay === 'ArrowDown') keyDisplay = '↓';
  else if (keyDisplay === 'ArrowLeft') keyDisplay = '←';
  else if (keyDisplay === 'ArrowRight') keyDisplay = '→';
  else if (keyDisplay === 'Delete') keyDisplay = 'Del';
  else if (keyDisplay === 'Backspace') keyDisplay = '⌫';
  else if (keyDisplay.length === 1) keyDisplay = keyDisplay.toUpperCase();

  parts.push(keyDisplay);

  return parts.join(isMac() ? '' : '+');
}

// =============================================================================
// Shortcut Matching
// =============================================================================

/**
 * Check if a keyboard event matches a shortcut definition
 */
export function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
  // Check the key (case-insensitive for letter keys)
  const eventKey = event.key.toLowerCase();
  const shortcutKey = shortcut.key.toLowerCase();

  if (eventKey !== shortcutKey) {
    return false;
  }

  // Check modifier keys
  const macPlatform = isMac();
  const wantsMeta = shortcut.meta ?? false;
  const wantsShift = shortcut.shift ?? false;
  const wantsAlt = shortcut.alt ?? false;

  // On Mac, use metaKey (Cmd). On others, use ctrlKey
  const hasPrimaryModifier = macPlatform ? event.metaKey : event.ctrlKey;

  if (wantsMeta !== hasPrimaryModifier) {
    return false;
  }

  if (wantsShift !== event.shiftKey) {
    return false;
  }

  if (wantsAlt !== event.altKey) {
    return false;
  }

  // On Mac, if we're not expecting meta, ensure ctrl isn't pressed (for consistency)
  // On non-Mac, if we're not expecting meta, ensure meta isn't pressed
  if (!wantsMeta) {
    if (macPlatform && event.ctrlKey) return false;
    if (!macPlatform && event.metaKey) return false;
  }

  return true;
}

/**
 * Check if an element is an input or editable element
 */
export function isInputElement(element: EventTarget | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;

  const tagName = element.tagName.toLowerCase();

  // Standard input elements
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }

  // Contenteditable elements (check both property and attribute for JSDOM compatibility)
  if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
    return true;
  }

  // CodeMirror editor
  if (element.classList.contains('cm-content') || element.closest('.cm-editor')) {
    return true;
  }

  return false;
}

// =============================================================================
// Global Shortcut Registry
// =============================================================================

/** Global registry singleton */
const globalRegistry: ShortcutRegistry = {
  shortcuts: new Map(),
  activeScopes: new Set(['global']),
};

/**
 * Register a shortcut in the global registry
 */
export function registerShortcut(shortcut: KeyboardShortcut): () => void {
  globalRegistry.shortcuts.set(shortcut.id, shortcut);
  return () => {
    globalRegistry.shortcuts.delete(shortcut.id);
  };
}

/**
 * Register multiple shortcuts at once
 */
export function registerShortcuts(shortcuts: KeyboardShortcut[]): () => void {
  const unregisters = shortcuts.map(s => registerShortcut(s));
  return () => unregisters.forEach(fn => fn());
}

/**
 * Activate a scope (component shortcuts will override global)
 */
export function activateScope(scope: string): () => void {
  globalRegistry.activeScopes.add(scope);
  return () => {
    globalRegistry.activeScopes.delete(scope);
  };
}

/**
 * Get all registered shortcuts (for display purposes)
 */
export function getAllShortcuts(): KeyboardShortcut[] {
  return Array.from(globalRegistry.shortcuts.values());
}

// =============================================================================
// Event Handler
// =============================================================================

/**
 * Find the best matching shortcut for an event
 * Component-scoped shortcuts take precedence over global shortcuts
 */
function findBestMatch(event: KeyboardEvent): KeyboardShortcut | null {
  const matches: ShortcutMatch[] = [];

  for (const shortcut of globalRegistry.shortcuts.values()) {
    if (matchesShortcut(event, shortcut)) {
      const scope = shortcut.scope ?? 'global';
      // Only consider shortcuts whose scope is active
      if (globalRegistry.activeScopes.has(scope) || scope === 'global') {
        matches.push({ shortcut, isMatch: true });
      }
    }
  }

  if (matches.length === 0) return null;

  // Sort by specificity: non-global scopes first
  matches.sort((a, b) => {
    const aScope = a.shortcut.scope ?? 'global';
    const bScope = b.shortcut.scope ?? 'global';

    // Non-global scopes have higher priority
    if (aScope !== 'global' && bScope === 'global') return -1;
    if (aScope === 'global' && bScope !== 'global') return 1;
    return 0;
  });

  return matches[0]?.shortcut ?? null;
}

/**
 * Global keyboard event handler
 */
function handleGlobalKeyDown(event: KeyboardEvent): void {
  const shortcut = findBestMatch(event);

  if (!shortcut) return;

  // For some shortcuts, we want to allow them even in input fields (like Escape)
  const allowInInput = ['Escape', 'Tab'].includes(shortcut.key) && !shortcut.meta;

  // Skip if we're in an input element (unless it's an allow-in-input shortcut)
  if (!allowInInput && isInputElement(event.target)) {
    // Allow Cmd/Ctrl shortcuts in CodeMirror (they handle their own shortcuts)
    if (shortcut.meta) {
      // Let CodeMirror handle Cmd+Enter etc.
      const isInCodeMirror = event.target instanceof HTMLElement &&
        (event.target.closest('.cm-editor') !== null);
      if (isInCodeMirror) {
        // Only prevent certain shortcuts from bubbling
        // Actually, let component handle this
        return;
      }
    }
    return;
  }

  // Prevent default if requested
  if (shortcut.preventDefault !== false) {
    event.preventDefault();
  }

  // Call the handler
  shortcut.handler(event);
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Initialize global keyboard shortcut handling
 * Call this once at the app root level
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);
}

/**
 * Register a keyboard shortcut for the lifetime of a component
 */
export function useKeyboardShortcut(shortcut: KeyboardShortcut): void {
  const shortcutRef = useRef(shortcut);
  shortcutRef.current = shortcut;

  useEffect(() => {
    // Create a wrapper shortcut that uses the current ref value
    const wrappedShortcut: KeyboardShortcut = {
      ...shortcutRef.current,
      handler: (event) => shortcutRef.current.handler(event),
    };

    return registerShortcut(wrappedShortcut);
  }, [shortcut.id, shortcut.key, shortcut.meta, shortcut.shift, shortcut.alt, shortcut.scope]);
}

/**
 * Register multiple keyboard shortcuts for the lifetime of a component
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]): void {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  // Create a stable dependency string for the effect
  const shortcutsDep = shortcuts.map(s => `${s.id}:${s.key}:${s.meta}:${s.shift}:${s.alt}:${s.scope}`).join('|');

  useEffect(() => {
    // Create wrapper shortcuts that use current ref values
    const unregisters = shortcutsRef.current.map((shortcut) => {
      const wrappedShortcut: KeyboardShortcut = {
        ...shortcut,
        handler: (event) => {
          // Find the current version of this shortcut
          const current = shortcutsRef.current.find(s => s.id === shortcut.id);
          current?.handler(event);
        },
      };
      return registerShortcut(wrappedShortcut);
    });

    return () => unregisters.forEach(fn => fn());
  }, [shortcutsDep]);
}

/**
 * Activate a shortcut scope for the lifetime of a component
 * Shortcuts in this scope will override global shortcuts with the same key combo
 */
export function useShortcutScope(scope: string): void {
  useEffect(() => {
    return activateScope(scope);
  }, [scope]);
}

// =============================================================================
// Callback Hooks (for common patterns)
// =============================================================================

/**
 * Hook for global application shortcuts
 * This should be used at the app level to register global shortcuts
 */
export interface GlobalShortcutHandlers {
  onOpenFile?: () => void;
  onNewDatabase?: () => void;
  onSave?: () => void;
  onCloseDatabase?: () => void;
  onOpenSettings?: () => void;
}

export function useGlobalShortcutHandlers(handlers: GlobalShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const shortcuts = useCallback((): KeyboardShortcut[] => {
    const result: KeyboardShortcut[] = [];

    if (handlersRef.current.onOpenFile) {
      result.push({
        id: 'global-open-file',
        key: 'o',
        meta: true,
        handler: () => handlersRef.current.onOpenFile?.(),
        scope: 'global',
        description: 'Open database file',
      });
    }

    if (handlersRef.current.onNewDatabase) {
      result.push({
        id: 'global-new-database',
        key: 'n',
        meta: true,
        handler: () => handlersRef.current.onNewDatabase?.(),
        scope: 'global',
        description: 'New database',
      });
    }

    if (handlersRef.current.onSave) {
      result.push({
        id: 'global-save',
        key: 's',
        meta: true,
        handler: () => handlersRef.current.onSave?.(),
        scope: 'global',
        description: 'Save changes',
      });
    }

    if (handlersRef.current.onCloseDatabase) {
      result.push({
        id: 'global-close',
        key: 'w',
        meta: true,
        handler: () => handlersRef.current.onCloseDatabase?.(),
        scope: 'global',
        description: 'Close database',
      });
    }

    if (handlersRef.current.onOpenSettings) {
      result.push({
        id: 'global-settings',
        key: ',',
        meta: true,
        handler: () => handlersRef.current.onOpenSettings?.(),
        scope: 'global',
        description: 'Open settings',
      });
    }

    return result;
  }, []);

  useEffect(() => {
    const unregisters = shortcuts().map(s => registerShortcut(s));
    return () => unregisters.forEach(fn => fn());
  // Note: We intentionally don't include handlers in dependencies.
  // The handlersRef pattern ensures we always call the latest handler.
   
  }, [shortcuts]);
}

// =============================================================================
// SQL Editor Shortcuts
// =============================================================================

export interface SqlEditorShortcutHandlers {
  onExecute?: () => void;
  onExecuteExplain?: () => void;
  onCancel?: () => void;
}

export function useSqlEditorShortcuts(handlers: SqlEditorShortcutHandlers, isActive: boolean): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!isActive) return;

    const shortcuts: KeyboardShortcut[] = [];

    if (handlersRef.current.onExecute) {
      shortcuts.push({
        id: 'sql-execute',
        key: 'Enter',
        meta: true,
        handler: () => handlersRef.current.onExecute?.(),
        scope: 'sql-editor',
        description: 'Execute query',
      });
    }

    if (handlersRef.current.onExecuteExplain) {
      shortcuts.push({
        id: 'sql-execute-explain',
        key: 'Enter',
        meta: true,
        shift: true,
        handler: () => handlersRef.current.onExecuteExplain?.(),
        scope: 'sql-editor',
        description: 'Execute and explain query',
      });
    }

    if (handlersRef.current.onCancel) {
      shortcuts.push({
        id: 'sql-cancel',
        key: 'Escape',
        handler: () => handlersRef.current.onCancel?.(),
        scope: 'sql-editor',
        description: 'Cancel query',
        preventDefault: false, // Let escape bubble for other uses
      });
    }

    const unregister = registerShortcuts(shortcuts);
    const deactivateScope = activateScope('sql-editor');

    return () => {
      unregister();
      deactivateScope();
    };
  // Note: We intentionally don't include handlers in dependencies.
  // The handlersRef pattern ensures we always call the latest handler.
   
  }, [isActive]);
}

// =============================================================================
// Data Grid Shortcuts
// =============================================================================

export interface DataGridShortcutHandlers {
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  onNavigateLeft?: () => void;
  onNavigateRight?: () => void;
}

export function useDataGridShortcuts(handlers: DataGridShortcutHandlers, isActive: boolean): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!isActive) return;

    const shortcuts: KeyboardShortcut[] = [];

    if (handlersRef.current.onStartEdit) {
      shortcuts.push({
        id: 'grid-start-edit',
        key: 'Enter',
        handler: () => handlersRef.current.onStartEdit?.(),
        scope: 'data-grid',
        description: 'Edit selected cell',
      });
    }

    if (handlersRef.current.onCancelEdit) {
      shortcuts.push({
        id: 'grid-cancel-edit',
        key: 'Escape',
        handler: () => handlersRef.current.onCancelEdit?.(),
        scope: 'data-grid',
        description: 'Cancel edit',
        preventDefault: false,
      });
    }

    if (handlersRef.current.onDelete) {
      shortcuts.push(
        {
          id: 'grid-delete',
          key: 'Delete',
          handler: () => handlersRef.current.onDelete?.(),
          scope: 'data-grid',
          description: 'Delete/clear cell',
        },
        {
          id: 'grid-backspace',
          key: 'Backspace',
          handler: () => handlersRef.current.onDelete?.(),
          scope: 'data-grid',
          description: 'Delete/clear cell',
        }
      );
    }

    if (handlersRef.current.onCopy) {
      shortcuts.push({
        id: 'grid-copy',
        key: 'c',
        meta: true,
        handler: () => handlersRef.current.onCopy?.(),
        scope: 'data-grid',
        description: 'Copy cell value',
      });
    }

    if (handlersRef.current.onNavigateUp) {
      shortcuts.push({
        id: 'grid-nav-up',
        key: 'ArrowUp',
        handler: () => handlersRef.current.onNavigateUp?.(),
        scope: 'data-grid',
        description: 'Navigate up',
      });
    }

    if (handlersRef.current.onNavigateDown) {
      shortcuts.push({
        id: 'grid-nav-down',
        key: 'ArrowDown',
        handler: () => handlersRef.current.onNavigateDown?.(),
        scope: 'data-grid',
        description: 'Navigate down',
      });
    }

    if (handlersRef.current.onNavigateLeft) {
      shortcuts.push({
        id: 'grid-nav-left',
        key: 'ArrowLeft',
        handler: () => handlersRef.current.onNavigateLeft?.(),
        scope: 'data-grid',
        description: 'Navigate left',
      });
    }

    if (handlersRef.current.onNavigateRight) {
      shortcuts.push({
        id: 'grid-nav-right',
        key: 'ArrowRight',
        handler: () => handlersRef.current.onNavigateRight?.(),
        scope: 'data-grid',
        description: 'Navigate right',
      });
    }

    const unregister = registerShortcuts(shortcuts);
    const deactivateScope = activateScope('data-grid');

    return () => {
      unregister();
      deactivateScope();
    };
  // Note: We intentionally don't include handlers in dependencies.
  // The handlersRef pattern ensures we always call the latest handler.
   
  }, [isActive]);
}
