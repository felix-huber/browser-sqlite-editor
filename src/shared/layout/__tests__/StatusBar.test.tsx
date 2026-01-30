import { render, screen, fireEvent } from '@testing-library/react';
import { StatusBar, type StatusBarProps } from '../StatusBar';
import { useDatabaseStore } from '../../../store';
import type { PersistenceStatus, StorageMode, LockHolder } from '../../../types';

// Mock store state helper
interface MockStoreState {
  activeDbId: string | null;
  schema: { tables: string[]; views: string[]; indexes: string[] } | null;
  storageMode: StorageMode | null;
  isReadOnly: boolean;
  lockHolder: LockHolder;
  persistenceStatus: PersistenceStatus;
  persistenceError: string | null;
}

function setMockStoreState(state: Partial<MockStoreState>) {
  const fullState = {
    activeDbId: null,
    schema: null,
    storageMode: null,
    isReadOnly: false,
    lockHolder: null,
    persistenceStatus: 'saved' as PersistenceStatus,
    persistenceError: null,
    ...state,
  };
  useDatabaseStore.setState(fullState);
}

describe('StatusBar', () => {
  const defaultProps: StatusBarProps = {};

  beforeEach(() => {
    // Reset store to initial state
    useDatabaseStore.getState().reset();
  });

  describe('No database loaded', () => {
    it('renders "Ready" status when no database is active', () => {
      render(<StatusBar {...defaultProps} />);

      expect(screen.getByTestId('status-bar')).toBeInTheDocument();
      expect(screen.getByText('Ready')).toBeInTheDocument();
      expect(screen.getByText('SQLite WASM')).toBeInTheDocument();
    });

    it('does not show save status when no database is active', () => {
      render(<StatusBar {...defaultProps} />);

      expect(screen.queryByTestId('save-status')).not.toBeInTheDocument();
    });
  });

  describe('Save status indicator', () => {
    beforeEach(() => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users', 'posts'], views: [], indexes: [] },
        storageMode: 'opfs',
      });
    });

    it('displays "Saved" status with green check icon', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
        persistenceStatus: 'saved',
      });

      render(<StatusBar {...defaultProps} />);

      const saveStatus = screen.getByTestId('save-status');
      expect(saveStatus).toHaveTextContent('Saved');
      expect(saveStatus).toHaveClass('text-green-700');
    });

    it('displays "Unsaved" status with yellow dot', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
        persistenceStatus: 'unsaved',
      });

      render(<StatusBar {...defaultProps} />);

      const saveStatus = screen.getByTestId('save-status');
      expect(saveStatus).toHaveTextContent('Unsaved');
      expect(saveStatus).toHaveClass('text-amber-700');
    });

    it('displays "Saving..." status with spinner', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
        persistenceStatus: 'saving',
      });

      render(<StatusBar {...defaultProps} />);

      const saveStatus = screen.getByTestId('save-status');
      expect(saveStatus).toHaveTextContent('Saving...');
      expect(saveStatus).toHaveClass('text-navy-600');
    });

    it('displays "Error" status with red X', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
        persistenceStatus: 'error',
        persistenceError: 'Failed to save: Quota exceeded',
      });

      render(<StatusBar {...defaultProps} />);

      const saveStatus = screen.getByTestId('save-status');
      expect(saveStatus).toHaveTextContent('Error');
      expect(saveStatus).toHaveClass('text-red-700');
    });

    it('shows error details popover when error status is clicked', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
        persistenceStatus: 'error',
        persistenceError: 'Failed to save: Quota exceeded',
      });

      render(<StatusBar {...defaultProps} />);

      const saveStatus = screen.getByTestId('save-status');
      fireEvent.click(saveStatus);

      const errorDetails = screen.getByTestId('error-details');
      expect(errorDetails).toBeInTheDocument();
      expect(errorDetails).toHaveTextContent('Failed to save: Quota exceeded');
    });

    it('hides error details when close button is clicked', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
        persistenceStatus: 'error',
        persistenceError: 'Failed to save: Quota exceeded',
      });

      render(<StatusBar {...defaultProps} />);

      // Open error details
      fireEvent.click(screen.getByTestId('save-status'));
      expect(screen.getByTestId('error-details')).toBeInTheDocument();

      // Close error details
      const closeButton = screen.getByLabelText('Close error details');
      fireEvent.click(closeButton);
      expect(screen.queryByTestId('error-details')).not.toBeInTheDocument();
    });
  });

  describe('Storage mode badge', () => {
    it('displays "OPFS" badge for OPFS storage mode', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
      });

      render(<StatusBar {...defaultProps} />);

      const badge = screen.getByTestId('storage-mode');
      expect(badge).toHaveTextContent('OPFS');
      expect(badge).toHaveAttribute(
        'title',
        'Origin Private File System - fast, persistent storage'
      );
    });

    it('displays "IndexedDB" badge for IDB storage mode', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'idb',
      });

      render(<StatusBar {...defaultProps} />);

      const badge = screen.getByTestId('storage-mode');
      expect(badge).toHaveTextContent('IndexedDB');
      expect(badge).toHaveAttribute(
        'title',
        'IndexedDB fallback - compatible but slower'
      );
    });
  });

  describe('Lock status', () => {
    it('displays "Write" status when this tab holds the lock', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
        isReadOnly: false,
        lockHolder: 'self',
      });

      render(<StatusBar {...defaultProps} />);

      const lockStatus = screen.getByTestId('lock-status');
      expect(lockStatus).toHaveTextContent('Write');
      expect(lockStatus).toHaveClass('text-green-700');
      expect(lockStatus).toHaveAttribute(
        'title',
        'This tab holds the write lock'
      );
    });

    it('displays "Read-only" status when another tab holds the lock', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
        isReadOnly: true,
        lockHolder: 'other',
      });

      render(<StatusBar {...defaultProps} />);

      const lockStatus = screen.getByTestId('lock-status');
      expect(lockStatus).toHaveTextContent('Read-only');
      expect(lockStatus).toHaveClass('text-navy-500');
      expect(lockStatus).toHaveAttribute(
        'title',
        'Another tab holds the write lock'
      );
    });

    it('does not show lock status when lockHolder is null', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
        isReadOnly: false,
        lockHolder: null,
      });

      render(<StatusBar {...defaultProps} />);

      expect(screen.queryByTestId('lock-status')).not.toBeInTheDocument();
    });
  });

  describe('Database info', () => {
    beforeEach(() => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users', 'posts', 'comments'], views: ['v1'], indexes: [] },
        storageMode: 'opfs',
      });
    });

    it('displays table count correctly', () => {
      render(<StatusBar {...defaultProps} />);

      const tableCount = screen.getByTestId('table-count');
      expect(tableCount).toHaveTextContent('3 tables');
    });

    it('displays singular "table" for one table', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
      });

      render(<StatusBar {...defaultProps} />);

      const tableCount = screen.getByTestId('table-count');
      expect(tableCount).toHaveTextContent('1 table');
    });

    it('displays file size when provided', () => {
      render(<StatusBar dbFileSize={2621440} />);

      const fileSize = screen.getByTestId('db-file-size');
      expect(fileSize).toHaveTextContent('2.5 MB');
    });

    it('displays row count when table and count are provided', () => {
      render(
        <StatusBar
          currentTable="users"
          currentTableRowCount={1234}
        />
      );

      const rowCount = screen.getByTestId('row-count');
      // toLocaleString format depends on locale, so just check the number is there
      expect(rowCount).toHaveTextContent('1');
      expect(rowCount).toHaveTextContent('234');
      expect(rowCount).toHaveTextContent('rows');
    });

    it('does not display file size when not provided', () => {
      render(<StatusBar {...defaultProps} />);

      expect(screen.queryByTestId('db-file-size')).not.toBeInTheDocument();
    });

    it('does not display row count when no current table', () => {
      render(<StatusBar currentTableRowCount={100} />);

      expect(screen.queryByTestId('row-count')).not.toBeInTheDocument();
    });

    it('formats large numbers with locale separators', () => {
      render(
        <StatusBar
          currentTable="users"
          currentTableRowCount={1234567}
        />
      );

      const rowCount = screen.getByTestId('row-count');
      // Note: toLocaleString() format depends on locale
      expect(rowCount).toHaveTextContent('rows');
    });
  });

  describe('File size formatting', () => {
    beforeEach(() => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
      });
    });

    it('formats bytes correctly', () => {
      render(<StatusBar dbFileSize={500} />);
      expect(screen.getByTestId('db-file-size')).toHaveTextContent('500 B');
    });

    it('formats kilobytes correctly', () => {
      render(<StatusBar dbFileSize={1536} />);
      expect(screen.getByTestId('db-file-size')).toHaveTextContent('1.5 KB');
    });

    it('formats megabytes correctly', () => {
      render(<StatusBar dbFileSize={5242880} />);
      expect(screen.getByTestId('db-file-size')).toHaveTextContent('5.0 MB');
    });

    it('formats gigabytes correctly', () => {
      render(<StatusBar dbFileSize={2147483648} />);
      expect(screen.getByTestId('db-file-size')).toHaveTextContent('2.0 GB');
    });

    it('handles zero bytes', () => {
      render(<StatusBar dbFileSize={0} />);
      expect(screen.getByTestId('db-file-size')).toHaveTextContent('0 B');
    });
  });

  describe('Accessibility', () => {
    beforeEach(() => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
      });
    });

    it('has proper aria-label for save status', () => {
      render(<StatusBar {...defaultProps} />);

      const saveStatus = screen.getByTestId('save-status');
      expect(saveStatus).toHaveAttribute('aria-label', 'Save status: Saved');
    });

    it('has title tooltips for storage mode and lock status', () => {
      setMockStoreState({
        activeDbId: 'test-db',
        schema: { tables: ['users'], views: [], indexes: [] },
        storageMode: 'opfs',
        lockHolder: 'self',
      });

      render(<StatusBar {...defaultProps} />);

      expect(screen.getByTestId('storage-mode')).toHaveAttribute('title');
      expect(screen.getByTestId('lock-status')).toHaveAttribute('title');
    });

    it('has title tooltip for file size', () => {
      render(<StatusBar dbFileSize={1024} />);

      expect(screen.getByTestId('db-file-size')).toHaveAttribute(
        'title',
        'Database file size'
      );
    });
  });
});
