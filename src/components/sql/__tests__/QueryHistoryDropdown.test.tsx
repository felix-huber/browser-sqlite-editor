/**
 * Unit tests for QueryHistoryDropdown
 *
 * Tests cover:
 * - Rendering with history items
 * - Dropdown open/close behavior
 * - Search/filter functionality
 * - Item selection
 * - Individual item deletion
 * - Clear all history
 * - Relative time display
 * - Query truncation display
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryHistoryDropdown } from '../QueryHistoryDropdown';
import type { QueryHistoryItem } from '../../../types';

describe('QueryHistoryDropdown', () => {
  const mockOnSelect = vi.fn();
  const mockOnDelete = vi.fn();
  const mockOnClear = vi.fn();

  const createHistory = (items: string[]): QueryHistoryItem[] =>
    items.map((sql, i) => ({
      sql,
      executedAt: new Date(Date.now() - i * 60000).toISOString(), // Each item 1 minute older
    }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should not render when history is empty', () => {
    render(
      <QueryHistoryDropdown
        history={[]}
        onSelect={mockOnSelect}
      />
    );
    expect(screen.queryByTestId('history-button')).not.toBeInTheDocument();
  });

  it('should render history button when history exists', () => {
    const history = createHistory(['SELECT 1']);
    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
      />
    );
    expect(screen.getByTestId('history-button')).toBeInTheDocument();
  });

  it('should open dropdown when button is clicked', async () => {
    const user = userEvent.setup();
    const history = createHistory(['SELECT 1', 'SELECT 2']);

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
      />
    );

    await user.click(screen.getByTestId('history-button'));
    expect(screen.getByTestId('history-dropdown')).toBeInTheDocument();
    expect(screen.getByTestId('history-item-0')).toBeInTheDocument();
    expect(screen.getByTestId('history-item-1')).toBeInTheDocument();
  });

  it('should close dropdown when clicking outside', async () => {
    const user = userEvent.setup();
    const history = createHistory(['SELECT 1']);

    render(
      <div>
        <QueryHistoryDropdown
          history={history}
          onSelect={mockOnSelect}
        />
        <button data-testid="outside">Outside</button>
      </div>
    );

    await user.click(screen.getByTestId('history-button'));
    expect(screen.getByTestId('history-dropdown')).toBeInTheDocument();

    // Click outside
    await user.click(screen.getByTestId('outside'));

    await waitFor(() => {
      expect(screen.queryByTestId('history-dropdown')).not.toBeInTheDocument();
    });
  });

  it('should call onSelect when clicking an item', async () => {
    const user = userEvent.setup();
    const history = createHistory(['SELECT 1', 'SELECT 2']);

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
      />
    );

    await user.click(screen.getByTestId('history-button'));
    await user.click(screen.getByTestId('history-item-1'));

    expect(mockOnSelect).toHaveBeenCalledWith(history[1]);
    // Dropdown should close after selection
    expect(screen.queryByTestId('history-dropdown')).not.toBeInTheDocument();
  });

  it('should search/filter history items', async () => {
    const user = userEvent.setup();
    const history = createHistory(['SELECT * FROM users', 'INSERT INTO users', 'DELETE FROM posts']);

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
      />
    );

    await user.click(screen.getByTestId('history-button'));
    const searchInput = screen.getByTestId('history-search');
    await user.type(searchInput, 'users');

    // Should only show items containing "users"
    expect(screen.getByTestId('history-item-0')).toBeInTheDocument();
    expect(screen.getByTestId('history-item-1')).toBeInTheDocument();
    expect(screen.queryByTestId('history-item-2')).not.toBeInTheDocument();
  });

  it('should show empty message when search has no results', async () => {
    const user = userEvent.setup();
    const history = createHistory(['SELECT 1']);

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
      />
    );

    await user.click(screen.getByTestId('history-button'));
    const searchInput = screen.getByTestId('history-search');
    await user.type(searchInput, 'nonexistent');

    expect(screen.getByTestId('history-empty')).toHaveTextContent('No matching queries found');
  });

  it('should delete individual items when X button is clicked', async () => {
    const user = userEvent.setup();
    const history = createHistory(['SELECT 1', 'SELECT 2']);

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
        onDelete={mockOnDelete}
      />
    );

    await user.click(screen.getByTestId('history-button'));

    // Hover to reveal delete button, then click it
    const deleteBtn = screen.getByTestId('history-delete-0');
    await user.click(deleteBtn);

    expect(mockOnDelete).toHaveBeenCalledWith(0);
    // Dropdown should remain open after delete
  });

  it('should not show delete buttons when onDelete is not provided', async () => {
    const user = userEvent.setup();
    const history = createHistory(['SELECT 1']);

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
        // onDelete not provided
      />
    );

    await user.click(screen.getByTestId('history-button'));
    expect(screen.queryByTestId('history-delete-0')).not.toBeInTheDocument();
  });

  it('should clear all history when Clear button is clicked', async () => {
    const user = userEvent.setup();
    const history = createHistory(['SELECT 1', 'SELECT 2']);

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
        onClear={mockOnClear}
      />
    );

    await user.click(screen.getByTestId('history-button'));
    await user.click(screen.getByTestId('history-clear'));

    expect(mockOnClear).toHaveBeenCalled();
    // Dropdown should close after clear
    expect(screen.queryByTestId('history-dropdown')).not.toBeInTheDocument();
  });

  it('should not show Clear button when onClear is not provided', async () => {
    const user = userEvent.setup();
    const history = createHistory(['SELECT 1']);

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
        // onClear not provided
      />
    );

    await user.click(screen.getByTestId('history-button'));
    expect(screen.queryByTestId('history-clear')).not.toBeInTheDocument();
  });

  it('should display relative time for recent queries', async () => {
    const user = userEvent.setup();
    // Query executed 30 seconds ago
    const history: QueryHistoryItem[] = [
      { sql: 'SELECT 1', executedAt: new Date(Date.now() - 30000).toISOString() },
    ];

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
      />
    );

    await user.click(screen.getByTestId('history-button'));
    expect(screen.getByTestId('history-item-time-0')).toHaveTextContent('just now');
  });

  it('should display minutes ago for queries', async () => {
    const user = userEvent.setup();
    // Query executed 5 minutes ago
    const history: QueryHistoryItem[] = [
      { sql: 'SELECT 1', executedAt: new Date(Date.now() - 5 * 60000).toISOString() },
    ];

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
      />
    );

    await user.click(screen.getByTestId('history-button'));
    expect(screen.getByTestId('history-item-time-0')).toHaveTextContent('5m ago');
  });

  it('should display hours ago for queries', async () => {
    const user = userEvent.setup();
    // Query executed 3 hours ago
    const history: QueryHistoryItem[] = [
      { sql: 'SELECT 1', executedAt: new Date(Date.now() - 3 * 60 * 60000).toISOString() },
    ];

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
      />
    );

    await user.click(screen.getByTestId('history-button'));
    expect(screen.getByTestId('history-item-time-0')).toHaveTextContent('3h ago');
  });

  it('should truncate long queries in display', async () => {
    const user = userEvent.setup();
    const longQuery = 'SELECT ' + 'x'.repeat(100);
    const history = createHistory([longQuery]);

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
      />
    );

    await user.click(screen.getByTestId('history-button'));
    const queryText = screen.getByTestId('history-item-query-0').textContent;
    expect(queryText?.length).toBeLessThanOrEqual(50);
    expect(queryText?.endsWith('...')).toBe(true);
  });

  it('should show full query in title attribute', async () => {
    const user = userEvent.setup();
    const longQuery = 'SELECT ' + 'x'.repeat(100);
    const history = createHistory([longQuery]);

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
      />
    );

    await user.click(screen.getByTestId('history-button'));
    const item = screen.getByTestId('history-item-0');
    expect(item.getAttribute('title')).toBe(longQuery);
  });

  it('should close dropdown when pressing Escape', async () => {
    const user = userEvent.setup();
    const history = createHistory(['SELECT 1']);

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
      />
    );

    await user.click(screen.getByTestId('history-button'));
    expect(screen.getByTestId('history-dropdown')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId('history-dropdown').parentElement!, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('history-dropdown')).not.toBeInTheDocument();
    });
  });

  it('should focus search input when dropdown opens', async () => {
    const user = userEvent.setup();
    const history = createHistory(['SELECT 1']);

    render(
      <QueryHistoryDropdown
        history={history}
        onSelect={mockOnSelect}
      />
    );

    await user.click(screen.getByTestId('history-button'));
    const searchInput = screen.getByTestId('history-search');

    await waitFor(() => {
      expect(document.activeElement).toBe(searchInput);
    });
  });
});
