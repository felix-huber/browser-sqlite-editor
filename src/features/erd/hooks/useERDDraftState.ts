/**
 * useERDDraftState Hook
 *
 * Tracks ERD draft state for unsaved changes prompting:
 * - FK dialog changes (edit dialog with unsaved changes)
 * - Pending FK creation (drag started but not confirmed)
 * - Table position changes not yet persisted
 */

import { useState, useCallback, useEffect, useRef } from 'react';

/** Draft state sources in ERD */
export interface ERDDraftState {
  /** FK edit dialog has unsaved changes */
  fkDialogDirty: boolean;
  /** Table positions have been moved but not persisted */
  positionsDirty: boolean;
  /** FK creation drag started but not confirmed */
  pendingFKCreation: boolean;
}

/** Options for useERDDraftState hook */
export interface UseERDDraftStateOptions {
  /** Callback when overall dirty state changes */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Return type for useERDDraftState hook */
export interface UseERDDraftStateResult {
  /** Whether any draft state source is dirty */
  isDirty: boolean;
  /** Individual draft state sources */
  draftState: ERDDraftState;
  /** Mark FK dialog as dirty/clean */
  setFKDialogDirty: (dirty: boolean) => void;
  /** Mark positions as dirty/clean */
  setPositionsDirty: (dirty: boolean) => void;
  /** Mark FK creation as pending/complete */
  setPendingFKCreation: (pending: boolean) => void;
  /** Clear all dirty states */
  markClean: () => void;
  /** Get human-readable context for dirty state */
  getDirtyContext: () => string;
}

const DEFAULT_DRAFT_STATE: ERDDraftState = {
  fkDialogDirty: false,
  positionsDirty: false,
  pendingFKCreation: false,
};

/**
 * Hook for tracking ERD draft state
 */
export function useERDDraftState(
  options: UseERDDraftStateOptions = {}
): UseERDDraftStateResult {
  const { onDirtyChange } = options;

  const [draftState, setDraftState] = useState<ERDDraftState>(DEFAULT_DRAFT_STATE);
  const previousIsDirtyRef = useRef(false);

  // Compute overall dirty state
  const isDirty =
    draftState.fkDialogDirty ||
    draftState.positionsDirty ||
    draftState.pendingFKCreation;

  // Notify when dirty state changes
  useEffect(() => {
    if (isDirty !== previousIsDirtyRef.current) {
      previousIsDirtyRef.current = isDirty;
      onDirtyChange?.(isDirty);
    }
  }, [isDirty, onDirtyChange]);

  const setFKDialogDirty = useCallback((dirty: boolean) => {
    setDraftState((prev) => {
      if (prev.fkDialogDirty === dirty) return prev;
      return { ...prev, fkDialogDirty: dirty };
    });
  }, []);

  const setPositionsDirty = useCallback((dirty: boolean) => {
    setDraftState((prev) => {
      if (prev.positionsDirty === dirty) return prev;
      return { ...prev, positionsDirty: dirty };
    });
  }, []);

  const setPendingFKCreation = useCallback((pending: boolean) => {
    setDraftState((prev) => {
      if (prev.pendingFKCreation === pending) return prev;
      return { ...prev, pendingFKCreation: pending };
    });
  }, []);

  const markClean = useCallback(() => {
    setDraftState(DEFAULT_DRAFT_STATE);
  }, []);

  const getDirtyContext = useCallback((): string => {
    const contexts: string[] = [];

    if (draftState.fkDialogDirty) {
      contexts.push('FK dialog changes');
    }
    if (draftState.positionsDirty) {
      contexts.push('table position changes');
    }
    if (draftState.pendingFKCreation) {
      contexts.push('pending FK creation');
    }

    if (contexts.length === 0) {
      return '';
    }
    if (contexts.length === 1) {
      return contexts[0];
    }
    if (contexts.length === 2) {
      return `${contexts[0]} and ${contexts[1]}`;
    }
    return `${contexts.slice(0, -1).join(', ')}, and ${contexts[contexts.length - 1]}`;
  }, [draftState]);

  return {
    isDirty,
    draftState,
    setFKDialogDirty,
    setPositionsDirty,
    setPendingFKCreation,
    markClean,
    getDirtyContext,
  };
}

export default useERDDraftState;
