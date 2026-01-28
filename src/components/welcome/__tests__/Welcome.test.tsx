import { render, screen, fireEvent } from '@testing-library/react';
import { Welcome, type WelcomeProps } from '../Welcome';
import type { DatabaseEntry } from '../../../types';

// Mock the store
vi.mock('../../../store', async () => {
  const actual = await vi.importActual('../../../store');
  return {
    ...actual,
    useDatabases: vi.fn(),
  };
});

import { useDatabases } from '../../../store';
const mockUseDatabases = vi.mocked(useDatabases);

const mockDatabases: DatabaseEntry[] = [
  {
    name: 'test-db',
    file: 'test-db.sqlite',
    createdAt: '2024-01-01T00:00:00Z',
    lastOpenedAt: '2024-01-15T00:00:00Z',
    fkEnforced: true,
  },
  {
    name: 'chinook',
    file: 'chinook.sqlite',
    createdAt: '2024-01-02T00:00:00Z',
    lastOpenedAt: '2024-01-14T00:00:00Z',
    fkEnforced: false,
  },
];

describe('Welcome', () => {
  const defaultProps: WelcomeProps = {
    onNewDatabase: vi.fn(),
    onImportFiles: vi.fn(),
    onSelectDatabase: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabases.mockReturnValue([]);
  });

  it('renders welcome screen when no database is selected', () => {
    render(<Welcome {...defaultProps} />);

    expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
    expect(screen.getByText('Welcome to SQLite Editor')).toBeInTheDocument();
    expect(
      screen.getByText('Create a new database or import an existing file')
    ).toBeInTheDocument();
  });

  it('renders New Database button', () => {
    render(<Welcome {...defaultProps} />);

    const button = screen.getByTestId('new-database-button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('New Database');
  });

  it('renders Import Database button', () => {
    render(<Welcome {...defaultProps} />);

    const button = screen.getByTestId('import-database-button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('Import Database');
  });

  it('renders drop zone', () => {
    render(<Welcome {...defaultProps} />);

    const dropZone = screen.getByTestId('drop-zone');
    expect(dropZone).toBeInTheDocument();
    expect(screen.getByText('Drop a .sqlite file here')).toBeInTheDocument();
  });

  describe('New Database action', () => {
    it('calls onNewDatabase when button is clicked', () => {
      const onNewDatabase = vi.fn();
      render(<Welcome {...defaultProps} onNewDatabase={onNewDatabase} />);

      fireEvent.click(screen.getByTestId('new-database-button'));

      expect(onNewDatabase).toHaveBeenCalledTimes(1);
    });

    it('triggers onNewDatabase with Cmd+N on Mac', () => {
      // Mock navigator.platform
      const originalPlatform = Object.getOwnPropertyDescriptor(
        navigator,
        'platform'
      );
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      const onNewDatabase = vi.fn();
      render(<Welcome {...defaultProps} onNewDatabase={onNewDatabase} />);

      fireEvent.keyDown(document, { key: 'n', metaKey: true });

      expect(onNewDatabase).toHaveBeenCalledTimes(1);

      // Restore
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    });

    it('triggers onNewDatabase with Ctrl+N on Windows/Linux', () => {
      // Mock navigator.platform
      const originalPlatform = Object.getOwnPropertyDescriptor(
        navigator,
        'platform'
      );
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });

      const onNewDatabase = vi.fn();
      render(<Welcome {...defaultProps} onNewDatabase={onNewDatabase} />);

      fireEvent.keyDown(document, { key: 'n', ctrlKey: true });

      expect(onNewDatabase).toHaveBeenCalledTimes(1);

      // Restore
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    });
  });

  describe('Import Database action', () => {
    it('opens file picker when Import button is clicked', () => {
      render(<Welcome {...defaultProps} />);

      const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      fireEvent.click(screen.getByTestId('import-database-button'));

      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('calls onImportFiles when valid file is selected', () => {
      const onImportFiles = vi.fn();
      render(<Welcome {...defaultProps} onImportFiles={onImportFiles} />);

      const fileInput = screen.getByTestId('file-input');
      const file = new File(['test'], 'test.sqlite', {
        type: 'application/x-sqlite3',
      });

      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      });

      fireEvent.change(fileInput);

      expect(onImportFiles).toHaveBeenCalledWith([file]);
    });

    it('filters out invalid file types from file picker', () => {
      const onImportFiles = vi.fn();
      render(<Welcome {...defaultProps} onImportFiles={onImportFiles} />);

      const fileInput = screen.getByTestId('file-input');
      const validFile = new File(['test'], 'test.sqlite', {
        type: 'application/x-sqlite3',
      });
      const invalidFile = new File(['test'], 'test.txt', { type: 'text/plain' });

      Object.defineProperty(fileInput, 'files', {
        value: [validFile, invalidFile],
        configurable: true,
      });

      fireEvent.change(fileInput);

      expect(onImportFiles).toHaveBeenCalledWith([validFile]);
    });
  });

  describe('Drop zone', () => {
    it('shows drag-over state when file is dragged over', () => {
      render(<Welcome {...defaultProps} />);

      const dropZone = screen.getByTestId('drop-zone');

      fireEvent.dragEnter(dropZone, {
        dataTransfer: { types: ['Files'], files: [] },
      });

      expect(dropZone).toHaveClass('border-navy-600');
      expect(dropZone).toHaveClass('bg-navy-50');
      expect(screen.getByText('Drop to import')).toBeInTheDocument();
    });

    it('resets drag-over state when drag leaves', () => {
      render(<Welcome {...defaultProps} />);

      const dropZone = screen.getByTestId('drop-zone');

      fireEvent.dragEnter(dropZone, {
        dataTransfer: { types: ['Files'], files: [] },
      });
      fireEvent.dragLeave(dropZone, {
        dataTransfer: { types: ['Files'], files: [] },
      });

      expect(dropZone).not.toHaveClass('border-navy-600');
      expect(screen.getByText('Drop a .sqlite file here')).toBeInTheDocument();
    });

    it('accepts valid file types on drop', () => {
      const onImportFiles = vi.fn();
      render(<Welcome {...defaultProps} onImportFiles={onImportFiles} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = new File(['test'], 'test.sqlite', {
        type: 'application/x-sqlite3',
      });

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
          types: ['Files'],
        },
      });

      expect(onImportFiles).toHaveBeenCalledWith([file]);
    });

    it('accepts .db files', () => {
      const onImportFiles = vi.fn();
      render(<Welcome {...defaultProps} onImportFiles={onImportFiles} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = new File(['test'], 'test.db', { type: '' });

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
          types: ['Files'],
        },
      });

      expect(onImportFiles).toHaveBeenCalledWith([file]);
    });

    it('accepts .sqlite3 files', () => {
      const onImportFiles = vi.fn();
      render(<Welcome {...defaultProps} onImportFiles={onImportFiles} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = new File(['test'], 'test.sqlite3', { type: '' });

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
          types: ['Files'],
        },
      });

      expect(onImportFiles).toHaveBeenCalledWith([file]);
    });

    it('accepts .csv files', () => {
      const onImportFiles = vi.fn();
      render(<Welcome {...defaultProps} onImportFiles={onImportFiles} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = new File(['a,b,c'], 'data.csv', { type: 'text/csv' });

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
          types: ['Files'],
        },
      });

      expect(onImportFiles).toHaveBeenCalledWith([file]);
    });

    it('accepts .json files', () => {
      const onImportFiles = vi.fn();
      render(<Welcome {...defaultProps} onImportFiles={onImportFiles} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = new File(['{}'], 'data.json', { type: 'application/json' });

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
          types: ['Files'],
        },
      });

      expect(onImportFiles).toHaveBeenCalledWith([file]);
    });

    it('rejects invalid file types on drop', () => {
      const onImportFiles = vi.fn();
      render(<Welcome {...defaultProps} onImportFiles={onImportFiles} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = new File(['test'], 'test.txt', { type: 'text/plain' });

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
          types: ['Files'],
        },
      });

      expect(onImportFiles).not.toHaveBeenCalled();
    });

    it('filters mixed valid and invalid files on drop', () => {
      const onImportFiles = vi.fn();
      render(<Welcome {...defaultProps} onImportFiles={onImportFiles} />);

      const dropZone = screen.getByTestId('drop-zone');
      const validFile = new File(['test'], 'test.sqlite', {
        type: 'application/x-sqlite3',
      });
      const invalidFile = new File(['test'], 'test.exe', {
        type: 'application/x-msdownload',
      });

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [validFile, invalidFile],
          types: ['Files'],
        },
      });

      expect(onImportFiles).toHaveBeenCalledWith([validFile]);
    });
  });

  describe('Recent databases', () => {
    it('shows recent databases when available', () => {
      mockUseDatabases.mockReturnValue(mockDatabases);
      render(<Welcome {...defaultProps} />);

      expect(screen.getByTestId('recent-databases')).toBeInTheDocument();
      expect(screen.getByText('Recent databases')).toBeInTheDocument();
      expect(screen.getByText('test-db')).toBeInTheDocument();
      expect(screen.getByText('chinook')).toBeInTheDocument();
    });

    it('hides recent databases when none exist', () => {
      mockUseDatabases.mockReturnValue([]);
      render(<Welcome {...defaultProps} />);

      expect(screen.queryByTestId('recent-databases')).not.toBeInTheDocument();
    });

    it('hides recent databases when showRecentDatabases is false', () => {
      mockUseDatabases.mockReturnValue(mockDatabases);
      render(<Welcome {...defaultProps} showRecentDatabases={false} />);

      expect(screen.queryByTestId('recent-databases')).not.toBeInTheDocument();
    });

    it('calls onSelectDatabase when recent database is clicked', () => {
      const onSelectDatabase = vi.fn();
      mockUseDatabases.mockReturnValue(mockDatabases);
      render(
        <Welcome {...defaultProps} onSelectDatabase={onSelectDatabase} />
      );

      fireEvent.click(screen.getByTestId('recent-db-test-db'));

      expect(onSelectDatabase).toHaveBeenCalledWith('test-db');
    });

    it('limits recent databases to 5', () => {
      const manyDatabases: DatabaseEntry[] = Array.from(
        { length: 10 },
        (_, i) => ({
          name: `db-${i}`,
          file: `db-${i}.sqlite`,
          createdAt: '2024-01-01T00:00:00Z',
          lastOpenedAt: '2024-01-15T00:00:00Z',
          fkEnforced: true,
        })
      );
      mockUseDatabases.mockReturnValue(manyDatabases);
      render(<Welcome {...defaultProps} />);

      const recentSection = screen.getByTestId('recent-databases');
      const buttons = recentSection.querySelectorAll('button');
      expect(buttons.length).toBe(5);
    });
  });

  describe('Keyboard navigation', () => {
    it('buttons are focusable with Tab', () => {
      render(<Welcome {...defaultProps} />);

      const newDbButton = screen.getByTestId('new-database-button');
      const importButton = screen.getByTestId('import-database-button');

      newDbButton.focus();
      expect(document.activeElement).toBe(newDbButton);

      fireEvent.keyDown(newDbButton, { key: 'Tab' });
      importButton.focus();
      expect(document.activeElement).toBe(importButton);
    });

    it('Enter key activates New Database button', () => {
      const onNewDatabase = vi.fn();
      render(<Welcome {...defaultProps} onNewDatabase={onNewDatabase} />);

      const button = screen.getByTestId('new-database-button');
      button.focus();
      fireEvent.keyDown(button, { key: 'Enter' });
      fireEvent.click(button); // Simulate native button behavior

      expect(onNewDatabase).toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('drop zone has proper aria attributes', () => {
      render(<Welcome {...defaultProps} />);

      const dropZone = screen.getByTestId('drop-zone');
      expect(dropZone).toHaveAttribute('role', 'region');
      expect(dropZone).toHaveAttribute('aria-label', 'File drop zone');
    });

    it('displays keyboard shortcut hint', () => {
      // Mock Mac platform
      const originalPlatform = Object.getOwnPropertyDescriptor(
        navigator,
        'platform'
      );
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      const { unmount } = render(<Welcome {...defaultProps} />);

      expect(screen.getByTestId('new-database-button')).toHaveTextContent('⌘N');

      unmount();

      // Test Windows
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });

      render(<Welcome {...defaultProps} />);

      expect(screen.getByTestId('new-database-button')).toHaveTextContent(
        'Ctrl+N'
      );

      // Restore
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    });
  });
});
