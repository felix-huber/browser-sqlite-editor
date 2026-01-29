/**
 * ConfirmDialog Component Tests
 *
 * Tests for the confirmation dialog component covering:
 * - Simple confirm variant
 * - Type-to-confirm variant
 * - Dependency warning variant
 * - Cancel and Confirm callbacks
 * - Accessibility
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, type DependentObject } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  const mockOnCancel = vi.fn();
  const mockOnConfirm = vi.fn();

  const defaultProps = {
    isOpen: true,
    title: 'Delete Table',
    message: 'Are you sure you want to delete table "users"?',
    onCancel: mockOnCancel,
    onConfirm: mockOnConfirm,
  };

  beforeEach(() => {
    mockOnCancel.mockClear();
    mockOnConfirm.mockClear();
    cleanup();
  });

  // ===========================================================================
  // Simple Confirm Variant Tests
  // ===========================================================================

  describe('Simple confirm variant', () => {
    it('renders nothing when not open', () => {
      render(<ConfirmDialog {...defaultProps} isOpen={false} />);

      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    });

    it('renders message and buttons when open', () => {
      render(<ConfirmDialog {...defaultProps} />);

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('confirm-dialog-title')).toHaveTextContent('Delete Table');
      expect(screen.getByTestId('confirm-dialog-message')).toHaveTextContent(
        'Are you sure you want to delete table "users"?'
      );
      expect(screen.getByTestId('confirm-dialog-cancel')).toBeInTheDocument();
      expect(screen.getByTestId('confirm-dialog-confirm')).toBeInTheDocument();
    });

    it('uses custom button labels', () => {
      render(
        <ConfirmDialog
          {...defaultProps}
          confirmLabel="Remove"
          cancelLabel="Go Back"
        />
      );

      expect(screen.getByTestId('confirm-dialog-cancel')).toHaveTextContent('Go Back');
      expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('Remove');
    });

    it('confirm button is enabled by default', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const confirmButton = screen.getByTestId('confirm-dialog-confirm');
      expect(confirmButton).not.toBeDisabled();
    });

    it('shows destructive styling on confirm button', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const confirmButton = screen.getByTestId('confirm-dialog-confirm');
      expect(confirmButton).toHaveClass('bg-red-600');
    });
  });

  // ===========================================================================
  // Type-to-Confirm Variant Tests
  // ===========================================================================

  describe('Type-to-confirm variant', () => {
    const typeConfirmProps = {
      ...defaultProps,
      requiresTypeConfirm: true,
      confirmText: 'users',
    };

    it('renders input field when requiresTypeConfirm is true', () => {
      render(<ConfirmDialog {...typeConfirmProps} />);

      expect(screen.getByTestId('confirm-dialog-type-confirm')).toBeInTheDocument();
      expect(screen.getByTestId('confirm-dialog-input')).toBeInTheDocument();
    });

    it('button is disabled until correct text is typed', () => {
      render(<ConfirmDialog {...typeConfirmProps} />);

      const confirmButton = screen.getByTestId('confirm-dialog-confirm');
      expect(confirmButton).toBeDisabled();
    });

    it('button becomes enabled when correct text is typed', async () => {
      const user = userEvent.setup();
      render(<ConfirmDialog {...typeConfirmProps} />);

      const input = screen.getByTestId('confirm-dialog-input');
      const confirmButton = screen.getByTestId('confirm-dialog-confirm');

      // Type partial text - button should stay disabled
      await user.type(input, 'user');
      expect(confirmButton).toBeDisabled();

      // Type full text - button should become enabled
      await user.type(input, 's');
      expect(confirmButton).not.toBeDisabled();
    });

    it('button becomes disabled again if text is changed to incorrect', async () => {
      const user = userEvent.setup();
      render(<ConfirmDialog {...typeConfirmProps} />);

      const input = screen.getByTestId('confirm-dialog-input');
      const confirmButton = screen.getByTestId('confirm-dialog-confirm');

      // Type correct text
      await user.type(input, 'users');
      expect(confirmButton).not.toBeDisabled();

      // Add extra character
      await user.type(input, 'x');
      expect(confirmButton).toBeDisabled();
    });

    it('shows the required confirmation text in the label', () => {
      render(<ConfirmDialog {...typeConfirmProps} />);

      expect(screen.getByText('users')).toBeInTheDocument();
    });

    it('resets typed text when dialog is reopened', () => {
      const { rerender } = render(<ConfirmDialog {...typeConfirmProps} />);

      // Type something
      fireEvent.change(screen.getByTestId('confirm-dialog-input'), {
        target: { value: 'users' },
      });

      // Close dialog
      rerender(<ConfirmDialog {...typeConfirmProps} isOpen={false} />);

      // Reopen dialog
      rerender(<ConfirmDialog {...typeConfirmProps} isOpen={true} />);

      // Input should be cleared
      expect(screen.getByTestId('confirm-dialog-input')).toHaveValue('');
    });
  });

  // ===========================================================================
  // Dependency Warning Variant Tests
  // ===========================================================================

  describe('Dependency warning variant', () => {
    const dependentObjects: DependentObject[] = [
      { type: 'view', name: 'user_summary' },
      { type: 'trigger', name: 'update_timestamp' },
      { type: 'foreign_key', name: 'orders_user_id_fk' },
    ];

    it('renders dependency list when dependentObjects is provided', () => {
      render(
        <ConfirmDialog {...defaultProps} dependentObjects={dependentObjects} />
      );

      expect(screen.getByTestId('confirm-dialog-dependencies')).toBeInTheDocument();
      expect(screen.getByTestId('confirm-dialog-dependency-list')).toBeInTheDocument();
    });

    it('lists all dependent objects', () => {
      render(
        <ConfirmDialog {...defaultProps} dependentObjects={dependentObjects} />
      );

      expect(screen.getByTestId('dependency-item-0')).toHaveTextContent('user_summary');
      expect(screen.getByTestId('dependency-item-1')).toHaveTextContent('update_timestamp');
      expect(screen.getByTestId('dependency-item-2')).toHaveTextContent('orders_user_id_fk');
    });

    it('shows object types correctly formatted', () => {
      render(
        <ConfirmDialog {...defaultProps} dependentObjects={dependentObjects} />
      );

      expect(screen.getByTestId('dependency-item-0')).toHaveTextContent('View:');
      expect(screen.getByTestId('dependency-item-1')).toHaveTextContent('Trigger:');
      expect(screen.getByTestId('dependency-item-2')).toHaveTextContent('Foreign key:');
    });

    it('does not show dependency section when list is empty', () => {
      render(<ConfirmDialog {...defaultProps} dependentObjects={[]} />);

      expect(screen.queryByTestId('confirm-dialog-dependencies')).not.toBeInTheDocument();
    });

    it('does not show dependency section when not provided', () => {
      render(<ConfirmDialog {...defaultProps} />);

      expect(screen.queryByTestId('confirm-dialog-dependencies')).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Cancel Callback Tests
  // ===========================================================================

  describe('Cancel callback', () => {
    it('calls onCancel when Cancel button is clicked', () => {
      render(<ConfirmDialog {...defaultProps} />);

      fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when backdrop is clicked', () => {
      render(<ConfirmDialog {...defaultProps} />);

      fireEvent.click(screen.getByTestId('confirm-dialog-backdrop'));

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when Escape key is pressed', () => {
      render(<ConfirmDialog {...defaultProps} />);

      fireEvent.keyDown(screen.getByTestId('confirm-dialog-backdrop'), {
        key: 'Escape',
      });

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('does not call onCancel when isConfirming is true', () => {
      render(<ConfirmDialog {...defaultProps} isConfirming={true} />);

      fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
      fireEvent.click(screen.getByTestId('confirm-dialog-backdrop'));
      fireEvent.keyDown(screen.getByTestId('confirm-dialog-backdrop'), {
        key: 'Escape',
      });

      expect(mockOnCancel).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Confirm Callback Tests
  // ===========================================================================

  describe('Confirm callback', () => {
    it('calls onConfirm when Confirm button is clicked', () => {
      render(<ConfirmDialog {...defaultProps} />);

      fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onConfirm when Enter key is pressed', () => {
      render(<ConfirmDialog {...defaultProps} />);

      fireEvent.keyDown(screen.getByTestId('confirm-dialog-backdrop'), {
        key: 'Enter',
      });

      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    });

    it('does not call onConfirm when button is disabled (type-to-confirm)', () => {
      render(
        <ConfirmDialog
          {...defaultProps}
          requiresTypeConfirm={true}
          confirmText="users"
        />
      );

      fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

      expect(mockOnConfirm).not.toHaveBeenCalled();
    });

    it('does not call onConfirm on Enter when button is disabled', () => {
      render(
        <ConfirmDialog
          {...defaultProps}
          requiresTypeConfirm={true}
          confirmText="users"
        />
      );

      fireEvent.keyDown(screen.getByTestId('confirm-dialog-backdrop'), {
        key: 'Enter',
      });

      expect(mockOnConfirm).not.toHaveBeenCalled();
    });

    it('does not call onConfirm when isConfirming is true', () => {
      render(<ConfirmDialog {...defaultProps} isConfirming={true} />);

      fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
      fireEvent.keyDown(screen.getByTestId('confirm-dialog-backdrop'), {
        key: 'Enter',
      });

      expect(mockOnConfirm).not.toHaveBeenCalled();
    });

    it('calls onConfirm after correct text is typed', async () => {
      const user = userEvent.setup();
      render(
        <ConfirmDialog
          {...defaultProps}
          requiresTypeConfirm={true}
          confirmText="users"
        />
      );

      const input = screen.getByTestId('confirm-dialog-input');
      await user.type(input, 'users');

      fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Loading State Tests
  // ===========================================================================

  describe('Loading state', () => {
    it('shows "Processing..." when isConfirming is true', () => {
      render(<ConfirmDialog {...defaultProps} isConfirming={true} />);

      expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('Processing...');
    });

    it('disables confirm button when isConfirming is true', () => {
      render(<ConfirmDialog {...defaultProps} isConfirming={true} />);

      expect(screen.getByTestId('confirm-dialog-confirm')).toBeDisabled();
    });

    it('disables cancel button when isConfirming is true', () => {
      render(<ConfirmDialog {...defaultProps} isConfirming={true} />);

      expect(screen.getByTestId('confirm-dialog-cancel')).toBeDisabled();
    });

    it('disables input when isConfirming is true', () => {
      render(
        <ConfirmDialog
          {...defaultProps}
          requiresTypeConfirm={true}
          confirmText="users"
          isConfirming={true}
        />
      );

      expect(screen.getByTestId('confirm-dialog-input')).toBeDisabled();
    });
  });

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('Accessibility', () => {
    it('has proper ARIA attributes', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const backdrop = screen.getByTestId('confirm-dialog-backdrop');
      expect(backdrop).toHaveAttribute('role', 'dialog');
      expect(backdrop).toHaveAttribute('aria-modal', 'true');
      expect(backdrop).toHaveAttribute('aria-labelledby', 'confirm-dialog-title');
      expect(backdrop).toHaveAttribute('aria-describedby', 'confirm-dialog-description');
    });

    it('title has correct id for aria-labelledby', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const title = screen.getByTestId('confirm-dialog-title');
      expect(title).toHaveAttribute('id', 'confirm-dialog-title');
    });

    it('description has correct id for aria-describedby', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const message = screen.getByTestId('confirm-dialog-message');
      expect(message).toHaveAttribute('id', 'confirm-dialog-description');
    });

    it('input has associated label', () => {
      render(
        <ConfirmDialog
          {...defaultProps}
          requiresTypeConfirm={true}
          confirmText="users"
        />
      );

      const input = screen.getByTestId('confirm-dialog-input');
      expect(input).toHaveAttribute('id', 'confirm-dialog-input');

      const label = screen.getByLabelText(/Type.*to confirm/);
      expect(label).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Focus Behavior Tests
  // ===========================================================================

  describe('Focus behavior', () => {
    it('focuses confirm button in simple mode', async () => {
      render(<ConfirmDialog {...defaultProps} />);

      // Wait for focus to be applied
      await vi.waitFor(() => {
        expect(screen.getByTestId('confirm-dialog-confirm')).toHaveFocus();
      });
    });

    it('focuses input in type-to-confirm mode', async () => {
      render(
        <ConfirmDialog
          {...defaultProps}
          requiresTypeConfirm={true}
          confirmText="users"
        />
      );

      // Wait for focus to be applied
      await vi.waitFor(() => {
        expect(screen.getByTestId('confirm-dialog-input')).toHaveFocus();
      });
    });
  });

  // ===========================================================================
  // Combined Features Tests
  // ===========================================================================

  describe('Combined features', () => {
    it('works with both type-to-confirm and dependencies', async () => {
      const user = userEvent.setup();
      const dependentObjects: DependentObject[] = [
        { type: 'view', name: 'user_summary' },
      ];

      render(
        <ConfirmDialog
          {...defaultProps}
          requiresTypeConfirm={true}
          confirmText="users"
          dependentObjects={dependentObjects}
        />
      );

      // Both sections should be visible
      expect(screen.getByTestId('confirm-dialog-dependencies')).toBeInTheDocument();
      expect(screen.getByTestId('confirm-dialog-type-confirm')).toBeInTheDocument();

      // Button should be disabled initially
      expect(screen.getByTestId('confirm-dialog-confirm')).toBeDisabled();

      // Type correct text
      await user.type(screen.getByTestId('confirm-dialog-input'), 'users');

      // Button should now be enabled
      expect(screen.getByTestId('confirm-dialog-confirm')).not.toBeDisabled();

      // Confirm should work
      fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    });
  });
});
