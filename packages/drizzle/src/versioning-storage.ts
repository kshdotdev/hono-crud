import { and, desc, eq, lt } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { VersionHistoryEntry, VersioningStorage } from 'hono-crud/versioning';
import {
  type DrizzleColumn,
  type DrizzleDatabaseConstraint,
  type DrizzleTable,
  cast,
  getColumn,
} from './helpers';

/**
 * The row shape DrizzleVersioningStorage reads/writes. The history table must
 * expose these column *property* names (the DB column names are free — see
 * {@link sqliteVersionHistoryTable}). One table can back many models: rows are
 * discriminated by `resourceTable` (the model's tableName), so a single global
 * storage instance keyed via `setVersioningStorage()` serves every versioned
 * resource.
 */
interface VersionHistoryRow {
  id: string;
  /** The versioned model's tableName — the discriminator for a shared table. */
  resourceTable: string;
  recordId: string;
  version: number;
  /** JSON-serialized record snapshot. */
  data: string;
  /** Epoch milliseconds. */
  createdAt: number;
  changedBy: string | null;
  changeReason: string | null;
  /** JSON-serialized AuditFieldChange[]. */
  changes: string | null;
}

export interface DrizzleVersioningStorageOptions {
  /** Any Drizzle database handle (D1/libsql/postgres-js/…). */
  db: DrizzleDatabaseConstraint;
  /**
   * The history table. Must have the property names of {@link VersionHistoryRow}
   * (`id`, `resourceTable`, `recordId`, `version`, `data`, `createdAt`,
   * `changedBy`, `changeReason`, `changes`). Use {@link sqliteVersionHistoryTable}
   * for D1/SQLite, or define your own for another dialect.
   */
  table: DrizzleTable;
}

/**
 * Durable {@link VersioningStorage} backed by Drizzle — the persistent
 * counterpart to the in-memory `MemoryVersioningStorage`, suitable for
 * Cloudflare D1 and any other Drizzle-supported database. Version snapshots
 * survive across isolates/requests (unlike the memory store, which is
 * per-isolate).
 *
 * @remarks
 * The record snapshot (`entry.data`) is persisted with `JSON.stringify` and
 * rehydrated with `JSON.parse`, so non-JSON values inside it are stored in
 * their JSON form — e.g. a nested `Date` comes back as an ISO string, not a
 * `Date` (unlike `MemoryVersioningStorage`, which keeps the object by
 * reference). The entry's own `createdAt` is exempt: stored as epoch
 * milliseconds and rehydrated to a `Date`.
 *
 * @example
 * ```ts
 * import { DrizzleVersioningStorage, sqliteVersionHistoryTable } from '@hono-crud/drizzle';
 * import { setVersioningStorage } from 'hono-crud/versioning';
 *
 * const versionHistory = sqliteVersionHistoryTable();
 * const db = drizzle(env.DB);
 * setVersioningStorage(new DrizzleVersioningStorage({ db, table: versionHistory }));
 * ```
 */
export class DrizzleVersioningStorage implements VersioningStorage {
  private readonly db: DrizzleDatabaseConstraint;
  private readonly table: DrizzleTable;

  constructor(options: DrizzleVersioningStorageOptions) {
    this.db = options.db;
    this.table = options.table;
  }

  private col(field: keyof VersionHistoryRow): DrizzleColumn {
    return getColumn(this.table, field);
  }

  private recordScope(tableName: string, recordId: string | number) {
    return and(
      eq(this.col('resourceTable'), tableName),
      eq(this.col('recordId'), String(recordId)),
    );
  }

  private toEntry(row: VersionHistoryRow): VersionHistoryEntry {
    return {
      id: row.id,
      recordId: row.recordId,
      version: row.version,
      data: JSON.parse(row.data),
      createdAt: new Date(row.createdAt),
      ...(row.changedBy != null ? { changedBy: row.changedBy } : {}),
      ...(row.changeReason != null ? { changeReason: row.changeReason } : {}),
      ...(row.changes != null ? { changes: JSON.parse(row.changes) } : {}),
    };
  }

  async store(tableName: string, entry: VersionHistoryEntry): Promise<void> {
    const createdAt = entry.createdAt instanceof Date ? entry.createdAt : new Date(entry.createdAt);
    await cast<VersionHistoryRow>(this.db)
      .insert(this.table)
      .values({
        id: entry.id,
        resourceTable: tableName,
        recordId: String(entry.recordId),
        version: entry.version,
        data: JSON.stringify(entry.data),
        createdAt: createdAt.getTime(),
        changedBy: entry.changedBy ?? null,
        changeReason: entry.changeReason ?? null,
        changes: entry.changes ? JSON.stringify(entry.changes) : null,
      } satisfies VersionHistoryRow);
  }

  async getByRecordId(
    tableName: string,
    recordId: string | number,
    options?: { limit?: number; offset?: number },
  ): Promise<VersionHistoryEntry[]> {
    let query = cast<VersionHistoryRow>(this.db)
      .select()
      .from(this.table)
      .where(this.recordScope(tableName, recordId))
      .orderBy(desc(this.col('version')));

    // SQLite/D1 reject OFFSET without a LIMIT, and drizzle omits the LIMIT
    // clause for negative values, so when only an offset is given we pass an
    // effectively-unbounded LIMIT. Mirrors MemoryVersioningStorage, which reads
    // a bare offset as "from N onward".
    if (options?.limit != null || options?.offset != null) {
      query = query.limit(options?.limit ?? Number.MAX_SAFE_INTEGER);
    }
    if (options?.offset != null) query = query.offset(options.offset);

    const rows = await query;
    return rows.map((row) => this.toEntry(row));
  }

  async getVersion(
    tableName: string,
    recordId: string | number,
    version: number,
  ): Promise<VersionHistoryEntry | null> {
    const rows = await cast<VersionHistoryRow>(this.db)
      .select()
      .from(this.table)
      .where(and(this.recordScope(tableName, recordId), eq(this.col('version'), version)))
      .limit(1);

    return rows.length > 0 ? this.toEntry(rows[0]) : null;
  }

  async getLatestVersion(tableName: string, recordId: string | number): Promise<number> {
    const rows = await cast<VersionHistoryRow>(this.db)
      .select()
      .from(this.table)
      .where(this.recordScope(tableName, recordId))
      .orderBy(desc(this.col('version')))
      .limit(1);

    return rows.length > 0 ? rows[0].version : 0;
  }

  async pruneVersions(
    tableName: string,
    recordId: string | number,
    keepCount: number,
  ): Promise<number> {
    // keepCount <= 0 means "keep nothing" — delete every version (matches
    // MemoryVersioningStorage). Guard first so existing[keepCount - 1] below is
    // always a valid index.
    if (keepCount <= 0) return this.deleteAllVersions(tableName, recordId);

    // Fetch newest-first, keep the top `keepCount`, delete anything older than
    // the smallest kept version. Versions are monotonic per record, so a single
    // `version < threshold` predicate is exact.
    const existing = await this.getByRecordId(tableName, recordId);
    if (existing.length <= keepCount) return 0;

    const threshold = existing[keepCount - 1].version;
    const deleted = await cast<VersionHistoryRow>(this.db)
      .delete(this.table)
      .where(and(this.recordScope(tableName, recordId), lt(this.col('version'), threshold)))
      .returning();

    return deleted.length;
  }

  async deleteAllVersions(tableName: string, recordId: string | number): Promise<number> {
    const deleted = await cast<VersionHistoryRow>(this.db)
      .delete(this.table)
      .where(this.recordScope(tableName, recordId))
      .returning();

    return deleted.length;
  }
}

/**
 * Build a SQLite/D1 history table with the columns
 * {@link DrizzleVersioningStorage} expects. `recordId`/`resourceTable`/`version`
 * are indexed for the per-record lookups the storage performs.
 *
 * @param name - Table name. Default `version_history`.
 */
export function sqliteVersionHistoryTable(name = 'version_history') {
  return sqliteTable(name, {
    id: text('id').primaryKey(),
    resourceTable: text('resource_table').notNull(),
    recordId: text('record_id').notNull(),
    version: integer('version').notNull(),
    data: text('data').notNull(),
    createdAt: integer('created_at').notNull(),
    changedBy: text('changed_by'),
    changeReason: text('change_reason'),
    changes: text('changes'),
  });
}
