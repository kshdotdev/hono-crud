import type { Context, Env } from 'hono';
import type {
  VersionHistoryEntry,
  NormalizedVersioningConfig,
  AuditFieldChange,
} from './types';
import { calculateChanges, getVersioningConfig, type VersioningConfig } from './types';
import { createRegistryWithDefault } from '../storage/registry';

/**
 * Interface for version history storage adapters.
 * Implement this to store version history in your preferred storage.
 */
export interface VersioningStorage {
  /**
   * Save a version history entry.
   */
  save(entry: VersionHistoryEntry): Promise<void>;

  /**
   * Get all versions for a specific record.
   */
  getByRecordId(
    tableName: string,
    recordId: string | number,
    options?: { limit?: number; offset?: number }
  ): Promise<VersionHistoryEntry[]>;

  /**
   * Get a specific version of a record.
   */
  getVersion(
    tableName: string,
    recordId: string | number,
    version: number
  ): Promise<VersionHistoryEntry | null>;

  /**
   * Get the latest version number for a record.
   */
  getLatestVersion(
    tableName: string,
    recordId: string | number
  ): Promise<number>;

  /**
   * Delete old versions when maxVersions is exceeded.
   */
  pruneVersions?(
    tableName: string,
    recordId: string | number,
    keepCount: number
  ): Promise<number>;

  /**
   * Delete all versions for a record (for hard delete).
   */
  deleteAllVersions?(
    tableName: string,
    recordId: string | number
  ): Promise<number>;
}

/**
 * In-memory version history storage for testing.
 */
export class MemoryVersioningStorage implements VersioningStorage {
  private versions: Map<string, VersionHistoryEntry[]> = new Map();

  /**
   * Get a unique key for a record.
   */
  private getKey(tableName: string, recordId: string | number): string {
    return `${tableName}:${recordId}`;
  }

  async save(entry: VersionHistoryEntry): Promise<void> {
    const key = this.getKey(
      (entry as VersionHistoryEntry & { tableName: string }).tableName ||
        entry.id.split(':')[0] ||
        'unknown',
      entry.recordId
    );

    // Store tableName in the entry for retrieval
    const entryWithTable = {
      ...entry,
      tableName: key.split(':')[0],
    };

    const existing = this.versions.get(key) || [];
    existing.push(entryWithTable as VersionHistoryEntry);
    this.versions.set(key, existing);
  }

  /**
   * Store a version with explicit tableName.
   */
  async store(
    tableName: string,
    entry: VersionHistoryEntry
  ): Promise<void> {
    const key = this.getKey(tableName, entry.recordId);
    const existing = this.versions.get(key) || [];
    existing.push({ ...entry, tableName } as VersionHistoryEntry & { tableName: string });
    this.versions.set(key, existing);
  }

  async getByRecordId(
    tableName: string,
    recordId: string | number,
    options?: { limit?: number; offset?: number }
  ): Promise<VersionHistoryEntry[]> {
    const key = this.getKey(tableName, recordId);
    const versions = this.versions.get(key) || [];

    // Sort by version descending (newest first)
    const sorted = [...versions].sort((a, b) => b.version - a.version);

    const offset = options?.offset || 0;
    const limit = options?.limit || sorted.length;

    return sorted.slice(offset, offset + limit);
  }

  async getVersion(
    tableName: string,
    recordId: string | number,
    version: number
  ): Promise<VersionHistoryEntry | null> {
    const key = this.getKey(tableName, recordId);
    const versions = this.versions.get(key) || [];
    return versions.find((v) => v.version === version) || null;
  }

  async getLatestVersion(
    tableName: string,
    recordId: string | number
  ): Promise<number> {
    const key = this.getKey(tableName, recordId);
    const versions = this.versions.get(key) || [];

    if (versions.length === 0) {
      return 0;
    }

    return Math.max(...versions.map((v) => v.version));
  }

  async pruneVersions(
    tableName: string,
    recordId: string | number,
    keepCount: number
  ): Promise<number> {
    const key = this.getKey(tableName, recordId);
    const versions = this.versions.get(key) || [];

    if (versions.length <= keepCount) {
      return 0;
    }

    // Sort by version descending and keep the newest
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    const toKeep = sorted.slice(0, keepCount);
    const deleted = sorted.length - toKeep.length;

    this.versions.set(key, toKeep);
    return deleted;
  }

  async deleteAllVersions(
    tableName: string,
    recordId: string | number
  ): Promise<number> {
    const key = this.getKey(tableName, recordId);
    const versions = this.versions.get(key) || [];
    const count = versions.length;

    this.versions.delete(key);
    return count;
  }

  /**
   * Get all versions (for testing).
   */
  getAllVersions(): VersionHistoryEntry[] {
    const all: VersionHistoryEntry[] = [];
    for (const versions of this.versions.values()) {
      all.push(...versions);
    }
    return all;
  }

  /**
   * Clear all versions (for testing).
   */
  clear(): void {
    this.versions.clear();
  }
}

/**
 * Global versioning storage registry.
 * Uses lazy initialization -- the default MemoryVersioningStorage is only
 * created when first accessed.
 */
export const versioningStorageRegistry = createRegistryWithDefault<VersioningStorage>(
  'versioningStorage',
  () => new MemoryVersioningStorage()
);

/**
 * Set the global versioning storage.
 */
export function setVersioningStorage(storage: VersioningStorage): void {
  versioningStorageRegistry.set(storage);
}

/**
 * Get the global versioning storage.
 */
export function getVersioningStorage(): VersioningStorage {
  return versioningStorageRegistry.getRequired();
}

/**
 * Version manager class for handling versioning operations.
 */
export class VersionManager {
  private config: NormalizedVersioningConfig;
  private storage: VersioningStorage;
  private tableName: string;

  constructor(
    config: VersioningConfig | undefined,
    tableName: string,
    storage?: VersioningStorage,
    ctx?: Context<Env>
  ) {
    this.config = getVersioningConfig(config, tableName);
    this.tableName = tableName;
    // Resolve storage with priority: explicit > context > global (via registry)
    this.storage = versioningStorageRegistry.resolve(ctx, storage) ?? versioningStorageRegistry.getRequired();
  }

  /**
   * Check if versioning is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the version field name.
   */
  getVersionField(): string {
    return this.config.field;
  }

  /**
   * Get the history table name.
   */
  getHistoryTable(): string {
    return this.config.historyTable;
  }

  /**
   * Save a version snapshot before an update.
   * Returns the new version number.
   */
  async saveVersion(
    recordId: string | number,
    currentData: Record<string, unknown>,
    previousData?: Record<string, unknown>,
    changedBy?: string,
    changeReason?: string
  ): Promise<number> {
    if (!this.isEnabled()) {
      return (currentData[this.config.field] as number) || 1;
    }

    // Get current version number
    const currentVersion = (currentData[this.config.field] as number) || 0;
    const newVersion = currentVersion + 1;

    // Calculate changes if previous data is available
    let changes: AuditFieldChange[] | undefined;
    if (previousData) {
      changes = calculateChanges(previousData, currentData, this.config.excludeFields);
    }

    // Filter out excluded fields from the snapshot
    const dataSnapshot = this.filterFields(currentData);

    // Create history entry
    const entry: VersionHistoryEntry = {
      id: crypto.randomUUID(),
      recordId,
      version: currentVersion, // Store the version BEFORE the update
      data: dataSnapshot,
      createdAt: new Date(),
      changes,
    };

    if (this.config.trackChangedBy && changedBy) {
      entry.changedBy = changedBy;
    }

    if (changeReason) {
      entry.changeReason = changeReason;
    }

    // Save to storage
    if ('store' in this.storage && typeof this.storage.store === 'function') {
      await (this.storage as MemoryVersioningStorage).store(this.tableName, entry);
    } else {
      await this.storage.save(entry);
    }

    // Prune old versions if maxVersions is set
    if (this.config.maxVersions && this.storage.pruneVersions) {
      await this.storage.pruneVersions(
        this.tableName,
        recordId,
        this.config.maxVersions
      );
    }

    return newVersion;
  }

  /**
   * Get all versions for a record.
   */
  async getVersions(
    recordId: string | number,
    options?: { limit?: number; offset?: number }
  ): Promise<VersionHistoryEntry[]> {
    return this.storage.getByRecordId(this.tableName, recordId, options);
  }

  /**
   * Get a specific version of a record.
   */
  async getVersion(
    recordId: string | number,
    version: number
  ): Promise<VersionHistoryEntry | null> {
    return this.storage.getVersion(this.tableName, recordId, version);
  }

  /**
   * Get the data for a specific version.
   */
  async getVersionData<T = Record<string, unknown>>(
    recordId: string | number,
    version: number
  ): Promise<T | null> {
    const entry = await this.getVersion(recordId, version);
    return entry ? (entry.data as T) : null;
  }

  /**
   * Get the latest version number for a record.
   */
  async getLatestVersion(recordId: string | number): Promise<number> {
    return this.storage.getLatestVersion(this.tableName, recordId);
  }

  /**
   * Compare two versions and return the differences.
   */
  async compareVersions(
    recordId: string | number,
    versionA: number,
    versionB: number
  ): Promise<AuditFieldChange[]> {
    const [entryA, entryB] = await Promise.all([
      this.getVersion(recordId, versionA),
      this.getVersion(recordId, versionB),
    ]);

    if (!entryA || !entryB) {
      return [];
    }

    return calculateChanges(
      entryA.data,
      entryB.data,
      this.config.excludeFields
    );
  }

  /**
   * Delete all versions for a record.
   */
  async deleteAllVersions(recordId: string | number): Promise<number> {
    if (this.storage.deleteAllVersions) {
      return this.storage.deleteAllVersions(this.tableName, recordId);
    }
    return 0;
  }

  /**
   * Filter out excluded fields from a record.
   */
  private filterFields(record: Record<string, unknown>): Record<string, unknown> {
    if (this.config.excludeFields.length === 0) {
      return record;
    }

    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (!this.config.excludeFields.includes(key)) {
        filtered[key] = value;
      }
    }
    return filtered;
  }
}

/**
 * Create a version manager for a model.
 *
 * @param config - Versioning configuration
 * @param tableName - Name of the table/model
 * @param storage - Optional explicit storage instance
 * @param ctx - Optional Hono context for context-based storage resolution
 * @returns VersionManager instance
 *
 * @example
 * ```ts
 * // Using global storage
 * const manager = createVersionManager(config, 'users');
 *
 * // Using context-based storage
 * const manager = createVersionManager(config, 'users', undefined, ctx);
 *
 * // Using explicit storage
 * const manager = createVersionManager(config, 'users', myStorage);
 * ```
 */
export function createVersionManager(
  config: VersioningConfig | undefined,
  tableName: string,
  storage?: VersioningStorage,
  ctx?: Context<Env>
): VersionManager {
  return new VersionManager(config, tableName, storage, ctx);
}
