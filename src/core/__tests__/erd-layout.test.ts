import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadLayout,
  saveLayout,
  deleteLayout,
  createEmptyLayout,
  updateNodePosition,
  updateNodeCollapsed,
  updateViewport,
  updateNodes,
  pruneRemovedNodes,
  type ERDLayoutV1,
} from '../erd/erd-layout';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
});

describe('erd-layout', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('createEmptyLayout', () => {
    it('should return a valid empty layout with version 1', () => {
      const layout = createEmptyLayout();
      expect(layout.version).toBe(1);
      expect(layout.nodes).toEqual({});
      expect(layout.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    });
  });

  describe('saveLayout', () => {
    it('should save layout to localStorage with correct key', () => {
      const layout: ERDLayoutV1 = {
        version: 1,
        nodes: { users: { x: 100, y: 200 } },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const result = saveLayout('mydb', layout);

      expect(result).toBe(true);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'erd-layout:mydb',
        JSON.stringify(layout)
      );
    });

    it('should return false when localStorage throws', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('Quota exceeded');
      });

      const layout = createEmptyLayout();
      const result = saveLayout('mydb', layout);

      expect(result).toBe(false);
    });
  });

  describe('loadLayout', () => {
    it('should return not_found for missing layout', () => {
      const result = loadLayout('nonexistent');

      expect(result).toEqual({ ok: false, reason: 'not_found' });
    });

    it('should load saved layout and return coordinates', () => {
      const layout: ERDLayoutV1 = {
        version: 1,
        nodes: {
          users: { x: 100, y: 200 },
          orders: { x: 300, y: 400, collapsed: true },
        },
        viewport: { x: 50, y: 75, zoom: 1.5 },
      };

      localStorageMock.setItem('erd-layout:testdb', JSON.stringify(layout));

      const result = loadLayout('testdb');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.layout.nodes.users).toEqual({ x: 100, y: 200 });
        expect(result.layout.nodes.orders).toEqual({
          x: 300,
          y: 400,
          collapsed: true,
        });
        expect(result.layout.viewport).toEqual({ x: 50, y: 75, zoom: 1.5 });
      }
    });

    it('should return invalid_json for malformed JSON', () => {
      localStorageMock.setItem('erd-layout:baddb', 'not valid json{');

      const result = loadLayout('baddb');

      expect(result).toEqual({ ok: false, reason: 'invalid_json' });
    });

    it('should return invalid_json for missing version', () => {
      localStorageMock.setItem(
        'erd-layout:baddb',
        JSON.stringify({ nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } })
      );

      const result = loadLayout('baddb');

      expect(result).toEqual({ ok: false, reason: 'invalid_json' });
    });

    it('should return invalid_json for missing nodes object', () => {
      localStorageMock.setItem(
        'erd-layout:baddb',
        JSON.stringify({ version: 1, viewport: { x: 0, y: 0, zoom: 1 } })
      );

      const result = loadLayout('baddb');

      expect(result).toEqual({ ok: false, reason: 'invalid_json' });
    });

    it('should return invalid_json for missing viewport', () => {
      localStorageMock.setItem(
        'erd-layout:baddb',
        JSON.stringify({ version: 1, nodes: {} })
      );

      const result = loadLayout('baddb');

      expect(result).toEqual({ ok: false, reason: 'invalid_json' });
    });

    it('should return invalid_json for node with missing coordinates', () => {
      localStorageMock.setItem(
        'erd-layout:baddb',
        JSON.stringify({
          version: 1,
          nodes: { users: { x: 100 } }, // missing y
          viewport: { x: 0, y: 0, zoom: 1 },
        })
      );

      const result = loadLayout('baddb');

      expect(result).toEqual({ ok: false, reason: 'invalid_json' });
    });

    it('should return migration_failed for unsupported version', () => {
      localStorageMock.setItem(
        'erd-layout:futuredb',
        JSON.stringify({
          version: 999,
          nodes: {},
          viewport: { x: 0, y: 0, zoom: 1 },
        })
      );

      const result = loadLayout('futuredb');

      expect(result).toEqual({ ok: false, reason: 'migration_failed' });
    });
  });

  describe('deleteLayout', () => {
    it('should remove layout from localStorage', () => {
      saveLayout('mydb', createEmptyLayout());
      deleteLayout('mydb');

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('erd-layout:mydb');
    });
  });

  describe('updateNodePosition', () => {
    it('should update position for existing node', () => {
      const layout: ERDLayoutV1 = {
        version: 1,
        nodes: { users: { x: 0, y: 0 } },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const updated = updateNodePosition(layout, 'users', { x: 150, y: 250 });

      expect(updated.nodes.users.x).toBe(150);
      expect(updated.nodes.users.y).toBe(250);
      // Original should be unchanged (immutability)
      expect(layout.nodes.users.x).toBe(0);
    });

    it('should add position for new node', () => {
      const layout = createEmptyLayout();

      const updated = updateNodePosition(layout, 'products', { x: 500, y: 600 });

      expect(updated.nodes.products).toEqual({ x: 500, y: 600 });
    });

    it('should preserve collapsed state when updating position', () => {
      const layout: ERDLayoutV1 = {
        version: 1,
        nodes: { users: { x: 0, y: 0, collapsed: true } },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const updated = updateNodePosition(layout, 'users', { x: 100, y: 200 });

      expect(updated.nodes.users.collapsed).toBe(true);
    });
  });

  describe('updateNodeCollapsed', () => {
    it('should set collapsed state for existing node', () => {
      const layout: ERDLayoutV1 = {
        version: 1,
        nodes: { users: { x: 100, y: 200 } },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const updated = updateNodeCollapsed(layout, 'users', true);

      expect(updated.nodes.users.collapsed).toBe(true);
      expect(updated.nodes.users.x).toBe(100);
      expect(updated.nodes.users.y).toBe(200);
    });

    it('should create node with default position if not exists', () => {
      const layout = createEmptyLayout();

      const updated = updateNodeCollapsed(layout, 'orders', true);

      expect(updated.nodes.orders).toEqual({ x: 0, y: 0, collapsed: true });
    });
  });

  describe('updateViewport', () => {
    it('should update viewport state', () => {
      const layout = createEmptyLayout();

      const updated = updateViewport(layout, { x: 100, y: 200, zoom: 2 });

      expect(updated.viewport).toEqual({ x: 100, y: 200, zoom: 2 });
      // Original unchanged
      expect(layout.viewport.zoom).toBe(1);
    });
  });

  describe('updateNodes', () => {
    it('should merge multiple node positions', () => {
      const layout: ERDLayoutV1 = {
        version: 1,
        nodes: { users: { x: 0, y: 0 } },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const updated = updateNodes(layout, {
        users: { x: 100, y: 100 },
        orders: { x: 200, y: 200 },
      });

      expect(updated.nodes.users).toEqual({ x: 100, y: 100 });
      expect(updated.nodes.orders).toEqual({ x: 200, y: 200 });
    });
  });

  describe('pruneRemovedNodes', () => {
    it('should remove nodes not in existing tables', () => {
      const layout: ERDLayoutV1 = {
        version: 1,
        nodes: {
          users: { x: 0, y: 0 },
          orders: { x: 100, y: 100 },
          deleted_table: { x: 200, y: 200 },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const pruned = pruneRemovedNodes(layout, ['users', 'orders']);

      expect(pruned.nodes).toEqual({
        users: { x: 0, y: 0 },
        orders: { x: 100, y: 100 },
      });
      expect(pruned.nodes.deleted_table).toBeUndefined();
    });

    it('should preserve all nodes when all tables exist', () => {
      const layout: ERDLayoutV1 = {
        version: 1,
        nodes: {
          users: { x: 0, y: 0 },
          orders: { x: 100, y: 100 },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const pruned = pruneRemovedNodes(layout, ['users', 'orders', 'products']);

      expect(pruned.nodes).toEqual(layout.nodes);
    });

    it('should return empty nodes when no tables exist', () => {
      const layout: ERDLayoutV1 = {
        version: 1,
        nodes: { users: { x: 0, y: 0 } },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const pruned = pruneRemovedNodes(layout, []);

      expect(pruned.nodes).toEqual({});
    });
  });
});
