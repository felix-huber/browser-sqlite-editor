/**
 * ERD Layout Persistence
 *
 * Saves and loads ERD node positions, collapsed state, and viewport settings.
 * Uses localStorage keyed by database name with migration support.
 */

/** Current schema version for migrations */
const CURRENT_VERSION = 1;

/** localStorage key prefix */
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
 * Get the localStorage key for a database
 */
function getStorageKey(dbName: string): string {
  return `${STORAGE_PREFIX}${dbName}`;
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
 * Load layout from localStorage for a database
 *
 * @param dbName - Database name (used as key)
 * @returns Load result with layout or error reason
 */
export function loadLayout(dbName: string): LoadResult {
  const key = getStorageKey(dbName);

  try {
    const stored = localStorage.getItem(key);

    if (stored === null) {
      return { ok: false, reason: 'not_found' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      console.warn(`ERD layout for "${dbName}" contains invalid JSON`);
      return { ok: false, reason: 'invalid_json' };
    }

    if (!isValidLayout(parsed)) {
      console.warn(`ERD layout for "${dbName}" has invalid structure`);
      return { ok: false, reason: 'invalid_json' };
    }

    const migrated = migrateLayout(parsed);
    if (migrated === null) {
      console.warn(
        `ERD layout for "${dbName}" version ${parsed.version} cannot be migrated`
      );
      return { ok: false, reason: 'migration_failed' };
    }

    return { ok: true, layout: migrated };
  } catch (error) {
    console.warn(`Failed to load ERD layout for "${dbName}":`, error);
    return { ok: false, reason: 'invalid_json' };
  }
}

/**
 * Save layout to localStorage for a database
 *
 * @param dbName - Database name (used as key)
 * @param layout - Layout to save
 * @returns true if saved successfully, false otherwise
 */
export function saveLayout(dbName: string, layout: ERDLayoutV1): boolean {
  const key = getStorageKey(dbName);

  try {
    const json = JSON.stringify(layout);
    localStorage.setItem(key, json);
    return true;
  } catch (error) {
    console.error(`Failed to save ERD layout for "${dbName}":`, error);
    return false;
  }
}

/**
 * Delete layout from localStorage for a database
 *
 * @param dbName - Database name
 */
export function deleteLayout(dbName: string): void {
  const key = getStorageKey(dbName);
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn(`Failed to delete ERD layout for "${dbName}":`, error);
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
