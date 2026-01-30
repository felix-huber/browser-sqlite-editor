import { render, screen, fireEvent } from '@testing-library/react';
import { TableItem } from '../TableItem';

describe('TableItem', () => {
  const defaultProps = {
    name: 'users',
    type: 'table' as const,
  };

  it('renders table item with name', () => {
    render(<TableItem {...defaultProps} />);
    expect(screen.getByTestId('item-table-users')).toHaveTextContent('users');
  });

  it('renders view item with correct test id', () => {
    render(<TableItem name="user_summary" type="view" />);
    expect(screen.getByTestId('item-view-user_summary')).toBeInTheDocument();
  });

  it('renders index item with correct test id', () => {
    render(<TableItem name="idx_users_email" type="index" />);
    expect(screen.getByTestId('item-index-idx_users_email')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<TableItem {...defaultProps} onClick={onClick} />);

    const item = screen.getByTestId('item-table-users');
    fireEvent.click(item);

    expect(onClick).toHaveBeenCalled();
  });

  it('calls onClick on Enter key', () => {
    const onClick = vi.fn();
    render(<TableItem {...defaultProps} onClick={onClick} />);

    const item = screen.getByTestId('item-table-users');
    fireEvent.keyDown(item, { key: 'Enter' });

    expect(onClick).toHaveBeenCalled();
  });

  it('calls onClick on Space key', () => {
    const onClick = vi.fn();
    render(<TableItem {...defaultProps} onClick={onClick} />);

    const item = screen.getByTestId('item-table-users');
    fireEvent.keyDown(item, { key: ' ' });

    expect(onClick).toHaveBeenCalled();
  });

  it('applies selected style when isSelected is true', () => {
    render(<TableItem {...defaultProps} isSelected={true} />);

    const item = screen.getByTestId('item-table-users');
    expect(item).toHaveClass('bg-navy-100');
    expect(item).toHaveClass('text-navy-900');
  });

  it('applies default style when isSelected is false', () => {
    render(<TableItem {...defaultProps} isSelected={false} />);

    const item = screen.getByTestId('item-table-users');
    expect(item).toHaveClass('text-navy-600');
    expect(item).not.toHaveClass('bg-navy-100');
  });

  it('displays row count badge for tables', () => {
    render(<TableItem {...defaultProps} rowCount={999} />);

    expect(screen.getByTestId('row-count-users')).toHaveTextContent('999');
  });

  it('formats large row counts with K suffix', () => {
    render(<TableItem {...defaultProps} rowCount={12345} />);

    expect(screen.getByTestId('row-count-users')).toHaveTextContent('12.3K');
  });

  it('formats very large row counts with M suffix', () => {
    render(<TableItem {...defaultProps} rowCount={1234567} />);

    expect(screen.getByTestId('row-count-users')).toHaveTextContent('1.2M');
  });

  it('does not display row count for views', () => {
    render(<TableItem name="user_summary" type="view" rowCount={100} />);

    expect(screen.queryByTestId('row-count-user_summary')).not.toBeInTheDocument();
  });

  it('does not display row count for indexes', () => {
    render(<TableItem name="idx_users_email" type="index" rowCount={100} />);

    expect(screen.queryByTestId('row-count-idx_users_email')).not.toBeInTheDocument();
  });

  it('displays target table for indexes', () => {
    render(
      <TableItem
        name="idx_users_email"
        type="index"
        targetTable="users"
      />
    );

    expect(screen.getByTestId('target-table-idx_users_email')).toHaveTextContent(
      '→ users'
    );
  });

  it('has proper accessibility attributes', () => {
    render(<TableItem {...defaultProps} isSelected={true} />);

    const item = screen.getByRole('treeitem');
    expect(item).toHaveAttribute('aria-selected', 'true');
    expect(item).toHaveAttribute('tabindex', '0');
  });

  it('sets aria-selected to false when not selected', () => {
    render(<TableItem {...defaultProps} isSelected={false} />);

    const item = screen.getByRole('treeitem');
    expect(item).toHaveAttribute('aria-selected', 'false');
  });

  describe('Search highlighting', () => {
    it('highlights matching substring', () => {
      render(<TableItem {...defaultProps} searchFilter="user" />);

      const highlight = screen.getByTestId('highlight-match');
      expect(highlight).toBeInTheDocument();
      expect(highlight).toHaveTextContent('user');
      expect(highlight.tagName).toBe('MARK');
    });

    it('uses amber-200 background for highlighting', () => {
      render(<TableItem {...defaultProps} searchFilter="user" />);

      const highlight = screen.getByTestId('highlight-match');
      expect(highlight).toHaveClass('bg-amber-200');
    });

    it('preserves case of original name in highlight', () => {
      render(<TableItem name="Users" type="table" searchFilter="user" />);

      const highlight = screen.getByTestId('highlight-match');
      expect(highlight).toHaveTextContent('User'); // "User" from "Users"
    });

    it('is case insensitive when finding matches', () => {
      render(<TableItem {...defaultProps} searchFilter="USER" />);

      const highlight = screen.getByTestId('highlight-match');
      expect(highlight).toBeInTheDocument();
      expect(highlight).toHaveTextContent('user');
    });

    it('does not highlight when no match', () => {
      render(<TableItem {...defaultProps} searchFilter="xyz" />);

      expect(screen.queryByTestId('highlight-match')).not.toBeInTheDocument();
    });

    it('does not highlight when searchFilter is empty', () => {
      render(<TableItem {...defaultProps} searchFilter="" />);

      expect(screen.queryByTestId('highlight-match')).not.toBeInTheDocument();
    });

    it('does not highlight when searchFilter is undefined', () => {
      render(<TableItem {...defaultProps} />);

      expect(screen.queryByTestId('highlight-match')).not.toBeInTheDocument();
    });

    it('highlights partial matches correctly', () => {
      render(<TableItem name="user_accounts" type="table" searchFilter="account" />);

      const highlight = screen.getByTestId('highlight-match');
      expect(highlight).toHaveTextContent('account');
    });
  });
});
