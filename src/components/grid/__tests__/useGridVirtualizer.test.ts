/**
 * Tests for useGridVirtualizer hook and utilities
 */

import { describe, it, expect } from 'vitest';
import { calculateVisibleRange } from '../useGridVirtualizer';
import { ROW_HEIGHT } from '../useDataGrid';

// =============================================================================
// calculateVisibleRange Tests
// =============================================================================

describe('calculateVisibleRange', () => {
  it('calculates visible range from scroll position', () => {
    // 10 rows visible (320px / 32px per row)
    const result = calculateVisibleRange(0, 320, 100);

    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(9);
  });

  it('calculates visible range after scrolling', () => {
    // Scrolled down 160px (5 rows), viewport shows 10 rows
    const result = calculateVisibleRange(160, 320, 100);

    expect(result.startIndex).toBe(5);
    expect(result.endIndex).toBe(14);
  });

  it('handles partial row visibility', () => {
    // Scrolled 48px (1.5 rows), viewport shows ~10 rows
    const result = calculateVisibleRange(48, 320, 100);

    expect(result.startIndex).toBe(1);
    // Ceiling of 320/32 = 10, so endIndex = 1 + 10 - 1 = 10
    expect(result.endIndex).toBe(10);
  });

  it('clamps to total rows', () => {
    // Scrolled to near end with only 50 rows total
    const result = calculateVisibleRange(1440, 320, 50);

    expect(result.startIndex).toBe(45);
    expect(result.endIndex).toBe(49); // Clamped to last row
  });

  it('handles empty dataset', () => {
    const result = calculateVisibleRange(0, 320, 0);

    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(0);
  });

  it('handles viewport larger than content', () => {
    // 10 rows visible but only 5 rows total
    const result = calculateVisibleRange(0, 320, 5);

    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(4);
  });

  it('handles very large scroll offset', () => {
    // Scrolled way past the end
    const result = calculateVisibleRange(100000, 320, 100);

    // startIndex would be 3125, but we have only 100 rows
    expect(result.startIndex).toBeGreaterThanOrEqual(0);
    expect(result.endIndex).toBeLessThanOrEqual(99);
  });

  it('uses correct ROW_HEIGHT', () => {
    // Verify ROW_HEIGHT is used (32px)
    expect(ROW_HEIGHT).toBe(32);

    // At scroll 64, we should be at row 2 (64 / 32)
    const result = calculateVisibleRange(64, 64, 100);
    expect(result.startIndex).toBe(2);
  });
});

// =============================================================================
// Virtualizer Configuration Tests
// =============================================================================

describe('Virtualizer constants', () => {
  it('ROW_HEIGHT matches grid configuration', () => {
    // Ensure consistency between modules
    expect(ROW_HEIGHT).toBe(32);
  });
});
