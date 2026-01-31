/**
 * Unit tests for Size Warnings feature
 *
 * Tests cover:
 * - Size warning thresholds (100MB OPFS, 50MB IDB)
 * - Warning state management in store
 * - Toast shown once per DB per session
 * - Badge state updates on threshold crossing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useDatabaseStore,
  useSizeWarning,
  checkSizeWarning,
  clearSizeWarning,
  getState,
  SIZE_THRESHOLD_OPFS,
  SIZE_THRESHOLD_IDB,
} from '../index';

// =============================================================================
// Test Setup
// =============================================================================

beforeEach(() => {
  useDatabaseStore.getState().reset();
});

// =============================================================================
// Threshold Constants Tests
// =============================================================================

describe('Size Warning - Thresholds', () => {
  it('should have OPFS threshold of 100MB', () => {
    expect(SIZE_THRESHOLD_OPFS).toBe(100 * 1024 * 1024);
  });

  it('should have IDB threshold of 50MB', () => {
    expect(SIZE_THRESHOLD_IDB).toBe(50 * 1024 * 1024);
  });
});

// =============================================================================
// Size Warning State Tests
// =============================================================================

describe('Size Warning - State Management', () => {
  it('should have null sizeWarning initially', () => {
    const state = getState();
    expect(state.sizeWarning).toBeNull();
  });

  it('should set size warning with checkSizeWarning', () => {
    act(() => {
      checkSizeWarning('test-db', 150 * 1024 * 1024, 'opfs');
    });

    const state = getState();
    expect(state.sizeWarning).toEqual({
      dbId: 'test-db',
      sizeBytes: 150 * 1024 * 1024,
      storageMode: 'opfs',
      threshold: SIZE_THRESHOLD_OPFS,
    });
  });

  it('should clear size warning', () => {
    act(() => {
      checkSizeWarning('test-db', 150 * 1024 * 1024, 'opfs');
    });
    expect(getState().sizeWarning).not.toBeNull();

    act(() => {
      clearSizeWarning();
    });
    expect(getState().sizeWarning).toBeNull();
  });
});

// =============================================================================
// Threshold Detection Tests
// =============================================================================

describe('Size Warning - Threshold Detection', () => {
  it('should trigger warning for OPFS DB > 100MB', () => {
    const size = 101 * 1024 * 1024;
    act(() => {
      checkSizeWarning('large-db', size, 'opfs');
    });

    const state = getState();
    expect(state.sizeWarning).not.toBeNull();
    expect(state.sizeWarning?.dbId).toBe('large-db');
  });

  it('should NOT trigger warning for OPFS DB <= 100MB', () => {
    // Use exact threshold to truly test boundary (100MB exactly should NOT warn)
    const size = SIZE_THRESHOLD_OPFS;
    act(() => {
      checkSizeWarning('normal-db', size, 'opfs');
    });

    expect(getState().sizeWarning).toBeNull();
  });

  it('should trigger warning for IDB DB > 50MB', () => {
    const size = 51 * 1024 * 1024;
    act(() => {
      checkSizeWarning('large-db', size, 'idb');
    });

    const state = getState();
    expect(state.sizeWarning).not.toBeNull();
    expect(state.sizeWarning?.threshold).toBe(SIZE_THRESHOLD_IDB);
  });

  it('should NOT trigger warning for IDB DB <= 50MB', () => {
    // Use exact threshold to truly test boundary (50MB exactly should NOT warn)
    const size = SIZE_THRESHOLD_IDB;
    act(() => {
      checkSizeWarning('normal-db', size, 'idb');
    });

    expect(getState().sizeWarning).toBeNull();
  });

  it('should trigger warning at exactly threshold + 1 byte', () => {
    const size = SIZE_THRESHOLD_OPFS + 1;
    act(() => {
      checkSizeWarning('borderline-db', size, 'opfs');
    });

    expect(getState().sizeWarning).not.toBeNull();
  });

  it('should NOT trigger warning at exactly threshold', () => {
    const size = SIZE_THRESHOLD_OPFS;
    act(() => {
      checkSizeWarning('exact-db', size, 'opfs');
    });

    expect(getState().sizeWarning).toBeNull();
  });
});

// =============================================================================
// Session Tracking Tests
// =============================================================================

describe('Size Warning - Session Tracking', () => {
  it('should track warned DBs per session', () => {
    act(() => {
      checkSizeWarning('db-a', 150 * 1024 * 1024, 'opfs');
    });

    const firstWarning = getState().sizeWarning;
    expect(firstWarning).not.toBeNull();

    // Clear and check again for same DB - should not warn again
    act(() => {
      clearSizeWarning();
      checkSizeWarning('db-a', 150 * 1024 * 1024, 'opfs');
    });

    const secondWarning = getState().sizeWarning;
    expect(secondWarning).toBeNull();
  });

  it('should warn for different DBs', () => {
    act(() => {
      checkSizeWarning('db-a', 150 * 1024 * 1024, 'opfs');
    });
    expect(getState().sizeWarning).not.toBeNull();

    act(() => {
      clearSizeWarning();
      checkSizeWarning('db-b', 150 * 1024 * 1024, 'opfs');
    });
    expect(getState().sizeWarning).not.toBeNull();
    expect(getState().sizeWarning?.dbId).toBe('db-b');
  });

  it('should re-warn if storage mode changes', () => {
    act(() => {
      checkSizeWarning('db-a', 60 * 1024 * 1024, 'opfs');
    });
    // Under OPFS threshold, no warning
    expect(getState().sizeWarning).toBeNull();

    act(() => {
      checkSizeWarning('db-a', 60 * 1024 * 1024, 'idb');
    });
    // Over IDB threshold, should warn
    expect(getState().sizeWarning).not.toBeNull();
  });

  it('should re-warn same DB when storage mode changes even after prior warning', () => {
    // First: warn in OPFS mode for a large DB
    act(() => {
      checkSizeWarning('db-migrate', 150 * 1024 * 1024, 'opfs');
    });
    expect(getState().sizeWarning).not.toBeNull();
    expect(getState().sizeWarning?.storageMode).toBe('opfs');

    // Clear the warning (user dismissed it)
    act(() => {
      clearSizeWarning();
    });
    expect(getState().sizeWarning).toBeNull();

    // Same DB should NOT re-warn in OPFS (already warned this session)
    act(() => {
      checkSizeWarning('db-migrate', 150 * 1024 * 1024, 'opfs');
    });
    expect(getState().sizeWarning).toBeNull();

    // But switching to IDB should trigger new warning (different storage mode)
    act(() => {
      checkSizeWarning('db-migrate', 150 * 1024 * 1024, 'idb');
    });
    expect(getState().sizeWarning).not.toBeNull();
    expect(getState().sizeWarning?.storageMode).toBe('idb');
    expect(getState().sizeWarning?.threshold).toBe(SIZE_THRESHOLD_IDB);
  });
});

// =============================================================================
// Selector Tests
// =============================================================================

describe('Size Warning - useSizeWarning Selector', () => {
  it('should return null when no warning', () => {
    const { result } = renderHook(() => useSizeWarning());
    expect(result.current).toBeNull();
  });

  it('should return warning when set', () => {
    act(() => {
      checkSizeWarning('test-db', 150 * 1024 * 1024, 'opfs');
    });

    const { result } = renderHook(() => useSizeWarning());
    expect(result.current).not.toBeNull();
    expect(result.current?.dbId).toBe('test-db');
  });

  it('should update reactively', () => {
    const { result } = renderHook(() => useSizeWarning());
    expect(result.current).toBeNull();

    act(() => {
      checkSizeWarning('test-db', 150 * 1024 * 1024, 'opfs');
    });

    expect(result.current).not.toBeNull();

    act(() => {
      clearSizeWarning();
    });

    expect(result.current).toBeNull();
  });
});

// =============================================================================
// Badge State Tests
// =============================================================================

describe('Size Warning - Badge State', () => {
  it('should track DBs that exceed threshold for badge display', () => {
    act(() => {
      checkSizeWarning('large-db', 150 * 1024 * 1024, 'opfs');
    });

    const state = getState();
    expect(state.dbsExceedingThreshold.has('large-db')).toBe(true);
  });

  it('should NOT add to badge set if under threshold', () => {
    act(() => {
      checkSizeWarning('small-db', 50 * 1024 * 1024, 'opfs');
    });

    const state = getState();
    expect(state.dbsExceedingThreshold.has('small-db')).toBe(false);
  });

  it('should persist badge state after warning is cleared', () => {
    act(() => {
      checkSizeWarning('large-db', 150 * 1024 * 1024, 'opfs');
    });

    act(() => {
      clearSizeWarning();
    });

    const state = getState();
    // Badge should persist even after toast is dismissed
    expect(state.dbsExceedingThreshold.has('large-db')).toBe(true);
  });

  it('should remove from badge set when DB goes under threshold', () => {
    act(() => {
      checkSizeWarning('large-db', 150 * 1024 * 1024, 'opfs');
    });
    expect(getState().dbsExceedingThreshold.has('large-db')).toBe(true);

    // Simulate DB shrinking after VACUUM
    act(() => {
      checkSizeWarning('large-db', 50 * 1024 * 1024, 'opfs');
    });
    expect(getState().dbsExceedingThreshold.has('large-db')).toBe(false);
  });
});

// =============================================================================
// Growth Detection Tests
// =============================================================================

describe('Size Warning - Growth Detection', () => {
  it('should warn when DB crosses threshold due to growth', () => {
    // First check: under threshold
    act(() => {
      checkSizeWarning('growing-db', 99 * 1024 * 1024, 'opfs');
    });
    expect(getState().sizeWarning).toBeNull();
    expect(getState().dbsExceedingThreshold.has('growing-db')).toBe(false);

    // Second check: now over threshold (simulating growth from writes/imports)
    act(() => {
      checkSizeWarning('growing-db', 105 * 1024 * 1024, 'opfs');
    });
    expect(getState().sizeWarning).not.toBeNull();
    expect(getState().dbsExceedingThreshold.has('growing-db')).toBe(true);
  });

  it('should NOT re-warn if already warned for this DB', () => {
    // First growth event
    act(() => {
      checkSizeWarning('growing-db', 105 * 1024 * 1024, 'opfs');
    });
    expect(getState().sizeWarning).not.toBeNull();

    // Clear the toast
    act(() => {
      clearSizeWarning();
    });
    expect(getState().sizeWarning).toBeNull();

    // Continued growth - should NOT show another toast
    act(() => {
      checkSizeWarning('growing-db', 120 * 1024 * 1024, 'opfs');
    });
    expect(getState().sizeWarning).toBeNull();

    // But badge should remain
    expect(getState().dbsExceedingThreshold.has('growing-db')).toBe(true);
  });
});

// =============================================================================
// Reset Tests
// =============================================================================

describe('Size Warning - Reset', () => {
  it('should clear size warning on store reset', () => {
    act(() => {
      checkSizeWarning('test-db', 150 * 1024 * 1024, 'opfs');
    });
    expect(getState().sizeWarning).not.toBeNull();

    act(() => {
      useDatabaseStore.getState().reset();
    });

    expect(getState().sizeWarning).toBeNull();
    expect(getState().dbsExceedingThreshold.size).toBe(0);
    expect(getState().warnedDbsThisSession.size).toBe(0);
  });
});
