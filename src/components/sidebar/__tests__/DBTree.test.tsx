import { render, screen, fireEvent } from '@testing-library/react';
import { DBTree, type DBTreeSchema } from '../DBTree';
import { useDatabaseStore } from '../../../store';
import type { DatabaseEntry } from '../../../types';

// Mock the store
vi.mock('../../../store', async () => {
  const actual = await vi.importActual('../../../store');
  return {
    ...actual,
    useDatabaseStore: vi.fn(),
  };
});

const mockUseDatabaseStore = vi.mocked(useDatabaseStore);

describe('DBTree', () => {
  const mockDatabase: DatabaseEntry = {
    name: 'test-db',
    file: 'test-db.sqlite',
    createdAt: '2024-01-01T00:00:00Z',
    lastOpenedAt: '2024-01-01T00:00:00Z',
    fkEnforced: false,
  };

  const mockSchema: DBTreeSchema = {
    tables: ['users', 'orders', 'products'],
    views: ['user_summary'],
    indexes: ['idx_users_email'],
  };

  const defaultProps = {
    database: mockDatabase,
    isExpanded: false,
    isActive: false,
    onToggleExpand: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseStore.mockImplementation((selector) => {
      const state = {
        activeDbId: null,
        schema: null,
      };
      return selector(state as ReturnType<typeof useDatabaseStore.getState>);
    });
  });

  it('renders database name', () => {
    render(<DBTree {...defaultProps} />);
    expect(screen.getByTestId('db-name-test-db')).toHaveTextContent('test-db');
  });

  it('calls onToggleExpand when clicked', () => {
    const onToggleExpand = vi.fn();
    render(<DBTree {...defaultProps} onToggleExpand={onToggleExpand} />);

    const dbRow = screen.getByTestId('db-row-test-db');
    fireEvent.click(dbRow);

    expect(onToggleExpand).toHaveBeenCalled();
  });

  it('calls onToggleExpand on Enter key', () => {
    const onToggleExpand = vi.fn();
    render(<DBTree {...defaultProps} onToggleExpand={onToggleExpand} />);

    const dbRow = screen.getByTestId('db-row-test-db');
    fireEvent.keyDown(dbRow, { key: 'Enter' });

    expect(onToggleExpand).toHaveBeenCalled();
  });

  it('calls onToggleExpand on Space key', () => {
    const onToggleExpand = vi.fn();
    render(<DBTree {...defaultProps} onToggleExpand={onToggleExpand} />);

    const dbRow = screen.getByTestId('db-row-test-db');
    fireEvent.keyDown(dbRow, { key: ' ' });

    expect(onToggleExpand).toHaveBeenCalled();
  });

  it('does not show contents when collapsed', () => {
    render(<DBTree {...defaultProps} isExpanded={false} />);
    expect(screen.queryByTestId('db-contents-test-db')).not.toBeInTheDocument();
  });

  it('shows contents when expanded with schema', () => {
    render(
      <DBTree
        {...defaultProps}
        isExpanded={true}
        isActive={true}
        initialSchema={mockSchema}
      />
    );

    expect(screen.getByTestId('db-contents-test-db')).toBeInTheDocument();
  });

  it('displays tables section when schema has tables', () => {
    render(
      <DBTree
        {...defaultProps}
        isExpanded={true}
        isActive={true}
        initialSchema={mockSchema}
      />
    );

    expect(screen.getByTestId('section-tables')).toBeInTheDocument();
    expect(screen.getByTestId('item-table-users')).toBeInTheDocument();
    expect(screen.getByTestId('item-table-orders')).toBeInTheDocument();
    expect(screen.getByTestId('item-table-products')).toBeInTheDocument();
  });

  it('displays views section when schema has views', () => {
    render(
      <DBTree
        {...defaultProps}
        isExpanded={true}
        isActive={true}
        initialSchema={mockSchema}
      />
    );

    expect(screen.getByTestId('section-views')).toBeInTheDocument();
    expect(screen.getByTestId('item-view-user_summary')).toBeInTheDocument();
  });

  it('displays indexes section when schema has indexes', () => {
    render(
      <DBTree
        {...defaultProps}
        isExpanded={true}
        isActive={true}
        initialSchema={mockSchema}
      />
    );

    expect(screen.getByTestId('section-indexes')).toBeInTheDocument();
    expect(screen.getByTestId('item-index-idx_users_email')).toBeInTheDocument();
  });

  it('shows "Open database to view schema" when expanded but not active', () => {
    render(<DBTree {...defaultProps} isExpanded={true} isActive={false} />);

    expect(screen.getByTestId('open-db-hint')).toHaveTextContent(
      'Open database to view schema'
    );
  });

  it('shows "Empty database" when schema is empty', () => {
    render(
      <DBTree
        {...defaultProps}
        isExpanded={true}
        isActive={true}
        initialSchema={{ tables: [], views: [], indexes: [] }}
      />
    );

    expect(screen.getByTestId('empty-schema')).toHaveTextContent(
      'Empty database'
    );
  });

  it('filters items by search filter', () => {
    render(
      <DBTree
        {...defaultProps}
        isExpanded={true}
        isActive={true}
        initialSchema={mockSchema}
        searchFilter="user"
      />
    );

    expect(screen.getByTestId('item-table-users')).toBeInTheDocument();
    expect(screen.getByTestId('item-view-user_summary')).toBeInTheDocument();
    expect(screen.getByTestId('item-index-idx_users_email')).toBeInTheDocument();
    expect(screen.queryByTestId('item-table-orders')).not.toBeInTheDocument();
    expect(screen.queryByTestId('item-table-products')).not.toBeInTheDocument();
  });

  it('shows "No matching items" when filter has no results', () => {
    render(
      <DBTree
        {...defaultProps}
        isExpanded={true}
        isActive={true}
        initialSchema={mockSchema}
        searchFilter="nonexistent"
      />
    );

    expect(screen.getByTestId('empty-schema')).toHaveTextContent(
      'No matching items'
    );
  });

  it('calls onSelectTable when table is clicked', () => {
    const onSelectTable = vi.fn();
    render(
      <DBTree
        {...defaultProps}
        isExpanded={true}
        isActive={true}
        initialSchema={mockSchema}
        onSelectTable={onSelectTable}
      />
    );

    const tableItem = screen.getByTestId('item-table-users');
    fireEvent.click(tableItem);

    expect(onSelectTable).toHaveBeenCalledWith('users');
  });

  it('calls onSelectView when view is clicked', () => {
    const onSelectView = vi.fn();
    render(
      <DBTree
        {...defaultProps}
        isExpanded={true}
        isActive={true}
        initialSchema={mockSchema}
        onSelectView={onSelectView}
      />
    );

    const viewItem = screen.getByTestId('item-view-user_summary');
    fireEvent.click(viewItem);

    expect(onSelectView).toHaveBeenCalledWith('user_summary');
  });

  it('calls onSelectIndex when index is clicked', () => {
    const onSelectIndex = vi.fn();
    render(
      <DBTree
        {...defaultProps}
        isExpanded={true}
        isActive={true}
        initialSchema={mockSchema}
        onSelectIndex={onSelectIndex}
      />
    );

    const indexItem = screen.getByTestId('item-index-idx_users_email');
    fireEvent.click(indexItem);

    expect(onSelectIndex).toHaveBeenCalledWith('idx_users_email');
  });

  it('highlights selected item', () => {
    render(
      <DBTree
        {...defaultProps}
        isExpanded={true}
        isActive={true}
        initialSchema={mockSchema}
      />
    );

    const tableItem = screen.getByTestId('item-table-users');
    fireEvent.click(tableItem);

    expect(tableItem).toHaveClass('bg-navy-100');
  });

  it('applies active style to active database row', () => {
    render(<DBTree {...defaultProps} isActive={true} />);

    const dbRow = screen.getByTestId('db-row-test-db');
    expect(dbRow).toHaveClass('bg-navy-100');
  });

  it('has proper accessibility attributes', () => {
    render(
      <DBTree
        {...defaultProps}
        isExpanded={true}
        isActive={true}
        initialSchema={mockSchema}
      />
    );

    const dbTreeItem = screen.getByTestId('db-tree-test-db');
    expect(dbTreeItem).toHaveAttribute('role', 'treeitem');
    expect(dbTreeItem).toHaveAttribute('aria-expanded', 'true');
  });
});
