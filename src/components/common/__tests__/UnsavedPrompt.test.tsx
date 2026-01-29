/**
 * UnsavedPrompt Component Tests
 *
 * Tests for the unsaved changes dialog component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { UnsavedPrompt } from '../UnsavedPrompt';

describe('UnsavedPrompt', () => {
  const mockOnAction = vi.fn();

  beforeEach(() => {
    mockOnAction.mockClear();
    cleanup();
  });

  describe('Rendering', () => {
    it('renders nothing when not open', () => {
      render(
        <UnsavedPrompt
          isOpen={false}
          context="Grid Editor"
          onAction={mockOnAction}
        />
      );

      expect(screen.queryByTestId('unsaved-prompt-dialog')).not.toBeInTheDocument();
    });

    it('renders dialog when open', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          onAction={mockOnAction}
        />
      );

      expect(screen.getByTestId('unsaved-prompt-dialog')).toBeInTheDocument();
      expect(screen.getByText('Unsaved Changes')).toBeInTheDocument();
    });

    it('displays context in message', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Table Designer"
          onAction={mockOnAction}
        />
      );

      expect(screen.getByTestId('unsaved-prompt-message')).toHaveTextContent(
        'You have unsaved changes in Table Designer. Do you want to discard them?'
      );
    });

    it('renders Save button when canSave is true', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          canSave={true}
          onAction={mockOnAction}
        />
      );

      expect(screen.getByTestId('unsaved-prompt-save')).toBeInTheDocument();
    });

    it('hides Save button when canSave is false', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          canSave={false}
          onAction={mockOnAction}
        />
      );

      expect(screen.queryByTestId('unsaved-prompt-save')).not.toBeInTheDocument();
    });

    it('renders Cancel and Discard buttons', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          onAction={mockOnAction}
        />
      );

      expect(screen.getByTestId('unsaved-prompt-cancel')).toBeInTheDocument();
      expect(screen.getByTestId('unsaved-prompt-discard')).toBeInTheDocument();
    });
  });

  describe('Actions', () => {
    it('calls onAction with "save" when Save button clicked', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          canSave={true}
          onAction={mockOnAction}
        />
      );

      fireEvent.click(screen.getByTestId('unsaved-prompt-save'));

      expect(mockOnAction).toHaveBeenCalledWith('save');
    });

    it('calls onAction with "discard" when Discard button clicked', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          onAction={mockOnAction}
        />
      );

      fireEvent.click(screen.getByTestId('unsaved-prompt-discard'));

      expect(mockOnAction).toHaveBeenCalledWith('discard');
    });

    it('calls onAction with "cancel" when Cancel button clicked', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          onAction={mockOnAction}
        />
      );

      fireEvent.click(screen.getByTestId('unsaved-prompt-cancel'));

      expect(mockOnAction).toHaveBeenCalledWith('cancel');
    });

    it('calls onAction with "cancel" when backdrop clicked', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          onAction={mockOnAction}
        />
      );

      fireEvent.click(screen.getByTestId('unsaved-prompt-backdrop'));

      expect(mockOnAction).toHaveBeenCalledWith('cancel');
    });

    it('calls onAction with "cancel" when Escape pressed', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          onAction={mockOnAction}
        />
      );

      fireEvent.keyDown(screen.getByTestId('unsaved-prompt-backdrop'), {
        key: 'Escape',
      });

      expect(mockOnAction).toHaveBeenCalledWith('cancel');
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA attributes', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          onAction={mockOnAction}
        />
      );

      const backdrop = screen.getByTestId('unsaved-prompt-backdrop');
      expect(backdrop).toHaveAttribute('role', 'dialog');
      expect(backdrop).toHaveAttribute('aria-modal', 'true');
      expect(backdrop).toHaveAttribute('aria-labelledby', 'unsaved-prompt-title');
      expect(backdrop).toHaveAttribute('aria-describedby', 'unsaved-prompt-description');
    });

    it('has title with correct id', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          onAction={mockOnAction}
        />
      );

      const title = screen.getByText('Unsaved Changes');
      expect(title).toHaveAttribute('id', 'unsaved-prompt-title');
    });

    it('has description with correct id', () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          onAction={mockOnAction}
        />
      );

      const description = screen.getByTestId('unsaved-prompt-message');
      expect(description).toHaveAttribute('id', 'unsaved-prompt-description');
    });
  });

  describe('Focus behavior', () => {
    it('focuses Save button when canSave is true', async () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          canSave={true}
          onAction={mockOnAction}
        />
      );

      // Wait for focus to be applied
      await vi.waitFor(() => {
        expect(screen.getByTestId('unsaved-prompt-save')).toHaveFocus();
      });
    });

    it('focuses Discard button when canSave is false', async () => {
      render(
        <UnsavedPrompt
          isOpen={true}
          context="Grid Editor"
          canSave={false}
          onAction={mockOnAction}
        />
      );

      // Wait for focus to be applied
      await vi.waitFor(() => {
        expect(screen.getByTestId('unsaved-prompt-discard')).toHaveFocus();
      });
    });
  });
});
