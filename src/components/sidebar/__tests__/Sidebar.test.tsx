import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import type { DatabaseEntry } from '../../../types';

// Create stable state object for mocks
let mockState = {
  activeDbId: null as string | null,
  schema: null as { tables: string[]; views: string[]; indexes: string[] } | null,
  databases: [] as DatabaseEntry[],
  isReadOnly: false,
  lockHolder: null,
  storageStatus: 'ok' as const,
  storageMode: null,
};

// Mock the store
vi.mock('../../../store', () => {
  return {
    useDatabases: vi.fn(() => mockState.databases),
    useDatabaseStore: vi.fn((selector: (state: typeof mockState) => unknown) => selector(mockState)),
  };
});

// Import the mocked functions
import { useDatabases, useDatabaseStore } from '../../../store';
const mockUseDatabases = vi.mocked(useDatabases);
const mockUseDatabaseStore = vi.mocked(useDatabaseStore);

describe('Sidebar', () => {
  const mockDatabases: DatabaseEntry[] = [
    {
      name: 'test-db',
      file: 'test-db.sqlite',
      createdAt: '2024-01-01T00:00:00Z',
      lastOpenedAt: '2024-01-01T00:00:00Z',
      fkEnforced: false,
    },
    {
      name: 'another-db',
      file: 'another-db.sqlite',
      createdAt: '2024-01-02T00:00:00Z',
      lastOpenedAt: '2024-01-02T00:00:00Z',
      fkEnforced: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockState = {
      activeDbId: null,
      schema: null,
      databases: [],
      isReadOnly: false,
      lockHolder: null,
      storageStatus: 'ok' as const,
      storageMode: null,
    };
    mockUseDatabases.mockImplementation(() => mockState.databases);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseDatabaseStore.mockImplementation((selector: (state: any) => unknown) => selector(mockState));
  });

  it('renders nothing when collapsed', () => {
    const { container } = render(<Sidebar collapsed={true} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders sidebar when not collapsed', () => {
    render(<Sidebar />);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('shows "No databases" message when database list is empty', () => {
    mockUseDatabases.mockReturnValue([]);
    render(<Sidebar />);
    expect(screen.getByTestId('empty-state')).toHaveTextContent('No databases');
  });

  it('renders all registered databases', () => {
    mockState.databases = mockDatabases;
    mockUseDatabases.mockReturnValue(mockDatabases);
    render(<Sidebar />);

    expect(screen.getByTestId('db-tree-test-db')).toBeInTheDocument();
    expect(screen.getByTestId('db-tree-another-db')).toBeInTheDocument();
  });

  it('filters databases by search input', () => {
    mockState.databases = mockDatabases;
    mockUseDatabases.mockReturnValue(mockDatabases);
    render(<Sidebar />);

    const searchInput = screen.getByTestId('search-input');
    fireEvent.change(searchInput, { target: { value: 'test' } });

    expect(screen.getByTestId('db-tree-test-db')).toBeInTheDocument();
    expect(screen.queryByTestId('db-tree-another-db')).not.toBeInTheDocument();
  });

  it('shows "No matching results" when search filter has no matches', () => {
    mockState.databases = mockDatabases;
    mockUseDatabases.mockReturnValue(mockDatabases);
    render(<Sidebar />);

    const searchInput = screen.getByTestId('search-input');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    expect(screen.getByTestId('empty-state')).toHaveTextContent(
      'No matching results'
    );
  });

  it('expands database when clicked', () => {
    mockState.databases = mockDatabases;
    mockUseDatabases.mockReturnValue(mockDatabases);
    render(<Sidebar />);

    const dbRow = screen.getByTestId('db-row-test-db');
    fireEvent.click(dbRow);

    expect(screen.getByTestId('db-contents-test-db')).toBeInTheDocument();
  });

  it('collapses database when clicked again', () => {
    mockState.databases = mockDatabases;
    mockUseDatabases.mockReturnValue(mockDatabases);
    render(<Sidebar />);

    const dbRow = screen.getByTestId('db-row-test-db');
    fireEvent.click(dbRow);
    expect(screen.getByTestId('db-contents-test-db')).toBeInTheDocument();

    fireEvent.click(dbRow);
    expect(screen.queryByTestId('db-contents-test-db')).not.toBeInTheDocument();
  });

  it('calls onSelectTable when a table is selected', () => {
    const onSelectTable = vi.fn();
    mockState = {
      activeDbId: 'test-db',
      schema: {
        tables: ['users', 'orders'],
        views: [],
        indexes: [],
      },
      databases: mockDatabases,
      isReadOnly: false,
      lockHolder: null,
      storageStatus: 'ok' as const,
      storageMode: null,
    };
    mockUseDatabases.mockReturnValue(mockDatabases);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseDatabaseStore.mockImplementation((selector: (state: any) => unknown) => selector(mockState));

    render(<Sidebar onSelectTable={onSelectTable} />);

    // Expand the database
    const dbRow = screen.getByTestId('db-row-test-db');
    fireEvent.click(dbRow);

    // Click on a table
    const tableItem = screen.getByTestId('item-table-users');
    fireEvent.click(tableItem);

    expect(onSelectTable).toHaveBeenCalledWith('test-db', 'users');
  });

  it('highlights the active database', () => {
    mockState = {
      activeDbId: 'test-db',
      schema: null,
      databases: mockDatabases,
      isReadOnly: false,
      lockHolder: null,
      storageStatus: 'ok' as const,
      storageMode: null,
    };
    mockUseDatabases.mockReturnValue(mockDatabases);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseDatabaseStore.mockImplementation((selector: (state: any) => unknown) => selector(mockState));

    render(<Sidebar />);

    const activeDbRow = screen.getByTestId('db-row-test-db');
    expect(activeDbRow).toHaveClass('bg-navy-100');
  });

  it('has proper accessibility attributes', () => {
    mockState.databases = mockDatabases;
    mockUseDatabases.mockReturnValue(mockDatabases);
    render(<Sidebar />);

    expect(
      screen.getByRole('navigation', { name: 'Database navigator' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tree', { name: 'Databases' })
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Search databases and tables')
    ).toBeInTheDocument();
  });
});
