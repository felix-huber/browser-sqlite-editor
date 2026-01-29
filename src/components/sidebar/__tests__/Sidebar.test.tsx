import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

    mockUseDatabaseStore.mockImplementation((selector: (state: typeof mockState) => unknown) => selector(mockState));
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

  it('filters databases by search input', async () => {
    mockState.databases = mockDatabases;
    mockUseDatabases.mockReturnValue(mockDatabases);
    render(<Sidebar />);

    const searchInput = screen.getByTestId('search-input');
    fireEvent.change(searchInput, { target: { value: 'test' } });

    // Wait for debounce (150ms) + buffer
    await waitFor(() => {
      expect(screen.getByTestId('db-tree-test-db')).toBeInTheDocument();
      expect(screen.queryByTestId('db-tree-another-db')).not.toBeInTheDocument();
    }, { timeout: 300 });
  });

  it('shows "No matching results" when search filter has no matches', async () => {
    mockState.databases = mockDatabases;
    mockUseDatabases.mockReturnValue(mockDatabases);
    render(<Sidebar />);

    const searchInput = screen.getByTestId('search-input');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    // Wait for debounce
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toHaveTextContent(
        'No matches for'
      );
    }, { timeout: 300 });
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
     
    mockUseDatabaseStore.mockImplementation((selector: (state: typeof mockState) => unknown) => selector(mockState));

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
     
    mockUseDatabaseStore.mockImplementation((selector: (state: typeof mockState) => unknown) => selector(mockState));

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

  describe('Search/Filter functionality', () => {
    it('has correct placeholder text', () => {
      render(<Sidebar />);
      const searchInput = screen.getByTestId('search-input');
      expect(searchInput).toHaveAttribute('placeholder', 'Search tables, views...');
    });

    it('shows clear button when search has text', () => {
      render(<Sidebar />);
      const searchInput = screen.getByTestId('search-input');

      expect(screen.queryByTestId('clear-search-button')).not.toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'test' } });

      expect(screen.getByTestId('clear-search-button')).toBeInTheDocument();
    });

    it('clears search when clear button is clicked', () => {
      render(<Sidebar />);
      const searchInput = screen.getByTestId('search-input');

      fireEvent.change(searchInput, { target: { value: 'test' } });
      expect(searchInput).toHaveValue('test');

      const clearButton = screen.getByTestId('clear-search-button');
      fireEvent.click(clearButton);

      expect(searchInput).toHaveValue('');
    });

    it('clears search on Escape key press', () => {
      render(<Sidebar />);
      const searchInput = screen.getByTestId('search-input');

      fireEvent.change(searchInput, { target: { value: 'test' } });
      expect(searchInput).toHaveValue('test');

      fireEvent.keyDown(searchInput, { key: 'Escape' });

      expect(searchInput).toHaveValue('');
    });

    it('shows query text in empty state when no matches', async () => {
      mockState.databases = mockDatabases;
      mockUseDatabases.mockReturnValue(mockDatabases);
      render(<Sidebar />);

      const searchInput = screen.getByTestId('search-input');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      // Wait for debounce
      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toHaveTextContent('No matches for "nonexistent"');
      }, { timeout: 300 });
    });

    it('shows clear search button in empty state', async () => {
      mockState.databases = mockDatabases;
      mockUseDatabases.mockReturnValue(mockDatabases);
      render(<Sidebar />);

      const searchInput = screen.getByTestId('search-input');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      await waitFor(() => {
        expect(screen.getByTestId('empty-state-clear-button')).toBeInTheDocument();
      }, { timeout: 300 });
    });

    it('clears search from empty state clear button', async () => {
      mockState.databases = mockDatabases;
      mockUseDatabases.mockReturnValue(mockDatabases);
      render(<Sidebar />);

      const searchInput = screen.getByTestId('search-input');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      await waitFor(() => {
        expect(screen.getByTestId('empty-state-clear-button')).toBeInTheDocument();
      }, { timeout: 300 });

      fireEvent.click(screen.getByTestId('empty-state-clear-button'));

      expect(searchInput).toHaveValue('');
    });

    it('debounces search input (150ms delay)', async () => {
      mockState.databases = mockDatabases;
      mockUseDatabases.mockReturnValue(mockDatabases);

      vi.useFakeTimers();

      try {
        render(<Sidebar />);

        const searchInput = screen.getByTestId('search-input');

        // Type quickly
        await act(async () => {
          fireEvent.change(searchInput, { target: { value: 't' } });
        });
        await act(async () => {
          fireEvent.change(searchInput, { target: { value: 'te' } });
        });
        await act(async () => {
          fireEvent.change(searchInput, { target: { value: 'tes' } });
        });
        await act(async () => {
          fireEvent.change(searchInput, { target: { value: 'test' } });
        });

        // Filter should not be applied yet (still shows all databases)
        expect(screen.getByTestId('db-tree-test-db')).toBeInTheDocument();
        expect(screen.getByTestId('db-tree-another-db')).toBeInTheDocument();

        // Advance timer past debounce
        await act(async () => {
          vi.advanceTimersByTime(200);
        });

        // Now filter should be applied
        expect(screen.getByTestId('db-tree-test-db')).toBeInTheDocument();
        expect(screen.queryByTestId('db-tree-another-db')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('requires minimum 2 characters to filter', async () => {
      mockState.databases = mockDatabases;
      mockUseDatabases.mockReturnValue(mockDatabases);

      vi.useFakeTimers();

      try {
        render(<Sidebar />);

        const searchInput = screen.getByTestId('search-input');

        // Type single character
        await act(async () => {
          fireEvent.change(searchInput, { target: { value: 't' } });
        });

        // Advance timer past debounce
        await act(async () => {
          vi.advanceTimersByTime(200);
        });

        // Should still show all databases (1 char doesn't filter)
        expect(screen.getByTestId('db-tree-test-db')).toBeInTheDocument();
        expect(screen.getByTestId('db-tree-another-db')).toBeInTheDocument();

        // Now type 2 chars
        await act(async () => {
          fireEvent.change(searchInput, { target: { value: 'te' } });
        });

        await act(async () => {
          vi.advanceTimersByTime(200);
        });

        // Now filter should be applied
        expect(screen.getByTestId('db-tree-test-db')).toBeInTheDocument();
        expect(screen.queryByTestId('db-tree-another-db')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('is case insensitive', async () => {
      mockState.databases = mockDatabases;
      mockUseDatabases.mockReturnValue(mockDatabases);

      vi.useFakeTimers();

      try {
        render(<Sidebar />);

        const searchInput = screen.getByTestId('search-input');
        await act(async () => {
          fireEvent.change(searchInput, { target: { value: 'TEST' } });
        });

        await act(async () => {
          vi.advanceTimersByTime(200);
        });

        expect(screen.getByTestId('db-tree-test-db')).toBeInTheDocument();
        expect(screen.queryByTestId('db-tree-another-db')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('auto-expands databases when searching', async () => {
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
       
      mockUseDatabaseStore.mockImplementation((selector: (state: typeof mockState) => unknown) => selector(mockState));

      vi.useFakeTimers();

      try {
        render(<Sidebar />);

        // Initially database is collapsed
        expect(screen.queryByTestId('db-contents-test-db')).not.toBeInTheDocument();

        const searchInput = screen.getByTestId('search-input');
        // Search for "test" which matches "test-db" database name
        await act(async () => {
          fireEvent.change(searchInput, { target: { value: 'test' } });
        });

        // Wait for debounce and auto-expand
        await act(async () => {
          vi.advanceTimersByTime(200);
        });

        // Database should be auto-expanded
        expect(screen.getByTestId('db-contents-test-db')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows empty search shows all items', () => {
      mockState.databases = mockDatabases;
      mockUseDatabases.mockReturnValue(mockDatabases);
      render(<Sidebar />);

      expect(screen.getByTestId('db-tree-test-db')).toBeInTheDocument();
      expect(screen.getByTestId('db-tree-another-db')).toBeInTheDocument();
    });
  });
});
