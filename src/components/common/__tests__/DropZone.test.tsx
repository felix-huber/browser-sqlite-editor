import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DropZone, type DropZoneProps } from '../DropZone';

/**
 * Helper to create a File with specific contents
 */
function createFile(
  name: string,
  content: string | ArrayBuffer,
  type: string = ''
): File {
  const blob = new Blob([content], { type });
  return new File([blob], name, { type });
}

/**
 * Create a valid SQLite file with magic header
 */
function createSqliteFile(name: string = 'test.sqlite'): File {
  // SQLite magic header: "SQLite format 3\0"
  const header = new Uint8Array([
    0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33,
    0x00,
  ]);
  // Add some dummy content after header
  const content = new Uint8Array(100);
  content.set(header, 0);
  return createFile(name, content.buffer as ArrayBuffer, 'application/x-sqlite3');
}

/**
 * Helper to create a mock drag event
 */
function createDragEvent(files: File[]): Partial<React.DragEvent> {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      files: files as unknown as FileList,
      types: files.length > 0 ? ['Files'] : [],
      dropEffect: 'none',
      effectAllowed: 'all',
      items: {} as DataTransferItemList,
      clearData: vi.fn(),
      getData: vi.fn(),
      setData: vi.fn(),
      setDragImage: vi.fn(),
    } as unknown as DataTransfer,
  };
}

describe('DropZone', () => {
  const defaultProps: DropZoneProps = {
    onSqliteFile: vi.fn(),
    onCsvFile: vi.fn(),
    onJsonFile: vi.fn(),
    onError: vi.fn(),
    onWarning: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders drop zone with default content', () => {
      render(<DropZone {...defaultProps} />);

      const dropZone = screen.getByTestId('drop-zone');
      expect(dropZone).toBeInTheDocument();
      expect(screen.getByText('Drop a .sqlite file here')).toBeInTheDocument();
      expect(screen.getByText('Supports .sqlite, .db, .sqlite3, .csv, .json')).toBeInTheDocument();
    });

    it('renders with custom children', () => {
      render(
        <DropZone {...defaultProps}>
          <p data-testid="custom-content">Custom drop zone content</p>
        </DropZone>
      );

      expect(screen.getByTestId('custom-content')).toBeInTheDocument();
    });

    it('has proper accessibility attributes', () => {
      render(<DropZone {...defaultProps} />);

      const dropZone = screen.getByTestId('drop-zone');
      expect(dropZone).toHaveAttribute('role', 'region');
      expect(dropZone).toHaveAttribute('aria-label', 'File drop zone');
    });

    it('applies disabled state', () => {
      render(<DropZone {...defaultProps} disabled />);

      const dropZone = screen.getByTestId('drop-zone');
      expect(dropZone).toHaveAttribute('aria-disabled', 'true');
      expect(dropZone).toHaveClass('opacity-50');
    });

    it('applies custom className', () => {
      render(<DropZone {...defaultProps} className="custom-class" />);

      const dropZone = screen.getByTestId('drop-zone');
      expect(dropZone).toHaveClass('custom-class');
    });
  });

  describe('Drag Over State', () => {
    it('shows drag-over state when file is dragged over', () => {
      render(<DropZone {...defaultProps} />);

      const dropZone = screen.getByTestId('drop-zone');

      fireEvent.dragEnter(dropZone, createDragEvent([createSqliteFile()]));

      expect(dropZone).toHaveAttribute('data-drag-over', 'true');
      expect(dropZone).toHaveClass('border-solid');
      expect(dropZone).toHaveClass('border-navy-600');
      expect(dropZone).toHaveClass('bg-navy-50');
      expect(screen.getByTestId('drop-zone-active-text')).toHaveTextContent('Drop file here');
    });

    it('resets drag-over state when drag leaves', () => {
      render(<DropZone {...defaultProps} />);

      const dropZone = screen.getByTestId('drop-zone');

      fireEvent.dragEnter(dropZone, createDragEvent([createSqliteFile()]));
      expect(dropZone).toHaveAttribute('data-drag-over', 'true');

      fireEvent.dragLeave(dropZone, createDragEvent([]));
      expect(dropZone).toHaveAttribute('data-drag-over', 'false');
    });

    it('ignores drag events when disabled', () => {
      render(<DropZone {...defaultProps} disabled />);

      const dropZone = screen.getByTestId('drop-zone');

      fireEvent.dragEnter(dropZone, createDragEvent([createSqliteFile()]));

      expect(dropZone).toHaveAttribute('data-drag-over', 'false');
    });
  });

  describe('File Type Routing', () => {
    it('routes .sqlite files to onSqliteFile callback', async () => {
      const onSqliteFile = vi.fn();
      render(<DropZone {...defaultProps} onSqliteFile={onSqliteFile} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createSqliteFile('database.sqlite');

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(() => {
        expect(onSqliteFile).toHaveBeenCalledWith(file);
      });
    });

    it('routes .db files to onSqliteFile callback', async () => {
      const onSqliteFile = vi.fn();
      render(<DropZone {...defaultProps} onSqliteFile={onSqliteFile} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createSqliteFile('database.db');

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(() => {
        expect(onSqliteFile).toHaveBeenCalledWith(file);
      });
    });

    it('routes .sqlite3 files to onSqliteFile callback', async () => {
      const onSqliteFile = vi.fn();
      render(<DropZone {...defaultProps} onSqliteFile={onSqliteFile} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createSqliteFile('database.sqlite3');

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(() => {
        expect(onSqliteFile).toHaveBeenCalledWith(file);
      });
    });

    it('routes .csv files to onCsvFile callback', async () => {
      const onCsvFile = vi.fn();
      render(<DropZone {...defaultProps} onCsvFile={onCsvFile} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createFile('data.csv', 'a,b,c\n1,2,3', 'text/csv');

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(() => {
        expect(onCsvFile).toHaveBeenCalledWith(file);
      });
    });

    it('routes .json files to onJsonFile callback', async () => {
      const onJsonFile = vi.fn();
      render(<DropZone {...defaultProps} onJsonFile={onJsonFile} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createFile('data.json', '{"key": "value"}', 'application/json');

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(() => {
        expect(onJsonFile).toHaveBeenCalledWith(file);
      });
    });

    it('shows error for unsupported file types (.txt)', async () => {
      const onError = vi.fn();
      render(<DropZone {...defaultProps} onError={onError} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createFile('notes.txt', 'Hello world', 'text/plain');

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Unsupported file type: txt');
      });
    });

    it('shows error for unsupported file types (.exe)', async () => {
      const onError = vi.fn();
      render(<DropZone {...defaultProps} onError={onError} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createFile('program.exe', 'binary content', 'application/x-msdownload');

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Unsupported file type: exe');
      });
    });
  });

  describe('File Validation', () => {
    it('validates SQLite magic bytes', async () => {
      const onError = vi.fn();
      render(<DropZone {...defaultProps} onError={onError} />);

      const dropZone = screen.getByTestId('drop-zone');
      // Create a file with .sqlite extension but invalid content
      const file = createFile('fake.sqlite', 'not a real sqlite file', 'application/x-sqlite3');

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(
          'Invalid SQLite file: fake.sqlite does not appear to be a valid SQLite database'
        );
      });
    });

    it('rejects files exceeding max size', async () => {
      const onError = vi.fn();
      // Set max size to 100 bytes for testing
      render(<DropZone {...defaultProps} onError={onError} maxFileSize={100} />);

      const dropZone = screen.getByTestId('drop-zone');
      // Create a large CSV file
      const largeContent = 'a'.repeat(200);
      const file = createFile('large.csv', largeContent, 'text/csv');

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('File too large'));
      });
    });

    it('shows warning when multiple files are dropped', async () => {
      const onWarning = vi.fn();
      const onSqliteFile = vi.fn();
      render(<DropZone {...defaultProps} onWarning={onWarning} onSqliteFile={onSqliteFile} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file1 = createSqliteFile('db1.sqlite');
      const file2 = createSqliteFile('db2.sqlite');

      fireEvent.drop(dropZone, createDragEvent([file1, file2]));

      await waitFor(() => {
        expect(onWarning).toHaveBeenCalledWith(
          'Multiple files dropped. Only the first file will be processed.'
        );
        expect(onSqliteFile).toHaveBeenCalledWith(file1);
      });
    });

    it('shows error when no files are dropped', async () => {
      const onError = vi.fn();
      render(<DropZone {...defaultProps} onError={onError} />);

      const dropZone = screen.getByTestId('drop-zone');

      fireEvent.drop(dropZone, createDragEvent([]));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('No valid files dropped');
      });
    });
  });

  describe('Animation States', () => {
    it('triggers success animation on valid drop', async () => {
      render(<DropZone {...defaultProps} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createSqliteFile();

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(() => {
        expect(dropZone).toHaveAttribute('data-animation', 'success');
      });
    });

    it('triggers error animation on invalid drop', async () => {
      render(<DropZone {...defaultProps} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createFile('test.txt', 'hello', 'text/plain');

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(() => {
        expect(dropZone).toHaveAttribute('data-animation', 'error');
      });
    });

    it('resets animation state after timeout', async () => {
      render(<DropZone {...defaultProps} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createSqliteFile();

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(() => {
        expect(dropZone).toHaveAttribute('data-animation', 'success');
      });

      // Wait for animation timeout (500ms + buffer)
      await waitFor(
        () => {
          expect(dropZone).toHaveAttribute('data-animation', 'idle');
        },
        { timeout: 1000 }
      );
    });
  });

  describe('Security', () => {
    it('only processes dataTransfer.files, not text', () => {
      const onSqliteFile = vi.fn();
      render(<DropZone {...defaultProps} onSqliteFile={onSqliteFile} />);

      const dropZone = screen.getByTestId('drop-zone');

      // Simulate a text drag (no Files type)
      const textDragEvent: Partial<React.DragEvent> = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: [] as unknown as FileList,
          types: ['text/plain'],
          dropEffect: 'none',
          effectAllowed: 'all',
          items: {} as DataTransferItemList,
          clearData: vi.fn(),
          getData: vi.fn(),
          setData: vi.fn(),
          setDragImage: vi.fn(),
        } as unknown as DataTransfer,
      };

      // Should not activate drag over state
      fireEvent.dragEnter(dropZone, textDragEvent);
      expect(dropZone).toHaveAttribute('data-drag-over', 'false');

      // Should not process on drop
      fireEvent.drop(dropZone, textDragEvent);
      expect(onSqliteFile).not.toHaveBeenCalled();
    });

    it('does not process when disabled', () => {
      const onSqliteFile = vi.fn();
      render(<DropZone {...defaultProps} onSqliteFile={onSqliteFile} disabled />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createSqliteFile();

      fireEvent.drop(dropZone, createDragEvent([file]));

      // Callback should not be called for disabled drop zone
      expect(onSqliteFile).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('handles files without extension', async () => {
      const onError = vi.fn();
      render(<DropZone {...defaultProps} onError={onError} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createFile('noextension', 'content', '');

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(
        () => {
          expect(onError).toHaveBeenCalledWith('Unsupported file type: noextension');
        },
        { timeout: 1000 }
      );
    });

    it('handles case-insensitive file extensions', async () => {
      const onSqliteFile = vi.fn();
      render(<DropZone {...defaultProps} onSqliteFile={onSqliteFile} />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createSqliteFile('DATABASE.SQLITE');

      fireEvent.drop(dropZone, createDragEvent([file]));

      await waitFor(
        () => {
          expect(onSqliteFile).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );
    });
  });
});
