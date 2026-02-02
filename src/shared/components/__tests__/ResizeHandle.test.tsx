/**
 * Tests for ResizeHandle component (Fix #7)
 *
 * The fix: Added aria-valuenow, aria-valuemin, aria-valuemax attributes
 * for role="separator" to improve accessibility.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResizeHandle } from '../ResizeHandle';

describe('ResizeHandle - ARIA attributes for accessibility', () => {
  it('should have aria-valuenow attribute', () => {
    render(
      <ResizeHandle
        direction="horizontal"
        onMouseDown={vi.fn()}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    expect(handle).toHaveAttribute('aria-valuenow');
    // Value should be a number (50 representing conceptual midpoint)
    const value = handle.getAttribute('aria-valuenow');
    expect(Number(value)).toBe(50);
  });

  it('should have aria-valuemin attribute', () => {
    render(
      <ResizeHandle
        direction="horizontal"
        onMouseDown={vi.fn()}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    expect(handle).toHaveAttribute('aria-valuemin');
    expect(handle.getAttribute('aria-valuemin')).toBe('0');
  });

  it('should have aria-valuemax attribute', () => {
    render(
      <ResizeHandle
        direction="horizontal"
        onMouseDown={vi.fn()}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    expect(handle).toHaveAttribute('aria-valuemax');
    expect(handle.getAttribute('aria-valuemax')).toBe('100');
  });

  it('should have role="separator"', () => {
    render(
      <ResizeHandle
        direction="horizontal"
        onMouseDown={vi.fn()}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    expect(handle).toHaveAttribute('role', 'separator');
  });

  it('should have aria-orientation for horizontal resize', () => {
    render(
      <ResizeHandle
        direction="horizontal"
        onMouseDown={vi.fn()}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    // Horizontal resize handle has vertical orientation (it's a vertical bar)
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('should have aria-orientation for vertical resize', () => {
    render(
      <ResizeHandle
        direction="vertical"
        onMouseDown={vi.fn()}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    // Vertical resize handle has horizontal orientation (it's a horizontal bar)
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('should have aria-label describing the resize action', () => {
    render(
      <ResizeHandle
        direction="horizontal"
        onMouseDown={vi.fn()}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    expect(handle).toHaveAttribute('aria-label');
    expect(handle.getAttribute('aria-label')).toMatch(/resize/i);
  });

  it('should have tabIndex for keyboard focus', () => {
    render(
      <ResizeHandle
        direction="horizontal"
        onMouseDown={vi.fn()}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    expect(handle).toHaveAttribute('tabIndex', '0');
  });
});

describe('ResizeHandle - Basic functionality', () => {
  it('should call onMouseDown when clicked', () => {
    const onMouseDown = vi.fn();
    render(
      <ResizeHandle
        direction="horizontal"
        onMouseDown={onMouseDown}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    fireEvent.mouseDown(handle);

    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });

  it('should apply horizontal styles for horizontal direction', () => {
    render(
      <ResizeHandle
        direction="horizontal"
        onMouseDown={vi.fn()}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    expect(handle).toHaveClass('cursor-col-resize');
    expect(handle).toHaveClass('w-1');
  });

  it('should apply vertical styles for vertical direction', () => {
    render(
      <ResizeHandle
        direction="vertical"
        onMouseDown={vi.fn()}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    expect(handle).toHaveClass('cursor-row-resize');
    expect(handle).toHaveClass('h-1');
  });

  it('should apply dragging styles when isDragging is true', () => {
    render(
      <ResizeHandle
        direction="horizontal"
        onMouseDown={vi.fn()}
        isDragging={true}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    expect(handle).toHaveClass('bg-navy-400');
  });

  it('should apply transparent background when not dragging', () => {
    render(
      <ResizeHandle
        direction="horizontal"
        onMouseDown={vi.fn()}
        isDragging={false}
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    expect(handle).toHaveClass('bg-transparent');
  });

  it('should merge custom className', () => {
    render(
      <ResizeHandle
        direction="horizontal"
        onMouseDown={vi.fn()}
        className="custom-class"
        data-testid="resize-handle"
      />
    );

    const handle = screen.getByTestId('resize-handle');
    expect(handle).toHaveClass('custom-class');
  });
});

describe('ResizeHandle - Source code verification', () => {
  it('should have all required ARIA attributes in source', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const filePath = resolve(__dirname, '../ResizeHandle.tsx');
    const content = readFileSync(filePath, 'utf-8');

    // Verify all ARIA attributes are present
    expect(content).toContain('aria-valuenow');
    expect(content).toContain('aria-valuemin');
    expect(content).toContain('aria-valuemax');
    expect(content).toContain('role="separator"');
    expect(content).toContain('aria-orientation');
    expect(content).toContain('aria-label');
    expect(content).toContain('tabIndex');
  });

  it('should have comment explaining the fixed ARIA value', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const filePath = resolve(__dirname, '../ResizeHandle.tsx');
    const content = readFileSync(filePath, 'utf-8');

    // Verify there's an explanation about the fixed value
    expect(content).toMatch(/50.*representing|conceptual|midpoint/i);
  });
});
