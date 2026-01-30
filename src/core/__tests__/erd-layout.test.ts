import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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
  _testing,
  type ERDLayoutV1,
} from '../erd/erd-layout';

// =============================================================================
// Mock OPFS Filesystem
// =============================================================================

interface MockOpfsState {
  files: Map<string, string>; // filename -> content
  available: boolean;
}

let mockOpfsState: MockOpfsState;
let mockLocalStorage: Map<string, string>;

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn((key: string) => mockLocalStorage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    mockLocalStorage.delete(key);
  }),
};

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
});

/**
 * Convert database name to ERD sidecar filename
 * (duplicated from erd-storage-adapter for mock)
 */
function toErdFilenameImpl(dbName: string): string {
  const sanitized = dbName
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .toLowerCase();
  return `${sanitized}.erd.json`;
}

// Mock OPFS via the storage adapter
vi.mock('../erd/erd-storage-adapter', () => ({
  toErdFilename: (dbName: string) => toErdFilenameImpl(dbName),
  getStorageAdapter: () => ({
    isOpfsAvailable: () => Promise.resolve(mockOpfsState.available),
    readSidecar: async (dbName: string) => {
      const filename = toErdFilenameImpl(dbName);
      const content = mockOpfsState.files.get(filename);
      return content ?? null;
    },
    writeSidecar: async (dbName: string, content: string) => {
      const filename = toErdFilenameImpl(dbName);
      mockOpfsState.files.set(filename, content);
    },
    deleteSidecar: async (dbName: string) => {
      const filename = toErdFilenameImpl(dbName);
      mockOpfsState.files.delete(filename);
    },
  }),
}));

// =============================================================================
// Test Setup/Teardown
// =============================================================================

beforeEach(() => {
  mockOpfsState = {
    files: new Map(),
    available: true,
  };
  mockLocalStorage = new Map();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Pure Function Tests (Sync, No Storage)
// =============================================================================

describe('erd-layout pure functions', () => {
  describe('createEmptyLayout', () => {
    it('should return a valid empty layout with version 1', () => {
      const layout = createEmptyLayout();
      expect(layout.version).toBe(1);
      expect(layout.nodes).toEqual({});
      expect(layout.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
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

// =============================================================================
// OPFS Storage Tests (Async)
// =============================================================================

describe('erd-layout OPFS storage', () => {
  describe('saveLayout', () => {
    it('should save layout to OPFS sidecar when OPFS is available', async () => {
      const layout: ERDLayoutV1 = {
        version: 1,
        nodes: { users: { x: 100, y: 200 } },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const result = await saveLayout('mydb', layout);

      expect(result).toBe(true);
      const filename = _testing.getErdFilename('mydb');
      expect(mockOpfsState.files.has(filename)).toBe(true);
      const saved = JSON.parse(mockOpfsState.files.get(filename)!);
      expect(saved.nodes.users).toEqual({ x: 100, y: 200 });
    });

    it('should fall back to localStorage when OPFS is unavailable', async () => {
      mockOpfsState.available = false;

      const layout: ERDLayoutV1 = {
        version: 1,
        nodes: { users: { x: 100, y: 200 } },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const result = await saveLayout('mydb', layout);

      expect(result).toBe(true);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'erd-layout:mydb',
        JSON.stringify(layout)
      );
    });
  });

  describe('loadLayout', () => {
    it('should load layout from OPFS sidecar', async () => {
      const layout: ERDLayoutV1 = {
        version: 1,
        nodes: {
          users: { x: 100, y: 200 },
          orders: { x: 300, y: 400, collapsed: true },
        },
        viewport: { x: 50, y: 75, zoom: 1.5 },
      };

      const filename = _testing.getErdFilename('testdb');
      mockOpfsState.files.set(filename, JSON.stringify(layout));

      const result = await loadLayout('testdb');

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

    it('should return not_found for missing layout', async () => {
      const result = await loadLayout('nonexistent');

      expect(result).toEqual({ ok: false, reason: 'not_found' });
    });

    it('should return invalid_json for malformed JSON (auto-layout)', async () => {
      const filename = _testing.getErdFilename('baddb');
      mockOpfsState.files.set(filename, 'not valid json{');

      const result = await loadLayout('baddb');

      expect(result).toEqual({ ok: false, reason: 'invalid_json' });
    });

    it('should return invalid_json for missing version', async () => {
      const filename = _testing.getErdFilename('baddb');
      mockOpfsState.files.set(
        filename,
        JSON.stringify({ nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } })
      );

      const result = await loadLayout('baddb');

      expect(result).toEqual({ ok: false, reason: 'invalid_json' });
    });

    it('should return migration_failed for unsupported version', async () => {
      const filename = _testing.getErdFilename('futuredb');
      mockOpfsState.files.set(
        filename,
        JSON.stringify({
          version: 999,
          nodes: {},
          viewport: { x: 0, y: 0, zoom: 1 },
        })
      );

      const result = await loadLayout('futuredb');

      expect(result).toEqual({ ok: false, reason: 'migration_failed' });
    });
  });

  describe('deleteLayout', () => {
    it('should delete layout from OPFS sidecar', async () => {
      const filename = _testing.getErdFilename('mydb');
      mockOpfsState.files.set(filename, JSON.stringify(createEmptyLayout()));

      await deleteLayout('mydb');

      expect(mockOpfsState.files.has(filename)).toBe(false);
    });
  });
});

// =============================================================================
// localStorage Migration Tests
// =============================================================================

describe('erd-layout localStorage migration', () => {
  it('should migrate layout from localStorage to OPFS on first access', async () => {
    const layout: ERDLayoutV1 = {
      version: 1,
      nodes: { users: { x: 100, y: 200 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    // Set up localStorage entry (simulating old data)
    mockLocalStorage.set('erd-layout:olddb', JSON.stringify(layout));

    // Load should migrate from localStorage to OPFS
    const result = await loadLayout('olddb');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout.nodes.users).toEqual({ x: 100, y: 200 });
    }

    // Should be migrated to OPFS
    const filename = _testing.getErdFilename('olddb');
    expect(mockOpfsState.files.has(filename)).toBe(true);

    // Should be removed from localStorage
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('erd-layout:olddb');
  });

  it('should not migrate if OPFS already has layout', async () => {
    const opfsLayout: ERDLayoutV1 = {
      version: 1,
      nodes: { users: { x: 500, y: 600 } },
      viewport: { x: 0, y: 0, zoom: 2 },
    };

    const localStorageLayout: ERDLayoutV1 = {
      version: 1,
      nodes: { users: { x: 100, y: 200 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    // Both OPFS and localStorage have data
    const filename = _testing.getErdFilename('mydb');
    mockOpfsState.files.set(filename, JSON.stringify(opfsLayout));
    mockLocalStorage.set('erd-layout:mydb', JSON.stringify(localStorageLayout));

    const result = await loadLayout('mydb');

    // Should use OPFS data (not migrate from localStorage)
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout.nodes.users).toEqual({ x: 500, y: 600 });
    }

    // localStorage should NOT be touched
    expect(localStorageMock.removeItem).not.toHaveBeenCalled();
  });

  it('should handle corrupt localStorage during migration gracefully', async () => {
    // Set up corrupt localStorage entry
    mockLocalStorage.set('erd-layout:corruptdb', 'invalid json{');

    // Load should handle gracefully and return not_found
    const result = await loadLayout('corruptdb');

    expect(result).toEqual({ ok: false, reason: 'not_found' });

    // Should still clean up localStorage
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('erd-layout:corruptdb');
  });
});

// =============================================================================
// Path Construction Tests
// =============================================================================

describe('erd-layout path construction', () => {
  it('should generate correct ERD filename for simple name', () => {
    const filename = _testing.getErdFilename('mydb');
    expect(filename).toBe('mydb.erd.json');
  });

  it('should normalize database name in filename', () => {
    const filename = _testing.getErdFilename('My Database');
    expect(filename).toBe('my_database.erd.json');
  });
});
