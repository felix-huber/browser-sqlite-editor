import { render, screen, fireEvent } from '@testing-library/react';
import { DDLDiffPreview, type DDLDiffPreviewProps, type DependentObject } from '../DDLDiffPreview';

describe('DDLDiffPreview', () => {
  const defaultProps: DDLDiffPreviewProps = {
    originalSql: 'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT\n);',
    proposedSql: 'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT,\n  email TEXT\n);',
    dependentObjects: [],
    netEffectSummary: 'Add column email',
  };

  describe('Basic Rendering', () => {
    it('renders the component with all sections', () => {
      render(<DDLDiffPreview {...defaultProps} />);

      expect(screen.getByTestId('ddl-diff-preview')).toBeInTheDocument();
      expect(screen.getByTestId('ddl-diff-original')).toBeInTheDocument();
      expect(screen.getByTestId('ddl-diff-proposed')).toBeInTheDocument();
      expect(screen.getByTestId('ddl-diff-summary')).toBeInTheDocument();
    });

    it('renders original SQL section with label', () => {
      render(<DDLDiffPreview {...defaultProps} />);

      expect(screen.getByText('Original')).toBeInTheDocument();
      const originalSection = screen.getByTestId('ddl-diff-original');
      expect(originalSection).toHaveTextContent('CREATE TABLE users');
    });

    it('renders proposed SQL section with label', () => {
      render(<DDLDiffPreview {...defaultProps} />);

      expect(screen.getByText('Proposed')).toBeInTheDocument();
      const proposedSection = screen.getByTestId('ddl-diff-proposed');
      expect(proposedSection).toHaveTextContent('email TEXT');
    });

    it('renders net effect summary prominently', () => {
      render(<DDLDiffPreview {...defaultProps} />);

      const summary = screen.getByTestId('ddl-diff-summary');
      expect(summary).toHaveTextContent('Add column email');
    });
  });

  describe('Diff Rendering', () => {
    it('highlights added lines in proposed SQL', () => {
      render(<DDLDiffPreview {...defaultProps} />);

      const proposedSection = screen.getByTestId('ddl-diff-proposed');
      const addedLines = proposedSection.querySelectorAll('[data-diff-type="added"]');
      expect(addedLines.length).toBeGreaterThan(0);
    });

    it('highlights removed lines in original SQL', () => {
      const props: DDLDiffPreviewProps = {
        originalSql: 'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT,\n  old_col TEXT\n);',
        proposedSql: 'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT\n);',
        dependentObjects: [],
        netEffectSummary: 'Remove column old_col',
      };
      render(<DDLDiffPreview {...props} />);

      const originalSection = screen.getByTestId('ddl-diff-original');
      const removedLines = originalSection.querySelectorAll('[data-diff-type="removed"]');
      expect(removedLines.length).toBeGreaterThan(0);
    });

    it('shows unchanged lines without highlighting', () => {
      render(<DDLDiffPreview {...defaultProps} />);

      const originalSection = screen.getByTestId('ddl-diff-original');
      const unchangedLines = originalSection.querySelectorAll('[data-diff-type="unchanged"]');
      expect(unchangedLines.length).toBeGreaterThan(0);
    });

    it('applies syntax highlighting to SQL keywords', () => {
      render(<DDLDiffPreview {...defaultProps} />);

      const keywords = screen.getAllByTestId('sql-keyword');
      expect(keywords.length).toBeGreaterThan(0);
      expect(keywords[0]).toHaveTextContent(/CREATE|TABLE|INTEGER|PRIMARY|KEY|TEXT/);
    });
  });

  describe('Dependent Objects', () => {
    const dependentObjects: DependentObject[] = [
      { type: 'index', name: 'idx_users_name' },
      { type: 'trigger', name: 'trg_users_update' },
      { type: 'foreign_key', name: 'fk_posts_user_id' },
    ];

    it('renders dependent objects section when objects provided', () => {
      render(<DDLDiffPreview {...defaultProps} dependentObjects={dependentObjects} />);

      expect(screen.getByTestId('ddl-diff-deps')).toBeInTheDocument();
    });

    it('does not render dependent objects section when empty', () => {
      render(<DDLDiffPreview {...defaultProps} dependentObjects={[]} />);

      expect(screen.queryByTestId('ddl-diff-deps')).not.toBeInTheDocument();
    });

    it('shows collapsible list of dependent objects', () => {
      render(<DDLDiffPreview {...defaultProps} dependentObjects={dependentObjects} />);

      const depsList = screen.getByTestId('ddl-diff-deps-list');
      expect(depsList).toBeInTheDocument();
      expect(screen.getByText('idx_users_name')).toBeInTheDocument();
      expect(screen.getByText('trg_users_update')).toBeInTheDocument();
      expect(screen.getByText('fk_posts_user_id')).toBeInTheDocument();
    });

    it('shows object type icons or labels', () => {
      render(<DDLDiffPreview {...defaultProps} dependentObjects={dependentObjects} />);

      expect(screen.getByText(/index/i)).toBeInTheDocument();
      expect(screen.getByText(/trigger/i)).toBeInTheDocument();
      expect(screen.getByText(/foreign key/i)).toBeInTheDocument();
    });

    it('collapses and expands dependent objects list', () => {
      render(<DDLDiffPreview {...defaultProps} dependentObjects={dependentObjects} />);

      const toggleBtn = screen.getByTestId('ddl-diff-deps-toggle');
      const depsList = screen.getByTestId('ddl-diff-deps-list');

      // Initially visible
      expect(depsList).toBeVisible();

      // Click to collapse
      fireEvent.click(toggleBtn);
      expect(depsList).not.toBeVisible();

      // Click to expand
      fireEvent.click(toggleBtn);
      expect(depsList).toBeVisible();
    });

    it('shows count of affected objects in header', () => {
      render(<DDLDiffPreview {...defaultProps} dependentObjects={dependentObjects} />);

      expect(screen.getByText(/3 objects? will be dropped and recreated/i)).toBeInTheDocument();
    });
  });

  describe('Net Effect Summary', () => {
    it('renders summary with prominent styling', () => {
      render(<DDLDiffPreview {...defaultProps} netEffectSummary="Rename column a → a1; 2 indexes recreated" />);

      const summary = screen.getByTestId('ddl-diff-summary');
      expect(summary).toHaveTextContent('Rename column a → a1; 2 indexes recreated');
    });

    it('handles complex multi-line summaries', () => {
      const multiLineSummary = 'Add column email\nRename column name → full_name\n2 indexes will be recreated';
      render(<DDLDiffPreview {...defaultProps} netEffectSummary={multiLineSummary} />);

      const summary = screen.getByTestId('ddl-diff-summary');
      expect(summary).toHaveTextContent('Add column email');
      expect(summary).toHaveTextContent('Rename column name → full_name');
    });

    it('shows no changes message when SQL is identical', () => {
      render(
        <DDLDiffPreview
          originalSql="CREATE TABLE users (id INTEGER);"
          proposedSql="CREATE TABLE users (id INTEGER);"
          dependentObjects={[]}
          netEffectSummary=""
        />
      );

      expect(screen.getByText(/no changes/i)).toBeInTheDocument();
    });
  });

  describe('Rollback Failure Display', () => {
    it('renders rollback error when provided', () => {
      render(
        <DDLDiffPreview
          {...defaultProps}
          rollbackError="FOREIGN KEY constraint failed: posts.user_id references users.id"
        />
      );

      expect(screen.getByTestId('ddl-diff-rollback-error')).toBeInTheDocument();
      expect(screen.getByText(/FOREIGN KEY constraint failed/i)).toBeInTheDocument();
    });

    it('does not show rollback error section when not provided', () => {
      render(<DDLDiffPreview {...defaultProps} />);

      expect(screen.queryByTestId('ddl-diff-rollback-error')).not.toBeInTheDocument();
    });

    it('shows rollback error with consistent error styling', () => {
      render(
        <DDLDiffPreview
          {...defaultProps}
          rollbackError="Migration failed"
        />
      );

      const errorSection = screen.getByTestId('ddl-diff-rollback-error');
      expect(errorSection).toHaveClass('bg-red-900/20');
    });
  });

  describe('Styling', () => {
    it('applies custom className when provided', () => {
      render(<DDLDiffPreview {...defaultProps} className="custom-diff-class" />);

      const container = screen.getByTestId('ddl-diff-preview');
      expect(container).toHaveClass('custom-diff-class');
    });

    it('uses monospace font for SQL code', () => {
      render(<DDLDiffPreview {...defaultProps} />);

      const original = screen.getByTestId('ddl-diff-original');
      expect(original.querySelector('code')).toHaveClass('font-mono');
    });
  });

  describe('Empty States', () => {
    it('handles empty original SQL gracefully', () => {
      render(
        <DDLDiffPreview
          {...defaultProps}
          originalSql=""
          netEffectSummary="Create new table"
        />
      );

      expect(screen.getByTestId('ddl-diff-preview')).toBeInTheDocument();
    });

    it('handles empty proposed SQL gracefully', () => {
      render(
        <DDLDiffPreview
          {...defaultProps}
          proposedSql=""
          netEffectSummary="Drop table"
        />
      );

      expect(screen.getByTestId('ddl-diff-preview')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has appropriate ARIA labels', () => {
      render(<DDLDiffPreview {...defaultProps} />);

      expect(screen.getByLabelText(/original sql/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/proposed sql/i)).toBeInTheDocument();
    });

    it('marks diff sections with appropriate roles', () => {
      render(<DDLDiffPreview {...defaultProps} />);

      const regions = screen.getAllByRole('region');
      expect(regions.length).toBeGreaterThanOrEqual(2);
    });
  });
});
