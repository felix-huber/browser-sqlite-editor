import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  SettingsPanel,
  useSettingsShortcut,
  loadGlobalSettings,
  saveGlobalSettings,
  formatBytes,
  applyTheme,
  type GlobalSettings,
  type SettingsPanelProps,
} from '../SettingsPanel';
import * as storeModule from '../../../store';
import * as workerClientModule from '../../../lib/worker-client';

// Mock the store
vi.mock('../../../store', () => ({
  useDatabaseStore: vi.fn((selector) => {
    const state = {
      databases: [{ name: 'testdb', file: 'testdb.sqlite', createdAt: '', lastOpenedAt: '', fkEnforced: false }],
    };
    return selector(state);
  }),
  useStorageMode: vi.fn(() => 'opfs'),
  useActiveDb: vi.fn(() => null),
}));

// Mock the worker client
vi.mock('../../../lib/worker-client', () => ({
  getWorkerClient: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [[1]], columns: ['foreign_keys'] }),
    exec: vi.fn().mockResolvedValue({}),
    deleteDb: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock navigator.storage
const storageMock = {
  estimate: vi.fn().mockResolvedValue({
    usage: 50 * 1024 * 1024, // 50 MB used
    quota: 1024 * 1024 * 1024, // 1 GB quota
  }),
};
Object.defineProperty(navigator, 'storage', { value: storageMock, writable: true });

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
});

describe('loadGlobalSettings', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('returns default settings when localStorage is empty', () => {
    const settings = loadGlobalSettings();
    expect(settings).toEqual({
      theme: 'system',
      defaultPageSize: 100,
      autoSave: true,
    });
  });

  it('loads stored settings', () => {
    const stored: GlobalSettings = {
      theme: 'dark',
      defaultPageSize: 50,
      autoSave: false,
    };
    localStorageMock.getItem.mockReturnValue(JSON.stringify(stored));

    const settings = loadGlobalSettings();
    expect(settings).toEqual(stored);
  });

  it('handles corrupted JSON gracefully', () => {
    localStorageMock.getItem.mockReturnValue('invalid json');

    const settings = loadGlobalSettings();
    expect(settings).toEqual({
      theme: 'system',
      defaultPageSize: 100,
      autoSave: true,
    });
  });

  it('merges partial stored settings with defaults', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify({ theme: 'dark' }));

    const settings = loadGlobalSettings();
    expect(settings).toEqual({
      theme: 'dark',
      defaultPageSize: 100,
      autoSave: true,
    });
  });
});

describe('saveGlobalSettings', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('saves settings to localStorage', () => {
    const settings: GlobalSettings = {
      theme: 'dark',
      defaultPageSize: 50,
      autoSave: false,
    };
    saveGlobalSettings(settings);

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'sqlite-editor-settings',
      JSON.stringify(settings)
    );
  });
});

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('applies light theme', () => {
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('applies dark theme', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies system theme based on prefers-color-scheme', () => {
    // Mock matchMedia for dark preference
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('SettingsPanel', () => {
  const defaultProps: SettingsPanelProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    vi.mocked(storeModule.useActiveDb).mockReturnValue(null);
  });

  describe('Rendering', () => {
    it('renders panel when open', () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByTestId('settings-panel')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      render(<SettingsPanel {...defaultProps} isOpen={false} />);

      expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument();
    });

    it('has proper accessibility attributes', () => {
      render(<SettingsPanel {...defaultProps} />);

      const backdrop = screen.getByTestId('settings-panel-backdrop');
      expect(backdrop).toHaveAttribute('role', 'dialog');
      expect(backdrop).toHaveAttribute('aria-modal', 'true');
      expect(backdrop).toHaveAttribute('aria-labelledby', 'settings-panel-title');
    });
  });

  describe('Storage Section', () => {
    it('displays storage mode', async () => {
      render(<SettingsPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('storage-mode')).toHaveTextContent('OPFS');
      });
    });

    it('displays storage usage', async () => {
      render(<SettingsPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('storage-usage')).toHaveTextContent('50.0 MB');
        expect(screen.getByTestId('storage-usage')).toHaveTextContent('1.0 GB');
      });
    });

    it('shows clear data button', () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByTestId('clear-data-button')).toBeInTheDocument();
    });

    it('shows confirmation when clear data is clicked', () => {
      render(<SettingsPanel {...defaultProps} />);

      fireEvent.click(screen.getByTestId('clear-data-button'));

      expect(screen.getByTestId('confirm-clear-button')).toBeInTheDocument();
      expect(screen.getByTestId('cancel-clear-button')).toBeInTheDocument();
      expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    });

    it('cancels clear confirmation', () => {
      render(<SettingsPanel {...defaultProps} />);

      fireEvent.click(screen.getByTestId('clear-data-button'));
      fireEvent.click(screen.getByTestId('cancel-clear-button'));

      expect(screen.queryByTestId('confirm-clear-button')).not.toBeInTheDocument();
      expect(screen.getByTestId('clear-data-button')).toBeInTheDocument();
    });
  });

  describe('Database Section', () => {
    beforeEach(() => {
      vi.mocked(storeModule.useActiveDb).mockReturnValue({
        name: 'testdb',
        file: 'testdb.sqlite',
        createdAt: '2024-01-01T00:00:00Z',
        lastOpenedAt: '2024-01-01T00:00:00Z',
        fkEnforced: false,
      });
    });

    it('shows database section when a database is active', async () => {
      render(<SettingsPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('database-section')).toBeInTheDocument();
      });
      expect(screen.getByText(/Database: testdb/i)).toBeInTheDocument();
    });

    it('shows FK toggle', async () => {
      render(<SettingsPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('fk-toggle')).toBeInTheDocument();
      });
    });

    it('FK toggle changes PRAGMA', async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [[1]], columns: ['foreign_keys'] })
          .mockResolvedValueOnce({ rows: [['wal']], columns: ['journal_mode'] })
          .mockResolvedValueOnce({ rows: [[0]], columns: ['foreign_keys'] }),
        exec: vi.fn().mockResolvedValue({}),
        deleteDb: vi.fn(),
      };
      vi.mocked(workerClientModule.getWorkerClient).mockReturnValue(mockClient as any);

      render(<SettingsPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('fk-toggle')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('fk-toggle'));

      await waitFor(() => {
        expect(mockClient.exec).toHaveBeenCalledWith('PRAGMA foreign_keys = 0');
      });
    });

    it('shows journal mode', async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [[1]], columns: ['foreign_keys'] })
          .mockResolvedValueOnce({ rows: [['wal']], columns: ['journal_mode'] }),
        exec: vi.fn(),
        deleteDb: vi.fn(),
      };
      vi.mocked(workerClientModule.getWorkerClient).mockReturnValue(mockClient as any);

      render(<SettingsPanel {...defaultProps} />);

      await waitFor(() => {
        // Journal mode is displayed uppercase
        expect(screen.getByTestId('journal-mode')).toHaveTextContent(/wal/i);
      });
    });

    it('hides database section when no database is active', () => {
      vi.mocked(storeModule.useActiveDb).mockReturnValue(null);

      render(<SettingsPanel {...defaultProps} />);

      expect(screen.queryByTestId('database-section')).not.toBeInTheDocument();
    });
  });

  describe('UI Preferences Section', () => {
    it('shows theme selector', () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByTestId('theme-select')).toBeInTheDocument();
    });

    it('theme selection updates UI', async () => {
      render(<SettingsPanel {...defaultProps} />);

      const themeSelect = screen.getByTestId('theme-select');
      fireEvent.change(themeSelect, { target: { value: 'dark' } });

      await waitFor(() => {
        expect(localStorageMock.setItem).toHaveBeenCalled();
      });
    });

    it('shows page size selector', () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByTestId('page-size-select')).toBeInTheDocument();
    });

    it('shows auto-save toggle', () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByTestId('autosave-toggle')).toBeInTheDocument();
    });

    it('auto-save toggle persists setting', async () => {
      render(<SettingsPanel {...defaultProps} />);

      fireEvent.click(screen.getByTestId('autosave-toggle'));

      await waitFor(() => {
        expect(localStorageMock.setItem).toHaveBeenCalled();
      });
    });
  });

  describe('Close Actions', () => {
    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(<SettingsPanel isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByTestId('settings-close-button'));

      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when Done button is clicked', () => {
      const onClose = vi.fn();
      render(<SettingsPanel isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByTestId('settings-done-button'));

      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn();
      render(<SettingsPanel isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByTestId('settings-panel-backdrop'));

      expect(onClose).toHaveBeenCalled();
    });

    it('does not call onClose when panel content is clicked', () => {
      const onClose = vi.fn();
      render(<SettingsPanel isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByTestId('settings-panel'));

      expect(onClose).not.toHaveBeenCalled();
    });

    it('closes on Escape key', () => {
      const onClose = vi.fn();
      render(<SettingsPanel isOpen={true} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalled();
    });
  });
});

describe('useSettingsShortcut', () => {
  function TestComponent({ onOpen }: { onOpen: () => void }) {
    useSettingsShortcut(onOpen);
    return <div data-testid="test">Test</div>;
  }

  it('opens settings on Cmd+, (Mac)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      writable: true,
    });

    const onOpen = vi.fn();
    render(<TestComponent onOpen={onOpen} />);

    fireEvent.keyDown(document, { key: ',', metaKey: true });

    expect(onOpen).toHaveBeenCalled();
  });

  it('opens settings on Ctrl+, (Windows/Linux)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      writable: true,
    });

    const onOpen = vi.fn();
    render(<TestComponent onOpen={onOpen} />);

    fireEvent.keyDown(document, { key: ',', ctrlKey: true });

    expect(onOpen).toHaveBeenCalled();
  });

  it('does not open without modifier key', () => {
    const onOpen = vi.fn();
    render(<TestComponent onOpen={onOpen} />);

    fireEvent.keyDown(document, { key: ',' });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not open on wrong key with modifier', () => {
    const onOpen = vi.fn();
    render(<TestComponent onOpen={onOpen} />);

    fireEvent.keyDown(document, { key: 'k', metaKey: true });

    expect(onOpen).not.toHaveBeenCalled();
  });
});
