/**
 * useUnsavedPrompt Hook Tests
 *
 * Tests for the unsaved changes prompt hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useUnsavedPrompt } from '../useUnsavedPrompt';

describe('useUnsavedPrompt', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  describe('Initial state', () => {
    it('starts with no dirty surfaces', () => {
      const { result } = renderHook(() => useUnsavedPrompt());

      expect(result.current.isDirty).toBe(false);
      expect(result.current.dirtyState).toEqual({
        grid: false,
        designer: false,
        sql: false,
        queryBuilder: false,
        erd: false,
      });
    });

    it('accepts initial dirty state', () => {
      const { result } = renderHook(() =>
        useUnsavedPrompt({
          initialDirtyState: { grid: true, designer: true },
        })
      );

      expect(result.current.isDirty).toBe(true);
      expect(result.current.dirtyState.grid).toBe(true);
      expect(result.current.dirtyState.designer).toBe(true);
      expect(result.current.dirtyState.sql).toBe(false);
    });

    it('starts with prompt closed', () => {
      const { result } = renderHook(() => useUnsavedPrompt());

      expect(result.current.isPromptOpen).toBe(false);
    });
  });

  describe('setDirty', () => {
    it('marks a surface as dirty', () => {
      const { result } = renderHook(() => useUnsavedPrompt());

      act(() => {
        result.current.setDirty('grid', true);
      });

      expect(result.current.isDirty).toBe(true);
      expect(result.current.dirtyState.grid).toBe(true);
    });

    it('marks a surface as clean', () => {
      const { result } = renderHook(() =>
        useUnsavedPrompt({ initialDirtyState: { grid: true } })
      );

      act(() => {
        result.current.setDirty('grid', false);
      });

      expect(result.current.isDirty).toBe(false);
      expect(result.current.dirtyState.grid).toBe(false);
    });

    it('handles multiple dirty surfaces', () => {
      const { result } = renderHook(() => useUnsavedPrompt());

      act(() => {
        result.current.setDirty('grid', true);
        result.current.setDirty('designer', true);
      });

      expect(result.current.isDirty).toBe(true);
      expect(result.current.dirtyState.grid).toBe(true);
      expect(result.current.dirtyState.designer).toBe(true);
    });
  });

  describe('markClean', () => {
    it('marks all surfaces as clean', () => {
      const { result } = renderHook(() =>
        useUnsavedPrompt({
          initialDirtyState: { grid: true, designer: true, sql: true },
        })
      );

      act(() => {
        result.current.markClean();
      });

      expect(result.current.isDirty).toBe(false);
      expect(result.current.dirtyState).toEqual({
        grid: false,
        designer: false,
        sql: false,
        queryBuilder: false,
        erd: false,
      });
    });
  });

  describe('getDirtyContext', () => {
    it('returns empty string when nothing is dirty', () => {
      const { result } = renderHook(() => useUnsavedPrompt());

      expect(result.current.getDirtyContext()).toBe('');
    });

    it('returns single surface name', () => {
      const { result } = renderHook(() =>
        useUnsavedPrompt({ initialDirtyState: { grid: true } })
      );

      expect(result.current.getDirtyContext()).toBe('Grid Editor');
    });

    it('returns two surface names with "and"', () => {
      const { result } = renderHook(() =>
        useUnsavedPrompt({ initialDirtyState: { grid: true, designer: true } })
      );

      expect(result.current.getDirtyContext()).toBe('Grid Editor and Table Designer');
    });

    it('returns multiple surface names with commas and "and"', () => {
      const { result } = renderHook(() =>
        useUnsavedPrompt({
          initialDirtyState: { grid: true, designer: true, sql: true },
        })
      );

      expect(result.current.getDirtyContext()).toBe(
        'Grid Editor, Table Designer, and SQL Editor'
      );
    });
  });

  describe('checkUnsaved', () => {
    it('resolves immediately when not dirty', async () => {
      const { result } = renderHook(() => useUnsavedPrompt());

      let checkResult: Awaited<ReturnType<typeof result.current.checkUnsaved>>;
      await act(async () => {
        checkResult = await result.current.checkUnsaved('switch database');
      });

      expect(checkResult!.action).toBe('discard');
      expect(checkResult!.success).toBe(true);
      expect(result.current.isPromptOpen).toBe(false);
    });

    it('shows prompt when dirty', async () => {
      const { result } = renderHook(() =>
        useUnsavedPrompt({ initialDirtyState: { grid: true } })
      );

      // Start the check but don't await (it will wait for user action)
      act(() => {
        result.current.checkUnsaved('switch database');
      });

      // Prompt should be open
      expect(result.current.isPromptOpen).toBe(true);
      expect(result.current.promptContext).toBe('Grid Editor');
    });

    it('resolves with cancel when user cancels', async () => {
      const { result } = renderHook(() =>
        useUnsavedPrompt({ initialDirtyState: { grid: true } })
      );

      let checkResult: Awaited<ReturnType<typeof result.current.checkUnsaved>> | undefined;

      // Start the check
      act(() => {
        result.current.checkUnsaved('switch database').then((r) => {
          checkResult = r;
        });
      });

      // User cancels
      act(() => {
        result.current.handlePromptAction('cancel');
      });

      await waitFor(() => {
        expect(checkResult).toBeDefined();
      });

      expect(checkResult!.action).toBe('cancel');
      expect(checkResult!.success).toBe(false);
      expect(result.current.isPromptOpen).toBe(false);
      // Dirty state should remain
      expect(result.current.isDirty).toBe(true);
    });

    it('resolves with discard and clears dirty state', async () => {
      const { result } = renderHook(() =>
        useUnsavedPrompt({ initialDirtyState: { grid: true } })
      );

      let checkResult: Awaited<ReturnType<typeof result.current.checkUnsaved>> | undefined;

      // Start the check
      act(() => {
        result.current.checkUnsaved('switch database').then((r) => {
          checkResult = r;
        });
      });

      // User discards
      act(() => {
        result.current.handlePromptAction('discard');
      });

      await waitFor(() => {
        expect(checkResult).toBeDefined();
      });

      expect(checkResult!.action).toBe('discard');
      expect(checkResult!.success).toBe(true);
      expect(result.current.isPromptOpen).toBe(false);
      // Dirty state should be cleared
      expect(result.current.isDirty).toBe(false);
    });

    it('resolves with save when save succeeds', async () => {
      const mockOnSave = vi.fn().mockResolvedValue(true);
      const { result } = renderHook(() =>
        useUnsavedPrompt({
          initialDirtyState: { grid: true },
          onSave: mockOnSave,
        })
      );

      let checkResult: Awaited<ReturnType<typeof result.current.checkUnsaved>> | undefined;

      // Start the check
      act(() => {
        result.current.checkUnsaved('switch database').then((r) => {
          checkResult = r;
        });
      });

      // User saves
      await act(async () => {
        await result.current.handlePromptAction('save');
      });

      await waitFor(() => {
        expect(checkResult).toBeDefined();
      });

      expect(mockOnSave).toHaveBeenCalled();
      expect(checkResult!.action).toBe('save');
      expect(checkResult!.success).toBe(true);
      expect(result.current.isPromptOpen).toBe(false);
      // Dirty state should be cleared
      expect(result.current.isDirty).toBe(false);
    });

    it('resolves with save but success=false when save fails', async () => {
      const mockOnSave = vi.fn().mockResolvedValue(false);
      const { result } = renderHook(() =>
        useUnsavedPrompt({
          initialDirtyState: { grid: true },
          onSave: mockOnSave,
        })
      );

      let checkResult: Awaited<ReturnType<typeof result.current.checkUnsaved>> | undefined;

      // Start the check
      act(() => {
        result.current.checkUnsaved('switch database').then((r) => {
          checkResult = r;
        });
      });

      // User saves
      await act(async () => {
        await result.current.handlePromptAction('save');
      });

      await waitFor(() => {
        expect(checkResult).toBeDefined();
      });

      expect(mockOnSave).toHaveBeenCalled();
      expect(checkResult!.action).toBe('save');
      expect(checkResult!.success).toBe(false);
      expect(result.current.isPromptOpen).toBe(false);
      // Dirty state should remain since save failed
      expect(result.current.isDirty).toBe(true);
    });
  });

  describe('canSave', () => {
    it('is false when no onSave provided', () => {
      const { result } = renderHook(() => useUnsavedPrompt());

      expect(result.current.canSave).toBe(false);
    });

    it('is true when onSave is provided', () => {
      const { result } = renderHook(() =>
        useUnsavedPrompt({ onSave: async () => true })
      );

      expect(result.current.canSave).toBe(true);
    });
  });

  describe('beforeunload', () => {
    it('adds beforeunload listener when enabled', () => {
      renderHook(() => useUnsavedPrompt({ enableBeforeUnload: true }));

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function)
      );
    });

    it('does not add beforeunload listener when disabled', () => {
      addEventListenerSpy.mockClear();
      renderHook(() => useUnsavedPrompt({ enableBeforeUnload: false }));

      const beforeunloadCalls = addEventListenerSpy.mock.calls.filter(
        (call: [string, ...unknown[]]) => call[0] === 'beforeunload'
      );
      expect(beforeunloadCalls).toHaveLength(0);
    });

    it('removes beforeunload listener on cleanup', () => {
      const { unmount } = renderHook(() =>
        useUnsavedPrompt({ enableBeforeUnload: true })
      );

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function)
      );
    });

    it('prevents default when dirty', () => {
      renderHook(() =>
        useUnsavedPrompt({
          enableBeforeUnload: true,
          initialDirtyState: { grid: true },
        })
      );

      // Find the beforeunload handler
      const beforeunloadCall = addEventListenerSpy.mock.calls.find(
        (call: [string, ...unknown[]]) => call[0] === 'beforeunload'
      );
      const handler = beforeunloadCall?.[1] as (e: BeforeUnloadEvent) => void;

      const mockEvent = {
        preventDefault: vi.fn(),
        returnValue: undefined as string | undefined,
      } as unknown as BeforeUnloadEvent;

      handler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.returnValue).toBe('');
    });

    it('does not prevent default when not dirty', () => {
      renderHook(() =>
        useUnsavedPrompt({ enableBeforeUnload: true })
      );

      // Find the beforeunload handler
      const beforeunloadCall = addEventListenerSpy.mock.calls.find(
        (call: [string, ...unknown[]]) => call[0] === 'beforeunload'
      );
      const handler = beforeunloadCall?.[1] as (e: BeforeUnloadEvent) => void;

      const mockEvent = {
        preventDefault: vi.fn(),
        returnValue: undefined as string | undefined,
      } as unknown as BeforeUnloadEvent;

      handler(mockEvent);

      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });
  });
});
