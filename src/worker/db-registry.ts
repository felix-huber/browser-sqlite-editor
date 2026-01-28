/**
 * Database Registry Management
 *
 * Manages a registry of all known databases with CRUD operations and self-healing.
 *
 * Storage:
 * - Primary: OPFS /sqlite-editor/registry.json
 * - Fallback: IndexedDB "sqlite-editor-registry" store
 *
 * Schema: { databases: [{ id, name, createdAt, lastOpenedAt, storageType }] }
 *
 * Self-healing:
 * - Validates registry against actual OPFS/IDB contents on load
 * - Removes orphaned entries (registry entry but no actual file)
 * - Discovers unregistered files (file exists but not in registry)
 * - Repairs corrupted JSON by resetting to empty array
 */

import type { StorageMode } from '../types';

// =============================================================================
// Constants
// =============================================================================

/** OPFS directory for SQLite editor */
const OPFS_DIR = '/sqlite-editor';

/** OPFS registry file path */
const OPFS_REGISTRY_PATH = `${OPFS_DIR}/registry.json`;

/** IndexedDB database name for registry fallback */
const IDB_REGISTRY_DB = 'sqlite-editor-registry';

/** IndexedDB store name for registry */
const IDB_REGISTRY_STORE = 'registry';

/** IndexedDB version */
const IDB_VERSION = 1;

// =============================================================================
// Types
// =============================================================================

/**
 * Registry entry for a database
 */
export interface RegistryEntry {
  /** Unique identifier for the database */
  id: string;
  /** Display name of the database */
  name: string;
  /** ISO 8601 timestamp when the database was created */
  createdAt: string;
  /** ISO 8601 timestamp when the database was last opened */
  lastOpenedAt: string;
  /** Storage type: 'opfs' or 'idb' */
  storageType: StorageMode;
}

/**
 * Registry data structure
 */
export interface RegistryData {
  databases: RegistryEntry[];
}

/**
 * Patch for updating a database entry
 */
export type RegistryPatch = Partial<Pick<RegistryEntry, 'name' | 'lastOpenedAt'>>;

/**
 * Result of self-healing operation
 */
export interface HealingResult {
  /** Orphaned entries removed (registry had entry, no file existed) */
  orphansRemoved: string[];
  /** Discovered entries added (file existed, no registry entry) */
  discovered: string[];
  /** Whether JSON was corrupted and reset */
  wasCorrupted: boolean;
}

/**
 * Storage adapter interface for dependency injection
 */
export interface StorageAdapter {
  isOpfsAvailable: () => Promise<boolean>;
  readRegistry: (mode: StorageMode) => Promise<RegistryData | null>;
  writeRegistry: (mode: StorageMode, data: RegistryData) => Promise<void>;
  listFiles: (mode: StorageMode) => Promise<string[]>;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a unique ID for a new database entry
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Get current ISO 8601 timestamp
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Derive filename from database name
 */
function toFilename(name: string): string {
  // Sanitize name for filesystem
  const sanitized = name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .toLowerCase();
  return `${sanitized}.sqlite`;
}

// =============================================================================
// OPFS Operations
// =============================================================================

/**
 * Check if OPFS is available
 */
async function isOpfsAvailable(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false;
    if (!navigator.storage?.getDirectory) return false;
    await navigator.storage.getDirectory();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get or create the OPFS root directory for sqlite-editor
 */
async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('sqlite-editor', { create: true });
}

/**
 * Read registry from OPFS
 */
async function readOpfsRegistry(): Promise<RegistryData | null> {
  try {
    const dir = await getOpfsRoot();
    const file = await dir.getFileHandle('registry.json');
    const blob = await file.getFile();
    const text = await blob.text();
    return JSON.parse(text) as RegistryData;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return null;
    }
    throw err;
  }
}

/**
 * Write registry to OPFS
 */
async function writeOpfsRegistry(data: RegistryData): Promise<void> {
  const dir = await getOpfsRoot();
  const file = await dir.getFileHandle('registry.json', { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(JSON.stringify(data, null, 2));
  } finally {
    await writable.close();
  }
}

/**
 * List all database files in OPFS
 */
async function listOpfsFiles(): Promise<string[]> {
  const files: string[] = [];
  try {
    const dir = await getOpfsRoot();
    // Cast to AsyncIterable to work with the iterator
    const entries = (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)[Symbol.asyncIterator]();
    for await (const [name, handle] of { [Symbol.asyncIterator]: () => entries }) {
      if (handle.kind === 'file' && name.endsWith('.sqlite')) {
        files.push(name);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  return files;
}

/**
 * Check if a database file exists in OPFS
 */
async function opfsFileExists(filename: string): Promise<boolean> {
  try {
    const dir = await getOpfsRoot();
    await dir.getFileHandle(filename);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// IndexedDB Operations
// =============================================================================

/**
 * Open the IndexedDB registry database
 */
function openIdbRegistry(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_REGISTRY_DB, IDB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_REGISTRY_STORE)) {
        db.createObjectStore(IDB_REGISTRY_STORE, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Read registry from IndexedDB
 */
async function readIdbRegistry(): Promise<RegistryData | null> {
  const db = await openIdbRegistry();
  try {
    const tx = db.transaction(IDB_REGISTRY_STORE, 'readonly');
    const store = tx.objectStore(IDB_REGISTRY_STORE);

    return new Promise((resolve, reject) => {
      const request = store.get('registry');
      request.onsuccess = () => {
        const result = request.result as { key: string; data: RegistryData } | undefined;
        resolve(result?.data ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Write registry to IndexedDB
 */
async function writeIdbRegistry(data: RegistryData): Promise<void> {
  const db = await openIdbRegistry();
  try {
    const tx = db.transaction(IDB_REGISTRY_STORE, 'readwrite');
    const store = tx.objectStore(IDB_REGISTRY_STORE);

    await new Promise<void>((resolve, reject) => {
      const request = store.put({ key: 'registry', data });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * List all database keys in the IDB databases store
 */
async function listIdbDatabases(): Promise<string[]> {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('idb-sqlite', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        if (!database.objectStoreNames.contains('databases')) {
          database.createObjectStore('databases', { keyPath: 'name' });
        }
      };
    });

    try {
      const tx = db.transaction('databases', 'readonly');
      const store = tx.objectStore('databases');

      const names = await new Promise<string[]>((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result as string[]);
        request.onerror = () => reject(request.error);
      });

      return names;
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
 * Check if a database exists in IDB
 */
async function idbDatabaseExists(name: string): Promise<boolean> {
  const databases = await listIdbDatabases();
  return databases.includes(name);
}

// =============================================================================
// Default Storage Adapter
// =============================================================================

/**
 * Default storage adapter using real OPFS/IDB
 */
const defaultStorageAdapter: StorageAdapter = {
  isOpfsAvailable,
  readRegistry: async (mode) => {
    return mode === 'opfs' ? readOpfsRegistry() : readIdbRegistry();
  },
  writeRegistry: async (mode, data) => {
    if (mode === 'opfs') {
      await writeOpfsRegistry(data);
    } else {
      await writeIdbRegistry(data);
    }
  },
  listFiles: async (mode) => {
    return mode === 'opfs' ? listOpfsFiles() : listIdbDatabases();
  },
};

// =============================================================================
// DatabaseRegistry Class
// =============================================================================

/**
 * Database Registry Manager
 *
 * Provides CRUD operations for database metadata and self-healing on load.
 */
export class DatabaseRegistry {
  private data: RegistryData = { databases: [] };
  private storageMode: StorageMode = 'idb';
  private initialized = false;
  private adapter: StorageAdapter;

  constructor(adapter?: StorageAdapter) {
    this.adapter = adapter ?? defaultStorageAdapter;
  }

  /**
   * Initialize the registry
   *
   * - Detects storage mode (OPFS or IDB)
   * - Loads registry from storage
   * - Runs self-healing
   */
  async init(): Promise<HealingResult> {
    const opfsAvailable = await this.adapter.isOpfsAvailable();
    this.storageMode = opfsAvailable ? 'opfs' : 'idb';

    const healingResult = await this.loadAndHeal();
    this.initialized = true;
    return healingResult;
  }

  /**
   * Get current storage mode
   */
  getStorageMode(): StorageMode {
    return this.storageMode;
  }

  /**
   * Load registry and run self-healing
   */
  private async loadAndHeal(): Promise<HealingResult> {
    const result: HealingResult = {
      orphansRemoved: [],
      discovered: [],
      wasCorrupted: false,
    };

    // Load registry data
    try {
      const rawData = await this.adapter.readRegistry(this.storageMode);

      if (rawData) {
        this.data = rawData;
      } else {
        this.data = { databases: [] };
      }
    } catch {
      // JSON parse error or other corruption
      result.wasCorrupted = true;
      this.data = { databases: [] };
    }

    // Validate registry structure
    if (!this.data || !Array.isArray(this.data.databases)) {
      result.wasCorrupted = true;
      this.data = { databases: [] };
    }

    // Get actual files
    const actualFiles = await this.adapter.listFiles(this.storageMode);

    // Find orphans (registry has entry, no file)
    const validEntries: RegistryEntry[] = [];
    for (const entry of this.data.databases) {
      const filename = this.storageMode === 'opfs'
        ? toFilename(entry.name)
        : entry.name;

      const exists = actualFiles.includes(filename);
      if (exists) {
        validEntries.push(entry);
      } else {
        result.orphansRemoved.push(entry.id);
      }
    }

    // Find discovered files (file exists, no registry entry)
    const registeredNames = new Set(
      this.data.databases.map((e) =>
        this.storageMode === 'opfs' ? toFilename(e.name) : e.name
      )
    );

    for (const filename of actualFiles) {
      if (!registeredNames.has(filename)) {
        // Derive name from filename
        const name = filename.replace(/\.sqlite$/, '').replace(/_/g, ' ');
        const newEntry: RegistryEntry = {
          id: generateId(),
          name,
          createdAt: now(),
          lastOpenedAt: now(),
          storageType: this.storageMode,
        };
        validEntries.push(newEntry);
        result.discovered.push(newEntry.id);
      }
    }

    // Update registry with healed data
    this.data.databases = validEntries;

    // Persist if any changes were made
    if (result.wasCorrupted || result.orphansRemoved.length > 0 || result.discovered.length > 0) {
      await this.save();
    }

    return result;
  }

  /**
   * Save registry to storage
   */
  private async save(): Promise<void> {
    await this.adapter.writeRegistry(this.storageMode, this.data);
  }

  /**
   * List all registered databases
   */
  listDatabases(): RegistryEntry[] {
    return [...this.data.databases];
  }

  /**
   * Register a new database
   *
   * @param name Display name for the database
   * @param storageType Storage mode (defaults to current mode)
   * @returns The new database ID
   */
  async registerDatabase(name: string, storageType?: StorageMode): Promise<string> {
    const id = generateId();
    const timestamp = now();

    const entry: RegistryEntry = {
      id,
      name,
      createdAt: timestamp,
      lastOpenedAt: timestamp,
      storageType: storageType ?? this.storageMode,
    };

    this.data.databases.push(entry);
    await this.save();

    return id;
  }

  /**
   * Update a database entry
   *
   * @param id Database ID to update
   * @param patch Fields to update
   * @returns true if updated, false if not found
   */
  async updateDatabase(id: string, patch: RegistryPatch): Promise<boolean> {
    const entry = this.data.databases.find((e) => e.id === id);
    if (!entry) {
      return false;
    }

    if (patch.name !== undefined) {
      entry.name = patch.name;
    }
    if (patch.lastOpenedAt !== undefined) {
      entry.lastOpenedAt = patch.lastOpenedAt;
    }

    await this.save();
    return true;
  }

  /**
   * Remove a database from the registry
   *
   * @param id Database ID to remove
   * @returns true if removed, false if not found
   */
  async removeDatabase(id: string): Promise<boolean> {
    const index = this.data.databases.findIndex((e) => e.id === id);
    if (index === -1) {
      return false;
    }

    this.data.databases.splice(index, 1);
    await this.save();
    return true;
  }

  /**
   * Get a database entry by ID
   *
   * @param id Database ID
   * @returns The entry or null if not found
   */
  getDatabaseById(id: string): RegistryEntry | null {
    return this.data.databases.find((e) => e.id === id) ?? null;
  }

  /**
   * Get a database entry by name
   *
   * @param name Database name
   * @returns The entry or null if not found
   */
  getDatabaseByName(name: string): RegistryEntry | null {
    return this.data.databases.find((e) => e.name === name) ?? null;
  }

  /**
   * Update last opened timestamp for a database
   *
   * @param id Database ID
   */
  async touchDatabase(id: string): Promise<void> {
    await this.updateDatabase(id, { lastOpenedAt: now() });
  }

  /**
   * Check if a database name is already registered
   */
  hasDatabase(name: string): boolean {
    return this.data.databases.some((e) => e.name === name);
  }

  /**
   * Get count of registered databases
   */
  count(): number {
    return this.data.databases.length;
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Force reload registry from storage
   */
  async reload(): Promise<HealingResult> {
    return this.loadAndHeal();
  }

  /**
   * Clear all entries (for testing)
   */
  async clear(): Promise<void> {
    this.data.databases = [];
    await this.save();
  }
}

// =============================================================================
// Module-level Singleton
// =============================================================================

let _registryInstance: DatabaseRegistry | null = null;

/**
 * Get the singleton registry instance
 */
export function getRegistry(): DatabaseRegistry {
  if (!_registryInstance) {
    _registryInstance = new DatabaseRegistry();
  }
  return _registryInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetRegistry(): void {
  _registryInstance = null;
}

// =============================================================================
// Exports for testing
// =============================================================================

export const _testing = {
  OPFS_DIR,
  OPFS_REGISTRY_PATH,
  IDB_REGISTRY_DB,
  IDB_REGISTRY_STORE,
  IDB_VERSION,
  generateId,
  now,
  toFilename,
  isOpfsAvailable,
  readOpfsRegistry,
  writeOpfsRegistry,
  listOpfsFiles,
  opfsFileExists,
  readIdbRegistry,
  writeIdbRegistry,
  listIdbDatabases,
  idbDatabaseExists,
  defaultStorageAdapter,
};
