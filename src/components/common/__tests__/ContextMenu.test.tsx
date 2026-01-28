import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../ContextMenu';

describe('ContextMenu', () => {
  const mockOnClose = vi.fn();

  const defaultItems: ContextMenuItem[] = [
    { id: 'item1', label: 'Item 1', onClick: vi.fn() },
    { id: 'item2', label: 'Item 2', onClick: vi.fn() },
    { id: 'item3', label: 'Item 3', onClick: vi.fn(), disabled: true, disabledTooltip: 'Not available' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders menu items', () => {
    render(
      <ContextMenu items={defaultItems} x={100} y={100} onClose={mockOnClose} />
    );

    expect(screen.getByTestId('context-menu-item-item1')).toHaveTextContent('Item 1');
    expect(screen.getByTestId('context-menu-item-item2')).toHaveTextContent('Item 2');
    expect(screen.getByTestId('context-menu-item-item3')).toHaveTextContent('Item 3');
  });

  it('calls onClick when item is clicked', () => {
    const onClick = vi.fn();
    const items: ContextMenuItem[] = [
      { id: 'clickable', label: 'Click Me', onClick },
    ];

    render(
      <ContextMenu items={items} x={100} y={100} onClose={mockOnClose} />
    );

    fireEvent.click(screen.getByTestId('context-menu-item-clickable'));

    expect(onClick).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('does not call onClick for disabled items', () => {
    const onClick = vi.fn();
    const items: ContextMenuItem[] = [
      { id: 'disabled', label: 'Disabled', onClick, disabled: true },
    ];

    render(
      <ContextMenu items={items} x={100} y={100} onClose={mockOnClose} />
    );

    fireEvent.click(screen.getByTestId('context-menu-item-disabled'));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows tooltip on hover for disabled items', async () => {
    const items: ContextMenuItem[] = [
      { id: 'disabled', label: 'Disabled', disabled: true, disabledTooltip: 'Cannot do this' },
    ];

    render(
      <ContextMenu items={items} x={100} y={100} onClose={mockOnClose} />
    );

    fireEvent.mouseEnter(screen.getByTestId('context-menu-item-disabled'));

    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent('Cannot do this');
    });
  });

  it('renders dividers after items with dividerAfter', () => {
    const items: ContextMenuItem[] = [
      { id: 'item1', label: 'Item 1', dividerAfter: true },
      { id: 'item2', label: 'Item 2' },
    ];

    render(
      <ContextMenu items={items} x={100} y={100} onClose={mockOnClose} />
    );

    expect(screen.getByTestId('context-menu-divider-item1')).toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    render(
      <ContextMenu items={defaultItems} x={100} y={100} onClose={mockOnClose} />
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('closes on outside click', () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <ContextMenu items={defaultItems} x={100} y={100} onClose={mockOnClose} />
      </div>
    );

    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('supports keyboard navigation with ArrowDown', () => {
    render(
      <ContextMenu items={defaultItems} x={100} y={100} onClose={mockOnClose} />
    );

    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });

    // First enabled item should be focused
    expect(screen.getByTestId('context-menu-item-item1')).toHaveClass('bg-navy-100');
  });

  it('skips disabled items during keyboard navigation', () => {
    const items: ContextMenuItem[] = [
      { id: 'item1', label: 'Item 1', disabled: true },
      { id: 'item2', label: 'Item 2' },
    ];

    render(
      <ContextMenu items={items} x={100} y={100} onClose={mockOnClose} />
    );

    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });

    // Second item should be focused (first is disabled)
    expect(screen.getByTestId('context-menu-item-item2')).toHaveClass('bg-navy-100');
  });

  it('renders icons when provided', () => {
    const items: ContextMenuItem[] = [
      { id: 'with-icon', label: 'With Icon', icon: <span data-testid="test-icon">Icon</span> },
    ];

    render(
      <ContextMenu items={items} x={100} y={100} onClose={mockOnClose} />
    );

    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('applies disabled styles to disabled items', () => {
    const items: ContextMenuItem[] = [
      { id: 'disabled', label: 'Disabled', disabled: true },
    ];

    render(
      <ContextMenu items={items} x={100} y={100} onClose={mockOnClose} />
    );

    expect(screen.getByTestId('context-menu-item-disabled')).toHaveClass('text-navy-300', 'cursor-not-allowed');
  });

  it('uses custom testIdPrefix', () => {
    render(
      <ContextMenu items={defaultItems} x={100} y={100} onClose={mockOnClose} testIdPrefix="custom-menu" />
    );

    expect(screen.getByTestId('custom-menu')).toBeInTheDocument();
    expect(screen.getByTestId('custom-menu-item-item1')).toBeInTheDocument();
  });
});

describe('useContextMenu', () => {
  it('initializes with closed state', () => {
    const { result } = renderHook(() => useContextMenu());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.x).toBe(0);
    expect(result.current.y).toBe(0);
  });

  it('opens at specified position', () => {
    const { result } = renderHook(() => useContextMenu());

    act(() => {
      result.current.open(150, 250);
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.x).toBe(150);
    expect(result.current.y).toBe(250);
  });

  it('closes the menu', () => {
    const { result } = renderHook(() => useContextMenu());

    act(() => {
      result.current.open(100, 100);
    });

    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.close();
    });

    expect(result.current.isOpen).toBe(false);
  });

  it('provides onContextMenu handler', () => {
    const { result } = renderHook(() => useContextMenu());

    const mockEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 200,
      clientY: 300,
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.onContextMenu(mockEvent);
    });

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockEvent.stopPropagation).toHaveBeenCalled();
    expect(result.current.isOpen).toBe(true);
    expect(result.current.x).toBe(200);
    expect(result.current.y).toBe(300);
  });
});
