import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OpenDatabaseButton, type OpenDatabaseButtonProps } from '../OpenDatabaseButton';

// Type for window with optional showOpenFilePicker
type WindowWithFilePicker = Window & typeof globalThis & {
  showOpenFilePicker?: (options?: Record<string, unknown>) => Promise<{ getFile: () => Promise<File> }[]>;
};

describe('OpenDatabaseButton', () => {
  const defaultProps: OpenDatabaseButtonProps = {
    onFileSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders button with "Open Database" text', () => {
    render(<OpenDatabaseButton {...defaultProps} />);

    const button = screen.getByTestId('open-database-button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('Open Database');
  });

  it('renders with custom testId', () => {
    render(<OpenDatabaseButton {...defaultProps} testId="custom-test-id" />);

    expect(screen.getByTestId('custom-test-id')).toBeInTheDocument();
  });

  it('renders folder-open icon', () => {
    render(<OpenDatabaseButton {...defaultProps} />);

    const button = screen.getByTestId('open-database-button');
    const svg = button.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  describe('File picker (fallback)', () => {
    it('opens file picker when button is clicked', () => {
      render(<OpenDatabaseButton {...defaultProps} />);

      const fileInput = screen.getByTestId(
        'open-database-file-input'
      ) as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      fireEvent.click(screen.getByTestId('open-database-button'));

      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('calls onFileSelect when file is selected via input', () => {
      const onFileSelect = vi.fn();
      render(<OpenDatabaseButton onFileSelect={onFileSelect} />);

      const fileInput = screen.getByTestId('open-database-file-input');
      const file = new File(['test'], 'test.sqlite', {
        type: 'application/x-sqlite3',
      });

      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      });

      fireEvent.change(fileInput);

      expect(onFileSelect).toHaveBeenCalledWith(file);
    });

    it('only selects first file when multiple files provided', () => {
      const onFileSelect = vi.fn();
      render(<OpenDatabaseButton onFileSelect={onFileSelect} />);

      const fileInput = screen.getByTestId('open-database-file-input');
      const file1 = new File(['test1'], 'test1.sqlite', {
        type: 'application/x-sqlite3',
      });
      const file2 = new File(['test2'], 'test2.sqlite', {
        type: 'application/x-sqlite3',
      });

      Object.defineProperty(fileInput, 'files', {
        value: [file1, file2],
        configurable: true,
      });

      fireEvent.change(fileInput);

      expect(onFileSelect).toHaveBeenCalledWith(file1);
      expect(onFileSelect).toHaveBeenCalledTimes(1);
    });

    it('resets input value after selection for re-selection', () => {
      render(<OpenDatabaseButton {...defaultProps} />);

      const fileInput = screen.getByTestId(
        'open-database-file-input'
      ) as HTMLInputElement;
      const file = new File(['test'], 'test.sqlite', {
        type: 'application/x-sqlite3',
      });

      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      });
      // Note: We can't programmatically set the value, but the handler should clear it
      // Mock the value property to verify it gets set to ''
      let valueSetTo: string | undefined;
      Object.defineProperty(fileInput, 'value', {
        get: () => 'test.sqlite',
        set: (v: string) => { valueSetTo = v; },
        configurable: true,
      });

      fireEvent.change(fileInput);

      expect(valueSetTo).toBe('');
    });

    it('does not call onFileSelect when no files selected', () => {
      const onFileSelect = vi.fn();
      render(<OpenDatabaseButton onFileSelect={onFileSelect} />);

      const fileInput = screen.getByTestId('open-database-file-input');

      Object.defineProperty(fileInput, 'files', {
        value: [],
        configurable: true,
      });

      fireEvent.change(fileInput);

      expect(onFileSelect).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard shortcut (Cmd/Ctrl+O)', () => {
    it('triggers file picker with Cmd+O on Mac', () => {
      // Mock navigator.platform
      const originalPlatform = Object.getOwnPropertyDescriptor(
        navigator,
        'platform'
      );
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      render(<OpenDatabaseButton {...defaultProps} />);

      const fileInput = screen.getByTestId(
        'open-database-file-input'
      ) as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      fireEvent.keyDown(document, { key: 'o', metaKey: true });

      expect(clickSpy).toHaveBeenCalledTimes(1);

      // Restore
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    });

    it('triggers file picker with Ctrl+O on Windows/Linux', () => {
      // Mock navigator.platform
      const originalPlatform = Object.getOwnPropertyDescriptor(
        navigator,
        'platform'
      );
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });

      render(<OpenDatabaseButton {...defaultProps} />);

      const fileInput = screen.getByTestId(
        'open-database-file-input'
      ) as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      fireEvent.keyDown(document, { key: 'o', ctrlKey: true });

      expect(clickSpy).toHaveBeenCalledTimes(1);

      // Restore
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    });

    it('does not trigger when disabled', () => {
      render(<OpenDatabaseButton {...defaultProps} disabled />);

      const fileInput = screen.getByTestId(
        'open-database-file-input'
      ) as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      fireEvent.keyDown(document, { key: 'o', metaKey: true });

      expect(clickSpy).not.toHaveBeenCalled();
    });
  });

  describe('Prominent style', () => {
    it('shows keyboard shortcut when prominent', () => {
      // Mock Mac platform
      const originalPlatform = Object.getOwnPropertyDescriptor(
        navigator,
        'platform'
      );
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      render(<OpenDatabaseButton {...defaultProps} prominent />);

      expect(screen.getByTestId('open-database-button')).toHaveTextContent('⌘O');

      // Restore
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    });

    it('shows Ctrl+O on Windows when prominent', () => {
      // Mock Windows platform
      const originalPlatform = Object.getOwnPropertyDescriptor(
        navigator,
        'platform'
      );
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });

      render(<OpenDatabaseButton {...defaultProps} prominent />);

      expect(screen.getByTestId('open-database-button')).toHaveTextContent(
        'Ctrl+O'
      );

      // Restore
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    });

    it('does not show shortcut in non-prominent mode', () => {
      render(<OpenDatabaseButton {...defaultProps} prominent={false} />);

      const button = screen.getByTestId('open-database-button');
      expect(button).not.toHaveTextContent('⌘O');
      expect(button).not.toHaveTextContent('Ctrl+O');
    });
  });

  describe('Disabled state', () => {
    it('disables button when disabled prop is true', () => {
      render(<OpenDatabaseButton {...defaultProps} disabled />);

      const button = screen.getByTestId('open-database-button');
      expect(button).toBeDisabled();
    });

    it('does not open file picker when disabled and clicked', () => {
      render(<OpenDatabaseButton {...defaultProps} disabled />);

      const fileInput = screen.getByTestId(
        'open-database-file-input'
      ) as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      fireEvent.click(screen.getByTestId('open-database-button'));

      expect(clickSpy).not.toHaveBeenCalled();
    });

    it('applies opacity class when disabled', () => {
      render(<OpenDatabaseButton {...defaultProps} disabled />);

      const button = screen.getByTestId('open-database-button');
      expect(button).toHaveClass('opacity-50');
    });
  });

  describe('Accessibility', () => {
    it('has proper aria-label with keyboard shortcut', () => {
      // Mock Mac platform
      const originalPlatform = Object.getOwnPropertyDescriptor(
        navigator,
        'platform'
      );
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      render(<OpenDatabaseButton {...defaultProps} />);

      const button = screen.getByTestId('open-database-button');
      expect(button).toHaveAttribute('aria-label', 'Open Database (⌘O)');

      // Restore
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    });

    it('has tooltip via title attribute', () => {
      // Mock Windows platform
      const originalPlatform = Object.getOwnPropertyDescriptor(
        navigator,
        'platform'
      );
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });

      render(<OpenDatabaseButton {...defaultProps} />);

      const button = screen.getByTestId('open-database-button');
      expect(button).toHaveAttribute('title', 'Open Database (Ctrl+O)');

      // Restore
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    });

    it('file input is hidden from screen readers', () => {
      render(<OpenDatabaseButton {...defaultProps} />);

      const fileInput = screen.getByTestId('open-database-file-input');
      expect(fileInput).toHaveClass('hidden');
    });
  });

  describe('File type filtering', () => {
    it('file input accepts SQLite file types', () => {
      render(<OpenDatabaseButton {...defaultProps} />);

      const fileInput = screen.getByTestId(
        'open-database-file-input'
      ) as HTMLInputElement;
      expect(fileInput.accept).toContain('.sqlite');
      expect(fileInput.accept).toContain('.db');
      expect(fileInput.accept).toContain('.sqlite3');
    });
  });

  describe('File System Access API', () => {
    it('uses File System Access API when available', async () => {
      const onFileSelect = vi.fn();
      const mockFile = new File(['test'], 'test.sqlite', {
        type: 'application/x-sqlite3',
      });
      const mockFileHandle = {
        getFile: vi.fn().mockResolvedValue(mockFile),
      };

      // Mock showOpenFilePicker
      const mockShowOpenFilePicker = vi
        .fn()
        .mockResolvedValue([mockFileHandle]);
      (window as WindowWithFilePicker).showOpenFilePicker = mockShowOpenFilePicker;

      render(<OpenDatabaseButton onFileSelect={onFileSelect} />);

      fireEvent.click(screen.getByTestId('open-database-button'));

      await waitFor(() => {
        expect(mockShowOpenFilePicker).toHaveBeenCalled();
        expect(onFileSelect).toHaveBeenCalledWith(mockFile);
      });

      // Cleanup
      delete (window as WindowWithFilePicker).showOpenFilePicker;
    });

    it('does not call onFileSelect when user cancels File System Access dialog', async () => {
      const onFileSelect = vi.fn();

      // Mock showOpenFilePicker to throw AbortError (user cancelled)
      const abortError = new DOMException('User cancelled', 'AbortError');
      const mockShowOpenFilePicker = vi.fn().mockRejectedValue(abortError);
      (window as WindowWithFilePicker).showOpenFilePicker = mockShowOpenFilePicker;

      render(<OpenDatabaseButton onFileSelect={onFileSelect} />);

      fireEvent.click(screen.getByTestId('open-database-button'));

      // Wait for the async handleClick to complete
      await waitFor(() => {
        expect(mockShowOpenFilePicker).toHaveBeenCalled();
      });

      // Flush all microtasks
      await new Promise(resolve => setTimeout(resolve, 50));

      // On abort, no file should be selected
      expect(onFileSelect).not.toHaveBeenCalled();

      // Cleanup
      delete (window as WindowWithFilePicker).showOpenFilePicker;
    });

    it('falls back to file input when File System Access API throws non-abort error', async () => {
      const onFileSelect = vi.fn();

      // Mock showOpenFilePicker to throw a generic error (not AbortError)
      const genericError = new Error('Something went wrong');
      const mockShowOpenFilePicker = vi.fn().mockRejectedValue(genericError);
      (window as WindowWithFilePicker).showOpenFilePicker = mockShowOpenFilePicker;

      render(<OpenDatabaseButton onFileSelect={onFileSelect} />);

      const fileInput = screen.getByTestId(
        'open-database-file-input'
      ) as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      fireEvent.click(screen.getByTestId('open-database-button'));

      // Wait for the async handleClick to complete and fall back
      await waitFor(() => {
        expect(mockShowOpenFilePicker).toHaveBeenCalled();
      });

      // Give time for the async flow to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should fall back to input on non-abort error
      expect(clickSpy).toHaveBeenCalledTimes(1);

      // Cleanup
      delete (window as WindowWithFilePicker).showOpenFilePicker;
    });
  });
});
