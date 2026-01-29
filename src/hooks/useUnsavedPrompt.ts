/**
 * useUnsavedPrompt Hook
 *
 * Central hook for managing unsaved changes across all surfaces.
 * Tracks dirty state from:
 * - Grid: cell currently being edited (uncommitted)
 * - Table Designer: form has unsaved changes
 * - SQL Editor: query modified since last run (optional)
 * - Query Builder: builder state differs from last execution
 * - ERD: FK changes not yet applied
 *
 * Provides:
 * - checkUnsaved(): shows prompt if dirty, returns action
 * - isDirty: current dirty state across all surfaces
 * - markClean(): reset dirty state after save
 * - beforeunload handling for browser close
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { UnsavedPromptAction } from '../components/common/UnsavedPrompt';

/** Surface types that can have dirty state */
export type DirtySurface =
  | 'grid'
  | 'designer'
  | 'sql'
  | 'queryBuilder'
  | 'erd';

/** Dirty state for each surface */
export interface DirtyState {
  grid: boolean;
  designer: boolean;
  sql: boolean;
  queryBuilder: boolean;
  erd: boolean;
}

/** Options for the useUnsavedPrompt hook */
export interface UseUnsavedPromptOptions {
  /** Initial dirty state */
  initialDirtyState?: Partial<DirtyState>;
  /** Callback to attempt save (returns true if successful) */
  onSave?: () => Promise<boolean>;
  /** Whether to enable beforeunload warning */
  enableBeforeUnload?: boolean;
}

/** Result returned by checkUnsaved */
export interface CheckUnsavedResult {
  /** The action chosen by the user */
  action: UnsavedPromptAction;
  /** Whether the action was successful (save succeeded, etc.) */
  success: boolean;
}

/** Return type for useUnsavedPrompt hook */
export interface UseUnsavedPromptResult {
  /** Whether any surface has unsaved changes */
  isDirty: boolean;
  /** Dirty state for each surface */
  dirtyState: DirtyState;
  /** Mark a specific surface as dirty */
  setDirty: (surface: DirtySurface, dirty: boolean) => void;
  /** Mark all surfaces as clean */
  markClean: () => void;
  /** Get the context string for the dirty surfaces */
  getDirtyContext: () => string;
  /** Check for unsaved changes and show prompt if dirty */
  checkUnsaved: (targetAction: string) => Promise<CheckUnsavedResult>;
  /** Whether the prompt is currently shown */
  isPromptOpen: boolean;
  /** Context for the prompt (which surface is dirty) */
  promptContext: string;
  /** Whether save is available */
  canSave: boolean;
  /** Handle prompt action */
  handlePromptAction: (action: UnsavedPromptAction) => void;
}

/** Default dirty state */
const DEFAULT_DIRTY_STATE: DirtyState = {
  grid: false,
  designer: false,
  sql: false,
  queryBuilder: false,
  erd: false,
};

/** Display names for surfaces */
const SURFACE_DISPLAY_NAMES: Record<DirtySurface, string> = {
  grid: 'Grid Editor',
  designer: 'Table Designer',
  sql: 'SQL Editor',
  queryBuilder: 'Query Builder',
  erd: 'ERD Diagram',
};

/**
 * Get human-readable context from dirty state
 */
function getDirtyContextFromState(dirtyState: DirtyState): string {
  const dirtySurfaces = (Object.entries(dirtyState) as [DirtySurface, boolean][])
    .filter(([, dirty]) => dirty)
    .map(([surface]) => SURFACE_DISPLAY_NAMES[surface]);

  if (dirtySurfaces.length === 0) {
    return '';
  }

  if (dirtySurfaces.length === 1) {
    return dirtySurfaces[0];
  }

  if (dirtySurfaces.length === 2) {
    return `${dirtySurfaces[0]} and ${dirtySurfaces[1]}`;
  }

  return `${dirtySurfaces.slice(0, -1).join(', ')}, and ${dirtySurfaces[dirtySurfaces.length - 1]}`;
}

/**
 * Hook for managing unsaved changes prompts
 */
export function useUnsavedPrompt(
  options: UseUnsavedPromptOptions = {}
): UseUnsavedPromptResult {
  const { initialDirtyState, onSave, enableBeforeUnload = true } = options;

  // Dirty state for each surface
  const [dirtyState, setDirtyState] = useState<DirtyState>(() => ({
    ...DEFAULT_DIRTY_STATE,
    ...initialDirtyState,
  }));

  // Prompt state
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [promptContext, setPromptContext] = useState('');

  // Promise resolver for checkUnsaved
  const resolverRef = useRef<((result: CheckUnsavedResult) => void) | null>(null);

  // Compute derived state
  const isDirty = Object.values(dirtyState).some((dirty) => dirty);
  const canSave = onSave !== undefined;

  /**
   * Set dirty state for a specific surface
   */
  const setDirty = useCallback((surface: DirtySurface, dirty: boolean) => {
    setDirtyState((prev) => {
      if (prev[surface] === dirty) return prev;
      return { ...prev, [surface]: dirty };
    });
  }, []);

  /**
   * Mark all surfaces as clean
   */
  const markClean = useCallback(() => {
    setDirtyState(DEFAULT_DIRTY_STATE);
  }, []);

  /**
   * Get the context string for the dirty surfaces
   */
  const getDirtyContext = useCallback(() => {
    return getDirtyContextFromState(dirtyState);
  }, [dirtyState]);

  /**
   * Check for unsaved changes and show prompt if dirty
   * Returns a promise that resolves with the user's action
   * @param _targetAction - Description of the action being attempted (for logging/future use)
   */
  const checkUnsaved = useCallback(
    (_targetAction: string): Promise<CheckUnsavedResult> => {
      // If not dirty, resolve immediately
      if (!isDirty) {
        return Promise.resolve({ action: 'discard', success: true });
      }

      // Show prompt and wait for action
      const context = getDirtyContextFromState(dirtyState);
      setPromptContext(context);
      setIsPromptOpen(true);

      return new Promise((resolve) => {
        resolverRef.current = resolve;
      });
    },
    [isDirty, dirtyState]
  );

  /**
   * Handle prompt action
   */
  const handlePromptAction = useCallback(
    async (action: UnsavedPromptAction) => {
      setIsPromptOpen(false);

      if (action === 'cancel') {
        resolverRef.current?.({ action: 'cancel', success: false });
        resolverRef.current = null;
        return;
      }

      if (action === 'discard') {
        markClean();
        resolverRef.current?.({ action: 'discard', success: true });
        resolverRef.current = null;
        return;
      }

      if (action === 'save') {
        if (onSave) {
          try {
            const success = await onSave();
            if (success) {
              markClean();
            }
            resolverRef.current?.({ action: 'save', success });
          } catch {
            resolverRef.current?.({ action: 'save', success: false });
          }
        } else {
          resolverRef.current?.({ action: 'save', success: false });
        }
        resolverRef.current = null;
      }
    },
    [markClean, onSave]
  );

  /**
   * Handle beforeunload event
   */
  useEffect(() => {
    if (!enableBeforeUnload) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        // Modern browsers ignore custom messages, but we need to return/set something
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty, enableBeforeUnload]);

  return {
    isDirty,
    dirtyState,
    setDirty,
    markClean,
    getDirtyContext,
    checkUnsaved,
    isPromptOpen,
    promptContext,
    canSave,
    handlePromptAction,
  };
}

export default useUnsavedPrompt;
