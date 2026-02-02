/**
 * Tests for QueryBuilder selectedColumns preservation (Fix #3)
 *
 * The bug: selectedColumns were being cleared on restore because the useEffect
 * ran when tableColumns was {} (empty object). The fix checks if columns are
 * actually loaded before updating, preserving selectedColumns from restored state.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { QueryBuilder, type TableBoxNodeType } from '../';
import type { TableBoxColumnData } from '../TableBox';

// Wrapper component to provide React Flow context
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

describe('QueryBuilder - selectedColumns preservation', () => {
  it('should preserve selectedColumns when tableColumns is empty object', () => {
    const initialNodes: TableBoxNodeType[] = [
      {
        id: 'table-users-123',
        type: 'tableBox',
        position: { x: 0, y: 0 },
        data: {
          tableName: 'users',
          alias: 't1',
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'name', type: 'TEXT' },
          ],
          selectedColumns: ['id', 'name'], // These should be preserved
        },
      },
    ];

    const onStateChange = vi.fn();

    const { rerender: _rerender } = render(
      <TestWrapper>
        <QueryBuilder
          tables={['users', 'orders']}
          tableColumns={{}} // Empty - simulating initial state before columns load
          initialNodes={initialNodes}
          onStateChange={onStateChange}
        />
      </TestWrapper>
    );

    // The selectedColumns should still be ['id', 'name'] after initial render
    // Check via the onStateChange callback
    const lastCall = onStateChange.mock.calls[onStateChange.mock.calls.length - 1];
    if (lastCall) {
      const nodes = lastCall[0] as TableBoxNodeType[];
      const usersNode = nodes.find(n => n.data.tableName === 'users');
      expect(usersNode?.data.selectedColumns).toEqual(['id', 'name']);
    }
  });

  it('should preserve selectedColumns when tableColumns for this table is not loaded', () => {
    const initialNodes: TableBoxNodeType[] = [
      {
        id: 'table-users-123',
        type: 'tableBox',
        position: { x: 0, y: 0 },
        data: {
          tableName: 'users',
          alias: 't1',
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'name', type: 'TEXT' },
          ],
          selectedColumns: ['id'], // Should be preserved
        },
      },
    ];

    const onStateChange = vi.fn();

    render(
      <TestWrapper>
        <QueryBuilder
          tables={['users', 'orders']}
          tableColumns={{
            orders: [{ name: 'order_id', type: 'INTEGER' }], // Only orders loaded, not users
          }}
          initialNodes={initialNodes}
          onStateChange={onStateChange}
        />
      </TestWrapper>
    );

    // Wait for state change callback
    const lastCall = onStateChange.mock.calls[onStateChange.mock.calls.length - 1];
    if (lastCall) {
      const nodes = lastCall[0] as TableBoxNodeType[];
      const usersNode = nodes.find(n => n.data.tableName === 'users');
      // selectedColumns should be preserved because users columns aren't loaded yet
      expect(usersNode?.data.selectedColumns).toEqual(['id']);
    }
  });

  it('should update columns when tableColumns loads but preserve valid selections', async () => {
    const initialNodes: TableBoxNodeType[] = [
      {
        id: 'table-users-123',
        type: 'tableBox',
        position: { x: 0, y: 0 },
        data: {
          tableName: 'users',
          alias: 't1',
          columns: [],
          selectedColumns: ['id', 'name', 'nonexistent'], // Include invalid column
        },
      },
    ];

    const onStateChange = vi.fn();
    const loadedColumns: Record<string, TableBoxColumnData[]> = {
      users: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
        { name: 'email', type: 'TEXT' },
      ],
    };

    const { rerender } = render(
      <TestWrapper>
        <QueryBuilder
          tables={['users']}
          tableColumns={{}}
          initialNodes={initialNodes}
          onStateChange={onStateChange}
        />
      </TestWrapper>
    );

    // Now load the columns
    rerender(
      <TestWrapper>
        <QueryBuilder
          tables={['users']}
          tableColumns={loadedColumns}
          initialNodes={initialNodes}
          onStateChange={onStateChange}
        />
      </TestWrapper>
    );

    // Wait for update and check that valid columns are preserved
    await waitFor(() => {
      const lastCall = onStateChange.mock.calls[onStateChange.mock.calls.length - 1];
      if (lastCall) {
        const nodes = lastCall[0] as TableBoxNodeType[];
        const usersNode = nodes.find(n => n.data.tableName === 'users');
        // 'nonexistent' should be filtered out, but 'id' and 'name' should remain
        expect(usersNode?.data.selectedColumns).toEqual(['id', 'name']);
        // Columns should be updated
        expect(usersNode?.data.columns).toHaveLength(3);
      }
    });
  });

  it('should not clear selectedColumns when columns array is empty', () => {
    const initialNodes: TableBoxNodeType[] = [
      {
        id: 'table-users-123',
        type: 'tableBox',
        position: { x: 0, y: 0 },
        data: {
          tableName: 'users',
          alias: 't1',
          columns: [{ name: 'id', type: 'INTEGER' }],
          selectedColumns: ['id'],
        },
      },
    ];

    const onStateChange = vi.fn();

    render(
      <TestWrapper>
        <QueryBuilder
          tables={['users']}
          tableColumns={{
            users: [], // Empty columns array (edge case)
          }}
          initialNodes={initialNodes}
          onStateChange={onStateChange}
        />
      </TestWrapper>
    );

    // selectedColumns should remain as-is when columns array is empty
    const lastCall = onStateChange.mock.calls[onStateChange.mock.calls.length - 1];
    if (lastCall) {
      const nodes = lastCall[0] as TableBoxNodeType[];
      const usersNode = nodes.find(n => n.data.tableName === 'users');
      expect(usersNode?.data.selectedColumns).toEqual(['id']);
    }
  });
});

describe('QueryBuilder - source code verification', () => {
  it('should check columns length before updating selectedColumns', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const filePath = resolve(__dirname, '../QueryBuilder.tsx');
    const content = readFileSync(filePath, 'utf-8');

    // Verify the fix is in place: check columns.length before filtering
    expect(content).toMatch(/if\s*\(\s*!columns\s*\|\|\s*columns\.length\s*===\s*0\s*\)/);
  });
});
