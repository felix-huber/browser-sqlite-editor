import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useERDDraftState } from '../useERDDraftState';

describe('useERDDraftState', () => {
  describe('initial state', () => {
    it('returns isDirty as false initially', () => {
      const { result } = renderHook(() => useERDDraftState());
      expect(result.current.isDirty).toBe(false);
    });

    it('returns all draft sources as clean initially', () => {
      const { result } = renderHook(() => useERDDraftState());
      expect(result.current.draftState).toEqual({
        fkDialogDirty: false,
        positionsDirty: false,
        pendingFKCreation: false,
      });
    });
  });

  describe('FK dialog dirty tracking', () => {
    it('marks FK dialog as dirty', () => {
      const { result } = renderHook(() => useERDDraftState());

      act(() => {
        result.current.setFKDialogDirty(true);
      });

      expect(result.current.draftState.fkDialogDirty).toBe(true);
      expect(result.current.isDirty).toBe(true);
    });

    it('clears FK dialog dirty state', () => {
      const { result } = renderHook(() => useERDDraftState());

      act(() => {
        result.current.setFKDialogDirty(true);
      });
      act(() => {
        result.current.setFKDialogDirty(false);
      });

      expect(result.current.draftState.fkDialogDirty).toBe(false);
      expect(result.current.isDirty).toBe(false);
    });
  });

  describe('position dirty tracking', () => {
    it('marks positions as dirty', () => {
      const { result } = renderHook(() => useERDDraftState());

      act(() => {
        result.current.setPositionsDirty(true);
      });

      expect(result.current.draftState.positionsDirty).toBe(true);
      expect(result.current.isDirty).toBe(true);
    });

    it('clears positions dirty state', () => {
      const { result } = renderHook(() => useERDDraftState());

      act(() => {
        result.current.setPositionsDirty(true);
      });
      act(() => {
        result.current.setPositionsDirty(false);
      });

      expect(result.current.draftState.positionsDirty).toBe(false);
      expect(result.current.isDirty).toBe(false);
    });
  });

  describe('pending FK creation tracking', () => {
    it('marks pending FK creation', () => {
      const { result } = renderHook(() => useERDDraftState());

      act(() => {
        result.current.setPendingFKCreation(true);
      });

      expect(result.current.draftState.pendingFKCreation).toBe(true);
      expect(result.current.isDirty).toBe(true);
    });

    it('clears pending FK creation', () => {
      const { result } = renderHook(() => useERDDraftState());

      act(() => {
        result.current.setPendingFKCreation(true);
      });
      act(() => {
        result.current.setPendingFKCreation(false);
      });

      expect(result.current.draftState.pendingFKCreation).toBe(false);
      expect(result.current.isDirty).toBe(false);
    });
  });

  describe('combined dirty state', () => {
    it('isDirty is true when any source is dirty', () => {
      const { result } = renderHook(() => useERDDraftState());

      act(() => {
        result.current.setFKDialogDirty(true);
      });
      expect(result.current.isDirty).toBe(true);

      act(() => {
        result.current.setFKDialogDirty(false);
        result.current.setPositionsDirty(true);
      });
      expect(result.current.isDirty).toBe(true);

      act(() => {
        result.current.setPositionsDirty(false);
        result.current.setPendingFKCreation(true);
      });
      expect(result.current.isDirty).toBe(true);
    });

    it('isDirty is false only when all sources are clean', () => {
      const { result } = renderHook(() => useERDDraftState());

      act(() => {
        result.current.setFKDialogDirty(true);
        result.current.setPositionsDirty(true);
        result.current.setPendingFKCreation(true);
      });
      expect(result.current.isDirty).toBe(true);

      act(() => {
        result.current.setFKDialogDirty(false);
      });
      expect(result.current.isDirty).toBe(true);

      act(() => {
        result.current.setPositionsDirty(false);
      });
      expect(result.current.isDirty).toBe(true);

      act(() => {
        result.current.setPendingFKCreation(false);
      });
      expect(result.current.isDirty).toBe(false);
    });
  });

  describe('markClean', () => {
    it('clears all dirty states', () => {
      const { result } = renderHook(() => useERDDraftState());

      act(() => {
        result.current.setFKDialogDirty(true);
        result.current.setPositionsDirty(true);
        result.current.setPendingFKCreation(true);
      });

      expect(result.current.isDirty).toBe(true);

      act(() => {
        result.current.markClean();
      });

      expect(result.current.isDirty).toBe(false);
      expect(result.current.draftState).toEqual({
        fkDialogDirty: false,
        positionsDirty: false,
        pendingFKCreation: false,
      });
    });
  });

  describe('getDirtyContext', () => {
    it('returns empty string when nothing is dirty', () => {
      const { result } = renderHook(() => useERDDraftState());
      expect(result.current.getDirtyContext()).toBe('');
    });

    it('returns FK dialog context when FK dialog is dirty', () => {
      const { result } = renderHook(() => useERDDraftState());

      act(() => {
        result.current.setFKDialogDirty(true);
      });

      expect(result.current.getDirtyContext()).toContain('FK');
    });

    it('returns positions context when positions are dirty', () => {
      const { result } = renderHook(() => useERDDraftState());

      act(() => {
        result.current.setPositionsDirty(true);
      });

      expect(result.current.getDirtyContext()).toContain('position');
    });

    it('returns pending FK context when FK creation is pending', () => {
      const { result } = renderHook(() => useERDDraftState());

      act(() => {
        result.current.setPendingFKCreation(true);
      });

      expect(result.current.getDirtyContext()).toContain('FK');
    });
  });

  describe('onDirtyChange callback', () => {
    it('calls onDirtyChange when dirty state changes', () => {
      const onDirtyChange = vi.fn();
      const { result } = renderHook(() => useERDDraftState({ onDirtyChange }));

      act(() => {
        result.current.setFKDialogDirty(true);
      });

      expect(onDirtyChange).toHaveBeenCalledWith(true);
    });

    it('calls onDirtyChange with false when all states cleared', () => {
      const onDirtyChange = vi.fn();
      const { result } = renderHook(() => useERDDraftState({ onDirtyChange }));

      act(() => {
        result.current.setFKDialogDirty(true);
      });

      onDirtyChange.mockClear();

      act(() => {
        result.current.setFKDialogDirty(false);
      });

      expect(onDirtyChange).toHaveBeenCalledWith(false);
    });

    it('does not call onDirtyChange when dirty state unchanged', () => {
      const onDirtyChange = vi.fn();
      const { result } = renderHook(() => useERDDraftState({ onDirtyChange }));

      act(() => {
        result.current.setFKDialogDirty(true);
      });

      onDirtyChange.mockClear();

      act(() => {
        result.current.setPositionsDirty(true);
      });

      // Still dirty, so callback should not be called again
      expect(onDirtyChange).not.toHaveBeenCalled();
    });
  });
});
