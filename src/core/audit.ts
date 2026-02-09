import type { Context, Env } from 'hono';
import type {
  AuditAction,
  AuditLogEntry,
  AuditFieldChange,
  NormalizedAuditConfig,
} from './types';
import { calculateChanges, getAuditConfig, type AuditConfig } from './types';
import { createRegistryWithDefault } from '../storage/registry';

/**
 * Interface for audit log storage adapters.
 * Implement this to store audit logs in your preferred storage.
 */
export interface AuditLogStorage {
  /**
   * Store an audit log entry.
   */
  store(entry: AuditLogEntry): Promise<void>;

  /**
   * Retrieve audit logs for a specific record.
   */
  getByRecordId?(
    tableName: string,
    recordId: string | number,
    options?: { limit?: number; offset?: number }
  ): Promise<AuditLogEntry[]>;

  /**
   * Retrieve all audit logs with optional filtering.
   */
  getAll?(options?: {
    tableName?: string;
    action?: AuditAction;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogEntry[]>;
}

/**
 * In-memory audit log storage for testing.
 */
export class MemoryAuditLogStorage implements AuditLogStorage {
  private logs: AuditLogEntry[] = [];

  async store(entry: AuditLogEntry): Promise<void> {
    this.logs.push(entry);
  }

  async getByRecordId(
    tableName: string,
    recordId: string | number,
    options?: { limit?: number; offset?: number }
  ): Promise<AuditLogEntry[]> {
    const filtered = this.logs.filter(
      (log) => log.tableName === tableName && log.recordId === recordId
    );

    const offset = options?.offset || 0;
    const limit = options?.limit || filtered.length;

    return filtered.slice(offset, offset + limit);
  }

  async getAll(options?: {
    tableName?: string;
    action?: AuditAction;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogEntry[]> {
    let filtered = [...this.logs];

    if (options?.tableName) {
      filtered = filtered.filter((log) => log.tableName === options.tableName);
    }
    if (options?.action) {
      filtered = filtered.filter((log) => log.action === options.action);
    }
    if (options?.userId) {
      filtered = filtered.filter((log) => log.userId === options.userId);
    }
    if (options?.startDate) {
      filtered = filtered.filter((log) => log.timestamp >= options.startDate!);
    }
    if (options?.endDate) {
      filtered = filtered.filter((log) => log.timestamp <= options.endDate!);
    }

    const offset = options?.offset || 0;
    const limit = options?.limit || filtered.length;

    return filtered.slice(offset, offset + limit);
  }

  /**
   * Get all logs (for testing).
   */
  getAllLogs(): AuditLogEntry[] {
    return [...this.logs];
  }

  /**
   * Clear all logs (for testing).
   */
  clear(): void {
    this.logs = [];
  }
}

/**
 * Global audit log storage registry.
 * Uses lazy initialization -- the default MemoryAuditLogStorage is only
 * created when first accessed, avoiding unnecessary allocations on
 * edge runtimes where audit may not be used.
 */
export const auditStorageRegistry = createRegistryWithDefault<AuditLogStorage>(
  'auditStorage',
  () => new MemoryAuditLogStorage()
);

/**
 * Set the global audit log storage.
 */
export function setAuditStorage(storage: AuditLogStorage): void {
  auditStorageRegistry.set(storage);
}

/**
 * Get the global audit log storage.
 */
export function getAuditStorage(): AuditLogStorage {
  return auditStorageRegistry.getRequired();
}

/**
 * Audit logger class for creating audit log entries.
 */
export class AuditLogger {
  private config: NormalizedAuditConfig;
  private storage: AuditLogStorage;

  constructor(config: AuditConfig | undefined, storage?: AuditLogStorage, ctx?: Context<Env>) {
    this.config = getAuditConfig(config);
    // Resolve storage with priority: explicit > context > global (via registry)
    this.storage = auditStorageRegistry.resolve(ctx, storage) ?? auditStorageRegistry.getRequired();
  }

  /**
   * Check if audit logging is enabled for an action.
   */
  isEnabled(action: AuditAction): boolean {
    return this.config.enabled && this.config.actions.includes(action);
  }

  /**
   * Log a create operation.
   */
  async logCreate(
    tableName: string,
    recordId: string | number,
    record: Record<string, unknown>,
    userId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.isEnabled('create')) return;

    const entry = this.createEntry(
      'create',
      tableName,
      recordId,
      userId,
      metadata
    );

    if (this.config.storeRecord) {
      entry.record = this.filterFields(record);
    }

    await this.storage.store(entry);
  }

  /**
   * Log an update operation.
   */
  async logUpdate(
    tableName: string,
    recordId: string | number,
    previousRecord: Record<string, unknown>,
    newRecord: Record<string, unknown>,
    userId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.isEnabled('update')) return;

    const entry = this.createEntry(
      'update',
      tableName,
      recordId,
      userId,
      metadata
    );

    if (this.config.storeRecord) {
      entry.record = this.filterFields(newRecord);
    }

    if (this.config.storePreviousRecord) {
      entry.previousRecord = this.filterFields(previousRecord);
    }

    if (this.config.trackChanges) {
      entry.changes = calculateChanges(
        previousRecord,
        newRecord,
        this.config.excludeFields
      );
    }

    await this.storage.store(entry);
  }

  /**
   * Log a delete operation.
   */
  async logDelete(
    tableName: string,
    recordId: string | number,
    previousRecord: Record<string, unknown>,
    userId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.isEnabled('delete')) return;

    const entry = this.createEntry(
      'delete',
      tableName,
      recordId,
      userId,
      metadata
    );

    if (this.config.storePreviousRecord) {
      entry.previousRecord = this.filterFields(previousRecord);
    }

    await this.storage.store(entry);
  }

  /**
   * Log a restore operation.
   */
  async logRestore(
    tableName: string,
    recordId: string | number,
    record: Record<string, unknown>,
    userId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.isEnabled('restore')) return;

    const entry = this.createEntry(
      'restore',
      tableName,
      recordId,
      userId,
      metadata
    );

    if (this.config.storeRecord) {
      entry.record = this.filterFields(record);
    }

    await this.storage.store(entry);
  }

  /**
   * Log an upsert operation.
   */
  async logUpsert(
    tableName: string,
    recordId: string | number,
    record: Record<string, unknown>,
    previousRecord: Record<string, unknown> | undefined,
    created: boolean,
    userId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.isEnabled('upsert')) return;

    const entry = this.createEntry(
      'upsert',
      tableName,
      recordId,
      userId,
      { ...metadata, created }
    );

    if (this.config.storeRecord) {
      entry.record = this.filterFields(record);
    }

    if (this.config.storePreviousRecord && previousRecord) {
      entry.previousRecord = this.filterFields(previousRecord);
    }

    if (this.config.trackChanges && previousRecord) {
      entry.changes = calculateChanges(
        previousRecord,
        record,
        this.config.excludeFields
      );
    }

    await this.storage.store(entry);
  }

  /**
   * Log a batch operation.
   */
  async logBatch(
    action: AuditAction,
    tableName: string,
    records: Array<{
      recordId: string | number;
      record?: Record<string, unknown>;
      previousRecord?: Record<string, unknown>;
    }>,
    userId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.isEnabled(action)) return;

    for (const item of records) {
      const entry = this.createEntry(
        action,
        tableName,
        item.recordId,
        userId,
        metadata
      );

      if (this.config.storeRecord && item.record) {
        entry.record = this.filterFields(item.record);
      }

      if (this.config.storePreviousRecord && item.previousRecord) {
        entry.previousRecord = this.filterFields(item.previousRecord);
      }

      if (this.config.trackChanges && item.previousRecord && item.record) {
        entry.changes = calculateChanges(
          item.previousRecord,
          item.record,
          this.config.excludeFields
        );
      }

      await this.storage.store(entry);
    }
  }

  /**
   * Create a base audit log entry.
   */
  private createEntry(
    action: AuditAction,
    tableName: string,
    recordId: string | number,
    userId?: string,
    metadata?: Record<string, unknown>
  ): AuditLogEntry {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      action,
      tableName,
      recordId,
      userId,
      metadata,
    };
  }

  /**
   * Filter out excluded fields from a record.
   */
  private filterFields(
    record: Record<string, unknown>
  ): Record<string, unknown> {
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
 * Create an audit logger for a model.
 *
 * @param config - Audit configuration
 * @param storage - Optional explicit storage instance
 * @param ctx - Optional Hono context for context-based storage resolution
 * @returns AuditLogger instance or null if disabled
 *
 * @example
 * ```ts
 * // Using global storage
 * const logger = createAuditLogger(config);
 *
 * // Using context-based storage
 * const logger = createAuditLogger(config, undefined, ctx);
 *
 * // Using explicit storage
 * const logger = createAuditLogger(config, myStorage);
 * ```
 */
export function createAuditLogger(
  config: AuditConfig | undefined,
  storage?: AuditLogStorage,
  ctx?: Context<Env>
): AuditLogger {
  // Defer storage resolution to enable context-based lookup
  // The AuditLogger constructor will use resolveAuditStorage internally
  return new AuditLogger(config, storage, ctx);
}
