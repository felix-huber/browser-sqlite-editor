/**
 * ERD Layout Persistence
 *
 * Saves and loads ERD node positions, collapsed state, and viewport settings.
 *
 * Storage:
 * - Primary: OPFS sidecar at /wasm-sqlite-editor/databases/<db>.erd.json
 * - Fallback: localStorage keyed by database name (legacy, for migration)
 *
 * Migration:
 * - On first load, checks for existing localStorage key 'erd-layout:<db>'
 * - If found, migrates to OPFS sidecar and deletes localStorage entry
 * - One-time migration, idempotent
 *
 * Corrupt file handling:
 * - If .erd.json is missing or corrupt, returns not_found/invalid_json
 * - Caller should use auto-layout (no error shown to user)
 */

import { getStorageAdapter, toErdFilename } from './erd-storage-adapter';

/** Current schema version for migrations */
const CURRENT_VERSION = 1;

/** localStorage key prefix (legacy, for migration) */
const STORAGE_PREFIX = 'erd-layout:';

/** Node position and state */
export interface NodeLayout {
  x: number;
  y: number;
  collapsed?: boolean;
}

/** Viewport state */
export interface ViewportLayout {
  x: number;
  y: number;
  zoom: number;
}

/** Complete layout schema v1 */
export interface ERDLayoutV1 {
  version: 1;
  nodes: Record<string, NodeLayout>;
  viewport: ViewportLayout;
}

/** Union of all supported layout versions (for migration) */
export type ERDLayoutAny = ERDLayoutV1;

/** Result of loading layout */
export type LoadResult =
  | { ok: true; layout: ERDLayoutV1 }
  | { ok: false; reason: 'not_found' | 'invalid_json' | 'migration_failed' };

/**
 * Create an empty layout with default values
 */
export function createEmptyLayout(): ERDLayoutV1 {
  return {
    version: CURRENT_VERSION,
    nodes: {},
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/**
 * Get the localStorage key for a database (legacy)
 */
function getStorageKey(dbName: string): string {
  return `${STORAGE_PREFIX}${dbName}`;
}

/**
 * Get the ERD sidecar filename for a database
 */
function getErdFilename(dbName: string): string {
  return toErdFilename(dbName);
}

/**
 * Validate that a parsed object is a valid layout
 */
function isValidLayout(obj: unknown): obj is ERDLayoutAny {
  if (!obj || typeof obj !== 'object') return false;

  const layout = obj as Record<string, unknown>;

  // Check version exists and is a number
  if (typeof layout.version !== 'number') return false;

  // Check nodes object exists
  if (!layout.nodes || typeof layout.nodes !== 'object') return false;

  // Validate each node has x, y coordinates
  const nodes = layout.nodes as Record<string, unknown>;
  for (const [, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object') return false;
    const n = node as Record<string, unknown>;
    if (typeof n.x !== 'number' || typeof n.y !== 'number') return false;
  }

  // Check viewport object exists with required fields
  if (!layout.viewport || typeof layout.viewport !== 'object') return false;
  const viewport = layout.viewport as Record<string, unknown>;
  if (
    typeof viewport.x !== 'number' ||
    typeof viewport.y !== 'number' ||
    typeof viewport.zoom !== 'number'
  ) {
    return false;
  }

  return true;
}

/**
 * Migrate layout from older versions to current version
 * Returns null if migration is not possible
 */
function migrateLayout(layout: ERDLayoutAny): ERDLayoutV1 | null {
  // Currently only v1 exists, so just validate it's v1
  if (layout.version === 1) {
    return layout;
  }

  // Future migrations would go here:
  // if (layout.version === 2) { ... migrate v2 to current ... }

  // Unknown version, cannot migrate
  return null;
}

/**
 * Parse and validate layout JSON
 */
function parseLayout(json: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!isValidLayout(parsed)) {
    return { ok: false, reason: 'invalid_json' };
  }

  const migrated = migrateLayout(parsed);
  if (migrated === null) {
    return { ok: false, reason: 'migration_failed' };
  }

  return { ok: true, layout: migrated };
}

/**
 * Attempt to load layout from localStorage (legacy)
 */
function loadFromLocalStorage(dbName: string): LoadResult {
  const key = getStorageKey(dbName);
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) {
      return { ok: false, reason: 'not_found' };
    }
    return parseLayout(stored);
  } catch {
    return { ok: false, reason: 'not_found' };
  }
}

/**
 * Load layout from OPFS sidecar or localStorage (with migration)
 *
 * @param dbName - Database name (used as key)
 * @returns Load result with layout or error reason
 */
export async function loadLayout(dbName: string): Promise<LoadResult> {
  const adapter = getStorageAdapter();
  const opfsAvailable = await adapter.isOpfsAvailable();

  if (opfsAvailable) {
    // Try OPFS first
    try {
      const content = await adapter.readSidecar(dbName);
      if (content !== null) {
        const result = parseLayout(content);
        if (!result.ok) {
          console.warn(`ERD layout for "${dbName}" is corrupt, will use auto-layout`);
        }
        return result;
      }
    } catch (err) {
      console.warn(`Failed to read ERD layout from OPFS for "${dbName}":`, err);
    }

    // OPFS doesn't have it - check localStorage for migration
    const localStorageResult = loadFromLocalStorage(dbName);
    if (localStorageResult.ok) {
      // Migrate to OPFS
      try {
        await adapter.writeSidecar(dbName, JSON.stringify(localStorageResult.layout));
        // Clean up localStorage
        try {
          localStorage.removeItem(getStorageKey(dbName));
        } catch {
          // Ignore localStorage cleanup errors
        }
        return localStorageResult;
      } catch (err) {
        console.warn(`Failed to migrate ERD layout to OPFS for "${dbName}":`, err);
        return localStorageResult;
      }
    } else if (localStorageResult.reason !== 'not_found') {
      // localStorage has corrupt data - clean it up
      try {
        localStorage.removeItem(getStorageKey(dbName));
      } catch {
        // Ignore cleanup errors
      }
    }

    return { ok: false, reason: 'not_found' };
  }

  // Fallback to localStorage only
  return loadFromLocalStorage(dbName);
}

/**
 * Save layout to OPFS sidecar (or localStorage as fallback)
 *
 * @param dbName - Database name (used as key)
 * @param layout - Layout to save
 * @returns true if saved successfully, false otherwise
 */
export async function saveLayout(dbName: string, layout: ERDLayoutV1): Promise<boolean> {
  const adapter = getStorageAdapter();
  const opfsAvailable = await adapter.isOpfsAvailable();
  const json = JSON.stringify(layout);

  if (opfsAvailable) {
    try {
      await adapter.writeSidecar(dbName, json);
      return true;
    } catch (err) {
      console.error(`Failed to save ERD layout to OPFS for "${dbName}":`, err);
      return false;
    }
  }

  // Fallback to localStorage
  try {
    localStorage.setItem(getStorageKey(dbName), json);
    return true;
  } catch (err) {
    console.error(`Failed to save ERD layout to localStorage for "${dbName}":`, err);
    return false;
  }
}

/**
 * Delete layout from OPFS sidecar (and localStorage if exists)
 *
 * @param dbName - Database name
 */
export async function deleteLayout(dbName: string): Promise<void> {
  const adapter = getStorageAdapter();
  const opfsAvailable = await adapter.isOpfsAvailable();

  if (opfsAvailable) {
    try {
      await adapter.deleteSidecar(dbName);
    } catch (err) {
      console.warn(`Failed to delete ERD layout from OPFS for "${dbName}":`, err);
    }
  }

  // Also clean up localStorage (for migration cleanup)
  try {
    localStorage.removeItem(getStorageKey(dbName));
  } catch {
    // Ignore localStorage cleanup errors
  }
}

/**
 * Update node positions in a layout
 *
 * @param layout - Existing layout to update
 * @param nodes - Node positions to merge
 * @returns New layout with updated nodes
 */
export function updateNodes(
  layout: ERDLayoutV1,
  nodes: Record<string, NodeLayout>
): ERDLayoutV1 {
  return {
    ...layout,
    nodes: {
      ...layout.nodes,
      ...nodes,
    },
  };
}

/**
 * Update a single node position in a layout
 *
 * @param layout - Existing layout to update
 * @param tableName - Table name (node id)
 * @param position - New position
 * @returns New layout with updated node
 */
export function updateNodePosition(
  layout: ERDLayoutV1,
  tableName: string,
  position: { x: number; y: number }
): ERDLayoutV1 {
  return {
    ...layout,
    nodes: {
      ...layout.nodes,
      [tableName]: {
        ...layout.nodes[tableName],
        x: position.x,
        y: position.y,
      },
    },
  };
}

/**
 * Update node collapsed state in a layout
 *
 * @param layout - Existing layout to update
 * @param tableName - Table name (node id)
 * @param collapsed - Whether the node is collapsed
 * @returns New layout with updated node
 */
export function updateNodeCollapsed(
  layout: ERDLayoutV1,
  tableName: string,
  collapsed: boolean
): ERDLayoutV1 {
  return {
    ...layout,
    nodes: {
      ...layout.nodes,
      [tableName]: {
        ...layout.nodes[tableName],
        x: layout.nodes[tableName]?.x ?? 0,
        y: layout.nodes[tableName]?.y ?? 0,
        collapsed,
      },
    },
  };
}

/**
 * Update viewport in a layout
 *
 * @param layout - Existing layout to update
 * @param viewport - New viewport state
 * @returns New layout with updated viewport
 */
export function updateViewport(
  layout: ERDLayoutV1,
  viewport: ViewportLayout
): ERDLayoutV1 {
  return {
    ...layout,
    viewport,
  };
}

/**
 * Remove nodes that no longer exist in the schema
 *
 * @param layout - Existing layout
 * @param existingTables - Array of table names that still exist
 * @returns New layout with only existing tables
 */
export function pruneRemovedNodes(
  layout: ERDLayoutV1,
  existingTables: string[]
): ERDLayoutV1 {
  const existingSet = new Set(existingTables);
  const prunedNodes: Record<string, NodeLayout> = {};

  for (const [tableName, node] of Object.entries(layout.nodes)) {
    if (existingSet.has(tableName)) {
      prunedNodes[tableName] = node;
    }
  }

  return {
    ...layout,
    nodes: prunedNodes,
  };
}

// =============================================================================
// Exports for testing
// =============================================================================

export const _testing = {
  CURRENT_VERSION,
  STORAGE_PREFIX,
  getStorageKey,
  getErdFilename,
  isValidLayout,
  migrateLayout,
  parseLayout,
  loadFromLocalStorage,
};
