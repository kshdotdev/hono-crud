import type { LoggingStorage, LogEntry, LogQueryOptions, PathPattern } from '../types';
import { matchPath } from '../utils';

/**
 * Options for MemoryLoggingStorage.
 */
export interface MemoryLoggingStorageOptions {
  /**
   * Maximum number of log entries to store.
   * When exceeded, oldest entries are removed.
   * @default 10000
   */
  maxEntries?: number;

  /**
   * Maximum age of log entries in milliseconds.
   * Entries older than this are automatically cleaned up.
   * Set to 0 to disable age-based cleanup.
   * @default 86400000 (24 hours)
   */
  maxAge?: number;

  /**
   * Minimum interval between automatic cleanup runs (ms).
   * Cleanup is performed lazily on access rather than via background timers,
   * making this compatible with edge runtimes (Cloudflare Workers, Deno, Bun).
   * Set to 0 to disable automatic cleanup.
   * @default 300000 (5 minutes)
   */
  cleanupInterval?: number;
}

/**
 * In-memory logging storage implementation.
 * Ideal for development, testing, and single-instance deployments.
 *
 * Features:
 * - Configurable max entries with automatic cleanup
 * - Age-based expiration
 * - Rich query support with filtering, sorting, and pagination
 *
 * Note: This storage is not shared across processes/instances.
 * Use a database or external storage for multi-instance deployments.
 *
 * Cleanup is performed lazily on access (no background timers),
 * making this compatible with edge runtimes like Cloudflare Workers.
 *
 * @example
 * ```ts
 * import { MemoryLoggingStorage, setLoggingStorage } from 'hono-crud';
 *
 * const storage = new MemoryLoggingStorage({
 *   maxEntries: 5000,
 *   maxAge: 3600000, // 1 hour
 * });
 * setLoggingStorage(storage);
 * ```
 */
export class MemoryLoggingStorage implements LoggingStorage {
  /** Entries stored by ID */
  private entriesById = new Map<string, LogEntry>();

  /** Ordered list of entry IDs (newest first for efficient pagination) */
  private entryIds: string[] = [];

  /** Maximum entries to store */
  private maxEntries: number;

  /** Maximum age in milliseconds */
  private maxAge: number;

  /** Minimum interval between cleanup runs (ms) */
  private cleanupInterval: number;

  /** Timestamp of last cleanup run */
  private lastCleanup: number = 0;

  constructor(options?: MemoryLoggingStorageOptions) {
    this.maxEntries = options?.maxEntries ?? 10000;
    this.maxAge = options?.maxAge ?? 86400000; // 24 hours
    this.cleanupInterval = options?.cleanupInterval ?? 300000; // 5 minutes
  }

  /**
   * Runs age-based cleanup if enough time has passed since last cleanup.
   * Called lazily on access to avoid background timers.
   */
  private maybeCleanup(): void {
    if (this.cleanupInterval <= 0 || this.maxAge <= 0) return;
    const now = Date.now();
    if (now - this.lastCleanup >= this.cleanupInterval) {
      this.lastCleanup = now;
      this.deleteOlderThanSync(this.maxAge);
    }
  }

  /**
   * Synchronous version of deleteOlderThan for use in lazy cleanup.
   */
  private deleteOlderThanSync(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let deleted = 0;

    for (let i = this.entryIds.length - 1; i >= 0; i--) {
      const id = this.entryIds[i];
      const entry = this.entriesById.get(id);

      if (entry) {
        const entryTime = new Date(entry.timestamp).getTime();
        if (entryTime < cutoff) {
          this.entriesById.delete(id);
          this.entryIds.splice(i, 1);
          deleted++;
        } else {
          break;
        }
      }
    }

    return deleted;
  }

  /**
   * Store a log entry.
   */
  async store(entry: LogEntry): Promise<void> {
    this.maybeCleanup();
    // Enforce max entries limit
    while (this.entryIds.length >= this.maxEntries) {
      const oldestId = this.entryIds.pop();
      if (oldestId) {
        this.entriesById.delete(oldestId);
      }
    }

    // Add new entry
    this.entriesById.set(entry.id, entry);
    this.entryIds.unshift(entry.id); // Add to front (newest first)
  }

  /**
   * Query log entries with filtering and pagination.
   */
  async query(options?: LogQueryOptions): Promise<LogEntry[]> {
    this.maybeCleanup();
    let entries = this.getFilteredEntries(options);

    // Sort
    if (options?.sort) {
      const { field, direction } = options.sort;
      entries = entries.sort((a, b) => {
        let aVal: number;
        let bVal: number;

        switch (field) {
          case 'timestamp':
            aVal = new Date(a.timestamp).getTime();
            bVal = new Date(b.timestamp).getTime();
            break;
          case 'responseTimeMs':
            aVal = a.response.responseTimeMs;
            bVal = b.response.responseTimeMs;
            break;
          case 'statusCode':
            aVal = a.response.statusCode;
            bVal = b.response.statusCode;
            break;
          default:
            return 0;
        }

        return direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }

    // Pagination
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? entries.length;

    return entries.slice(offset, offset + limit);
  }

  /**
   * Get a single log entry by ID.
   */
  async getById(id: string): Promise<LogEntry | null> {
    return this.entriesById.get(id) ?? null;
  }

  /**
   * Count log entries matching the query.
   */
  async count(options?: LogQueryOptions): Promise<number> {
    return this.getFilteredEntries(options).length;
  }

  /**
   * Delete log entries older than a given age.
   */
  async deleteOlderThan(maxAgeMs: number): Promise<number> {
    return this.deleteOlderThanSync(maxAgeMs);
  }

  /**
   * Clear all log entries.
   */
  async clear(): Promise<number> {
    const count = this.entriesById.size;
    this.entriesById.clear();
    this.entryIds = [];
    return count;
  }

  /**
   * Destroy the storage and clear all data.
   */
  destroy(): void {
    this.entriesById.clear();
    this.entryIds = [];
  }

  /**
   * Get the number of entries (for debugging/monitoring).
   */
  getSize(): number {
    return this.entriesById.size;
  }

  /**
   * Get filtered entries based on query options.
   */
  private getFilteredEntries(options?: LogQueryOptions): LogEntry[] {
    if (!options) {
      return Array.from(this.entriesById.values());
    }

    const entries: LogEntry[] = [];

    for (const id of this.entryIds) {
      const entry = this.entriesById.get(id);
      if (!entry) continue;

      // Filter by level
      if (options.level) {
        const levels = Array.isArray(options.level) ? options.level : [options.level];
        if (!levels.includes(entry.level)) continue;
      }

      // Filter by method
      if (options.method) {
        const methods = Array.isArray(options.method) ? options.method : [options.method];
        if (!methods.map((m) => m.toUpperCase()).includes(entry.request.method.toUpperCase()))
          continue;
      }

      // Filter by path pattern
      if (options.path) {
        if (!matchPath(entry.request.path, options.path as PathPattern)) continue;
      }

      // Filter by status code range
      if (options.statusCode) {
        const { min, max } = options.statusCode;
        const status = entry.response.statusCode;
        if (min !== undefined && status < min) continue;
        if (max !== undefined && status > max) continue;
      }

      // Filter by time range
      if (options.timeRange) {
        const entryTime = new Date(entry.timestamp).getTime();
        const { start, end } = options.timeRange;

        if (start) {
          const startTime = typeof start === 'string' ? new Date(start).getTime() : start.getTime();
          if (entryTime < startTime) continue;
        }

        if (end) {
          const endTime = typeof end === 'string' ? new Date(end).getTime() : end.getTime();
          if (entryTime > endTime) continue;
        }
      }

      // Filter by user ID
      if (options.userId && entry.request.userId !== options.userId) continue;

      // Filter by client IP
      if (options.clientIp && entry.request.clientIp !== options.clientIp) continue;

      // Filter by request ID
      if (options.requestId && entry.id !== options.requestId) continue;

      // Filter by error message
      if (options.errorMessage) {
        if (
          !entry.error?.message ||
          !entry.error.message.toLowerCase().includes(options.errorMessage.toLowerCase())
        ) {
          continue;
        }
      }

      entries.push(entry);
    }

    return entries;
  }
}
