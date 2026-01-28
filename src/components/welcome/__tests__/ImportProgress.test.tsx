import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportProgress, type ImportProgressProps, type ImportProgressState } from '../ImportProgress';

/**
 * Helper to create a mock File
 */
function createMockFile(name: string, size: number): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type: 'application/x-sqlite3' });
}

describe('ImportProgress', () => {
  const defaultProps: ImportProgressProps = {
    file: createMockFile('test.sqlite', 1024),
    progress: null,
    isImporting: false,
    onConfirmImport: vi.fn(),
    onCancel: vi.fn(),
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('No File State', () => {
    it('renders nothing when no file is provided', () => {
      render(<ImportProgress {...defaultProps} file={null} />);

      expect(screen.queryByTestId('import-confirmation-overlay')).not.toBeInTheDocument();
      expect(screen.queryByTestId('import-progress-overlay')).not.toBeInTheDocument();
    });
  });

  describe('Small File Auto-Import', () => {
    it('auto-confirms import for small files without warnings', () => {
      const onConfirmImport = vi.fn();
      const smallFile = createMockFile('small.sqlite', 1024);

      render(
        <ImportProgress
          {...defaultProps}
          file={smallFile}
          onConfirmImport={onConfirmImport}
        />
      );

      expect(onConfirmImport).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('import-confirmation-dialog')).not.toBeInTheDocument();
    });
  });

  describe('Large File Warning', () => {
    it('shows size warning for files >100MB', () => {
      const largeFile = createMockFile('large.sqlite', 150 * 1024 * 1024);

      render(
        <ImportProgress
          {...defaultProps}
          file={largeFile}
        />
      );

      expect(screen.getByTestId('import-confirmation-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('size-warning')).toHaveTextContent('This file is very large');
      expect(screen.getByTestId('size-warning')).toHaveTextContent('150.0 MB');
    });

    it('shows confirm and cancel buttons for large files', () => {
      const largeFile = createMockFile('large.sqlite', 150 * 1024 * 1024);

      render(
        <ImportProgress
          {...defaultProps}
          file={largeFile}
        />
      );

      expect(screen.getByTestId('import-confirm-button')).toBeInTheDocument();
      expect(screen.getByTestId('import-cancel-button')).toBeInTheDocument();
    });

    it('calls onConfirmImport when Continue Anyway is clicked', () => {
      const onConfirmImport = vi.fn();
      const largeFile = createMockFile('large.sqlite', 150 * 1024 * 1024);

      render(
        <ImportProgress
          {...defaultProps}
          file={largeFile}
          onConfirmImport={onConfirmImport}
        />
      );

      fireEvent.click(screen.getByTestId('import-confirm-button'));

      expect(onConfirmImport).toHaveBeenCalledTimes(1);
    });

    it('calls onDismiss when Cancel is clicked', () => {
      const onDismiss = vi.fn();
      const largeFile = createMockFile('large.sqlite', 150 * 1024 * 1024);

      render(
        <ImportProgress
          {...defaultProps}
          file={largeFile}
          onDismiss={onDismiss}
        />
      );

      fireEvent.click(screen.getByTestId('import-cancel-button'));

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('Quota Warning', () => {
    it('shows quota warning when storage is low', () => {
      const file = createMockFile('test.sqlite', 10 * 1024 * 1024);
      const storageEstimate = {
        quota: 100 * 1024 * 1024,
        usage: 95 * 1024 * 1024, // Only 5MB available, need 15MB (10MB * 1.5)
      };

      render(
        <ImportProgress
          {...defaultProps}
          file={file}
          storageEstimate={storageEstimate}
        />
      );

      expect(screen.getByTestId('import-confirmation-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('quota-warning')).toHaveTextContent('Storage space is low');
    });

    it('shows available storage in quota warning', () => {
      const file = createMockFile('test.sqlite', 10 * 1024 * 1024);
      const storageEstimate = {
        quota: 100 * 1024 * 1024,
        usage: 95 * 1024 * 1024,
      };

      render(
        <ImportProgress
          {...defaultProps}
          file={file}
          storageEstimate={storageEstimate}
        />
      );

      expect(screen.getByTestId('quota-warning')).toHaveTextContent('Available: 5.0 MB');
    });
  });

  describe('Combined Warnings', () => {
    it('shows both size and quota warnings when applicable', () => {
      const largeFile = createMockFile('large.sqlite', 150 * 1024 * 1024);
      const storageEstimate = {
        quota: 200 * 1024 * 1024,
        usage: 100 * 1024 * 1024, // 100MB available, need 225MB (150MB * 1.5)
      };

      render(
        <ImportProgress
          {...defaultProps}
          file={largeFile}
          storageEstimate={storageEstimate}
        />
      );

      expect(screen.getByTestId('size-warning')).toBeInTheDocument();
      expect(screen.getByTestId('quota-warning')).toBeInTheDocument();
    });
  });

  describe('Progress Display', () => {
    it('shows progress bar during import', () => {
      const progress: ImportProgressState = {
        bytesRead: 512 * 1024,
        totalBytes: 1024 * 1024,
        isImporting: true,
      };

      render(
        <ImportProgress
          {...defaultProps}
          isImporting={true}
          progress={progress}
        />
      );

      expect(screen.getByTestId('import-progress-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('progress-bar')).toBeInTheDocument();
    });

    it('shows file name during import', () => {
      const file = createMockFile('my-database.sqlite', 1024 * 1024);
      const progress: ImportProgressState = {
        bytesRead: 512 * 1024,
        totalBytes: 1024 * 1024,
        isImporting: true,
      };

      render(
        <ImportProgress
          {...defaultProps}
          file={file}
          isImporting={true}
          progress={progress}
        />
      );

      expect(screen.getByText('my-database.sqlite')).toBeInTheDocument();
    });

    it('shows "Importing large file..." for files >100MB', () => {
      const largeFile = createMockFile('large.sqlite', 150 * 1024 * 1024);
      const progress: ImportProgressState = {
        bytesRead: 75 * 1024 * 1024,
        totalBytes: 150 * 1024 * 1024,
        isImporting: true,
      };

      render(
        <ImportProgress
          {...defaultProps}
          file={largeFile}
          isImporting={true}
          progress={progress}
        />
      );

      // For large files, confirmation dialog is shown first
      // Click "Continue Anyway" to proceed to progress view
      fireEvent.click(screen.getByTestId('import-confirm-button'));

      expect(screen.getByText('Importing large file...')).toBeInTheDocument();
    });

    it('shows cancel button in progress view', () => {
      const progress: ImportProgressState = {
        bytesRead: 512 * 1024,
        totalBytes: 1024 * 1024,
        isImporting: true,
      };

      render(
        <ImportProgress
          {...defaultProps}
          isImporting={true}
          progress={progress}
        />
      );

      expect(screen.getByTestId('progress-cancel-button')).toBeInTheDocument();
    });

    it('calls onCancel when cancel is clicked during import', () => {
      const onCancel = vi.fn();
      const progress: ImportProgressState = {
        bytesRead: 512 * 1024,
        totalBytes: 1024 * 1024,
        isImporting: true,
      };

      render(
        <ImportProgress
          {...defaultProps}
          isImporting={true}
          progress={progress}
          onCancel={onCancel}
        />
      );

      fireEvent.click(screen.getByTestId('progress-cancel-button'));

      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('Progress Updates', () => {
    it('updates progress display correctly', async () => {
      const progress: ImportProgressState = {
        bytesRead: 500 * 1024,
        totalBytes: 1000 * 1024,
        isImporting: true,
      };

      render(
        <ImportProgress
          {...defaultProps}
          isImporting={true}
          progress={progress}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('progress-percent')).toHaveTextContent('50%');
      });
    });

    it('shows bytes processed', async () => {
      const progress: ImportProgressState = {
        bytesRead: 5 * 1024 * 1024,
        totalBytes: 10 * 1024 * 1024,
        isImporting: true,
      };

      render(
        <ImportProgress
          {...defaultProps}
          isImporting={true}
          progress={progress}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('progress-bytes')).toHaveTextContent('5.0 MB / 10.0 MB');
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper dialog role for confirmation', () => {
      const largeFile = createMockFile('large.sqlite', 150 * 1024 * 1024);

      render(
        <ImportProgress
          {...defaultProps}
          file={largeFile}
        />
      );

      const dialog = screen.getByTestId('import-confirmation-dialog');
      expect(dialog).toHaveAttribute('role', 'alertdialog');
    });

    it('has proper aria labels for confirmation dialog', () => {
      const largeFile = createMockFile('large.sqlite', 150 * 1024 * 1024);

      render(
        <ImportProgress
          {...defaultProps}
          file={largeFile}
        />
      );

      const dialog = screen.getByTestId('import-confirmation-dialog');
      expect(dialog).toHaveAttribute('aria-labelledby', 'import-warning-title');
      expect(dialog).toHaveAttribute('aria-describedby', 'import-warning-description');
    });
  });
});
