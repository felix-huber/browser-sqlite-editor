/**
 * Tests for useResizable hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResizable } from '../useResizable';

describe('useResizable', () => {
  const mockLocalStorage: Record<string, string> = {};

  beforeEach(() => {
    // Mock localStorage
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      return mockLocalStorage[key] ?? null;
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      mockLocalStorage[key] = value;
    });

    // Clear mock storage
    Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with default size when no localStorage value', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-size',
        initialSize: 300,
        minSize: 100,
        maxSize: 500,
        direction: 'horizontal',
      })
    );

    expect(result.current.size).toBe(300);
    expect(result.current.isDragging).toBe(false);
  });

  it('should initialize with localStorage value when available', () => {
    mockLocalStorage['test-size'] = '350';

    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-size',
        initialSize: 300,
        minSize: 100,
        maxSize: 500,
        direction: 'horizontal',
      })
    );

    expect(result.current.size).toBe(350);
  });

  it('should ignore invalid localStorage values', () => {
    mockLocalStorage['test-size'] = 'invalid';

    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-size',
        initialSize: 300,
        minSize: 100,
        maxSize: 500,
        direction: 'horizontal',
      })
    );

    expect(result.current.size).toBe(300);
  });

  it('should clamp localStorage value within bounds', () => {
    mockLocalStorage['test-size'] = '1000'; // Exceeds maxSize

    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-size',
        initialSize: 300,
        minSize: 100,
        maxSize: 500,
        direction: 'horizontal',
      })
    );

    // Should use initial size since stored value is out of bounds
    expect(result.current.size).toBe(300);
  });

  it('should allow programmatic size setting', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-size',
        initialSize: 300,
        minSize: 100,
        maxSize: 500,
        direction: 'horizontal',
      })
    );

    act(() => {
      result.current.setSize(400);
    });

    expect(result.current.size).toBe(400);
    expect(mockLocalStorage['test-size']).toBe('400');
  });

  it('should clamp size when setting programmatically', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-size',
        initialSize: 300,
        minSize: 100,
        maxSize: 500,
        direction: 'horizontal',
      })
    );

    act(() => {
      result.current.setSize(1000); // Exceeds max
    });

    expect(result.current.size).toBe(500); // Clamped to max

    act(() => {
      result.current.setSize(50); // Below min
    });

    expect(result.current.size).toBe(100); // Clamped to min
  });

  it('should reset size to initial value', () => {
    mockLocalStorage['test-size'] = '400';

    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-size',
        initialSize: 300,
        minSize: 100,
        maxSize: 500,
        direction: 'horizontal',
      })
    );

    expect(result.current.size).toBe(400);

    act(() => {
      result.current.resetSize();
    });

    expect(result.current.size).toBe(300);
    expect(mockLocalStorage['test-size']).toBe('300');
  });

  it('should set isDragging when handleMouseDown is called', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-size',
        initialSize: 300,
        minSize: 100,
        maxSize: 500,
        direction: 'horizontal',
      })
    );

    expect(result.current.isDragging).toBe(false);

    const mockEvent = {
      preventDefault: vi.fn(),
      clientX: 100,
      clientY: 100,
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleMouseDown(mockEvent);
    });

    expect(result.current.isDragging).toBe(true);
    expect(mockEvent.preventDefault).toHaveBeenCalled();
  });

  it('should update size during drag (horizontal)', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-size',
        initialSize: 300,
        minSize: 100,
        maxSize: 500,
        direction: 'horizontal',
        handlePosition: 'end',
      })
    );

    const mockEvent = {
      preventDefault: vi.fn(),
      clientX: 100,
      clientY: 100,
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleMouseDown(mockEvent);
    });

    // Simulate mouse move
    act(() => {
      const mouseMoveEvent = new MouseEvent('mousemove', {
        clientX: 150,
        clientY: 100,
      });
      document.dispatchEvent(mouseMoveEvent);
    });

    // Size should increase by 50 (150 - 100)
    expect(result.current.size).toBe(350);

    // Simulate mouse up
    act(() => {
      const mouseUpEvent = new MouseEvent('mouseup');
      document.dispatchEvent(mouseUpEvent);
    });

    expect(result.current.isDragging).toBe(false);
  });

  it('should update size during drag (vertical)', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-size',
        initialSize: 300,
        minSize: 100,
        maxSize: 500,
        direction: 'vertical',
        handlePosition: 'end',
      })
    );

    const mockEvent = {
      preventDefault: vi.fn(),
      clientX: 100,
      clientY: 100,
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleMouseDown(mockEvent);
    });

    // Simulate mouse move downward
    act(() => {
      const mouseMoveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 150,
      });
      document.dispatchEvent(mouseMoveEvent);
    });

    // Size should increase by 50 (150 - 100)
    expect(result.current.size).toBe(350);
  });

  it('should handle start position (drag inverts direction)', () => {
    const { result } = renderHook(() =>
      useResizable({
        storageKey: 'test-size',
        initialSize: 300,
        minSize: 100,
        maxSize: 500,
        direction: 'vertical',
        handlePosition: 'start', // Handle at top, drag up increases size
      })
    );

    const mockEvent = {
      preventDefault: vi.fn(),
      clientX: 100,
      clientY: 100,
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleMouseDown(mockEvent);
    });

    // Simulate mouse move downward (should decrease size with start position)
    act(() => {
      const mouseMoveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 150,
      });
      document.dispatchEvent(mouseMoveEvent);
    });

    // With handlePosition='start', moving down (positive delta) should decrease size
    expect(result.current.size).toBe(250);
  });
});
