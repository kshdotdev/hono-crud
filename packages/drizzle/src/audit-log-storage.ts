import { type BuildColumns, asc, eq, gte, lte } from 'drizzle-orm';
import {
  type SQLiteTableExtraConfigValue,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import type { AuditAction, AuditLogEntry, AuditLogStorage } from 'hono-crud/internal';
import {
  type DrizzleColumn,
  type DrizzleDatabaseConstraint,
  type DrizzleSql,
  type DrizzleTable,
  and,
  cast,
  getColumn,
} from './helpers';

/**
 * The row shape DrizzleAuditLogStorage reads/writes. The audit table must
 * expose these column *property* names (the DB column names are free — see
 * {@link sqliteAuditLogTable}). One table can back many models: rows are
 * discriminated by `tableName` (the model's tableName), so a single global
 * storage instance wired via `setAuditStorage()` serves every audited model.
 */
interface AuditLogRow {
  id: string;
  /** The audited model's tableName — the discriminator for a shared table. */
  tableName: string;
  recordId: string;
  action: AuditAction;
  /** Epoch milliseconds. */
  timestamp: number;
  userId: string | null;
  /** JSON-serialized post-change record snapshot. */
  record: string | null;
  /** JSON-serialized pre-change record snapshot. */
  previousRecord: string | null;
  /** JSON-serialized AuditFieldChange[]. */
  changes: string | null;
  /** JSON-serialized metadata bag. */
  metadata: string | null;
}

export interface DrizzleAuditLogStorageOptions {
  /** Any Drizzle database handle (D1/libsql/postgres-js/…). */
  db: DrizzleDatabaseConstraint;
  /**
   * The audit table. Must have the property names of {@link AuditLogRow}
   * (`id`, `tableName`, `recordId`, `action`, `timestamp`, `userId`, `record`,
   * `previousRecord`, `changes`, `metadata`). Use {@link sqliteAuditLogTable}
   * for D1/SQLite, or define your own for another dialect.
   */
  table: DrizzleTable;
}

/**
 * Durable {@link AuditLogStorage} backed by Drizzle — the persistent
 * counterpart to the in-memory `MemoryAuditLogStorage`, suitable for
 * Cloudflare D1 and any other Drizzle-supported database. Audit entries survive
 * across isolates/requests (unlike the memory store, which is per-isolate).
 *
 * @remarks
 * JSON payloads (`record`, `previousRecord`, `changes`, `metadata`) are
 * persisted with `JSON.stringify` and rehydrated with `JSON.parse`, so non-JSON
 * values inside them are stored in their JSON form (e.g. a nested `Date` comes
 * back as an ISO string) — an encrypted `{ ct, iv, v }` envelope round-trips
 * untouched. The entry's own `timestamp` is stored as epoch milliseconds and
 * rehydrated to a `Date`. `recordId` is persisted as text (`String(recordId)`),
 * so a numeric `recordId` reads back as a string — mirroring
 * `DrizzleVersioningStorage`.
 *
 * Semantics track `MemoryAuditLogStorage` exactly: `getAll` combines every
 * filter with AND; the date range is inclusive on both ends (`>= startDate`,
 * `<= endDate`); results are returned oldest-first; `limit`/`offset` slice the
 * result, and a falsy `limit` (0 or absent) means "all remaining". The one
 * documented divergence: memory returns strict insertion order, while this
 * store orders by `timestamp` ascending with a secondary `id` ascending
 * tiebreaker — identical to memory whenever timestamps are distinct (the common
 * case, since entries are stamped at write time). For same-millisecond ties the
 * two diverge: memory yields insertion order, this store yields timestamp-then-id
 * (deterministic, not necessarily insertion order). The `id` tiebreaker is what
 * makes it deterministic at all — SQLite would otherwise break ties by rowid but
 * Postgres tie order is unspecified, so without a unique secondary key, LIMIT/
 * OFFSET pagination across a same-millisecond batch could duplicate or skip rows
 * between pages.
 *
 * @example
 * ```ts
 * import { DrizzleAuditLogStorage, sqliteAuditLogTable } from '@hono-crud/drizzle';
 * import { setAuditStorage } from 'hono-crud/audit';
 *
 * const auditLogs = sqliteAuditLogTable();
 * const db = drizzle(env.DB);
 * setAuditStorage(new DrizzleAuditLogStorage({ db, table: auditLogs }));
 * ```
 */
export class DrizzleAuditLogStorage implements AuditLogStorage {
  private readonly db: DrizzleDatabaseConstraint;
  private readonly table: DrizzleTable;

  constructor(options: DrizzleAuditLogStorageOptions) {
    this.db = options.db;
    this.table = options.table;
  }

  private col(field: keyof AuditLogRow): DrizzleColumn {
    return getColumn(this.table, field);
  }

  private toEntry(row: AuditLogRow): AuditLogEntry {
    return {
      id: row.id,
      timestamp: new Date(row.timestamp),
      action: row.action,
      tableName: row.tableName,
      recordId: row.recordId,
      ...(row.userId != null ? { userId: row.userId } : {}),
      ...(row.record != null ? { record: JSON.parse(row.record) } : {}),
      ...(row.previousRecord != null ? { previousRecord: JSON.parse(row.previousRecord) } : {}),
      ...(row.changes != null ? { changes: JSON.parse(row.changes) } : {}),
      ...(row.metadata != null ? { metadata: JSON.parse(row.metadata) } : {}),
    };
  }

  async store(entry: AuditLogEntry): Promise<void> {
    const timestamp = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp);
    await cast<AuditLogRow>(this.db)
      .insert(this.table)
      .values({
        id: entry.id,
        tableName: entry.tableName,
        recordId: String(entry.recordId),
        action: entry.action,
        timestamp: timestamp.getTime(),
        userId: entry.userId ?? null,
        record: entry.record !== undefined ? JSON.stringify(entry.record) : null,
        previousRecord:
          entry.previousRecord !== undefined ? JSON.stringify(entry.previousRecord) : null,
        changes: entry.changes !== undefined ? JSON.stringify(entry.changes) : null,
        metadata: entry.metadata !== undefined ? JSON.stringify(entry.metadata) : null,
      } satisfies AuditLogRow);
  }

  async getByRecordId(
    tableName: string,
    recordId: string | number,
    options?: { limit?: number; offset?: number },
  ): Promise<AuditLogEntry[]> {
    let query = cast<AuditLogRow>(this.db)
      .select()
      .from(this.table)
      .where(and(eq(this.col('tableName'), tableName), eq(this.col('recordId'), String(recordId))))
      .orderBy(asc(this.col('timestamp')), asc(this.col('id')));

    // MemoryAuditLogStorage pagination: `slice(offset, offset + limit)` with a
    // falsy `limit` meaning "all remaining" and a falsy `offset` meaning 0.
    // SQLite/D1 reject OFFSET without a LIMIT, so an offset-only page passes an
    // effectively unbounded LIMIT — mirroring DrizzleVersioningStorage.
    const offset = options?.offset || 0;
    const limit = options?.limit || 0;
    if (limit > 0) {
      query = query.limit(limit);
      if (offset > 0) query = query.offset(offset);
    } else if (offset > 0) {
      query = query.limit(Number.MAX_SAFE_INTEGER);
      query = query.offset(offset);
    }

    const rows = await query;
    return rows.map((row) => this.toEntry(row));
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
    // Every present filter is ANDed. Truthy checks mirror MemoryAuditLogStorage
    // (an empty-string userId/tableName is treated as "no filter"). Dates are
    // inclusive: `>= startDate`, `<= endDate`.
    const conditions: DrizzleSql[] = [];
    if (options?.tableName) conditions.push(eq(this.col('tableName'), options.tableName));
    if (options?.action) conditions.push(eq(this.col('action'), options.action));
    if (options?.userId) conditions.push(eq(this.col('userId'), options.userId));
    if (options?.startDate)
      conditions.push(gte(this.col('timestamp'), options.startDate.getTime()));
    if (options?.endDate) conditions.push(lte(this.col('timestamp'), options.endDate.getTime()));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    let query = cast<AuditLogRow>(this.db)
      .select()
      .from(this.table)
      .where(where)
      .orderBy(asc(this.col('timestamp')), asc(this.col('id')));

    // Same MemoryAuditLogStorage pagination as getByRecordId (see note above).
    const offset = options?.offset || 0;
    const limit = options?.limit || 0;
    if (limit > 0) {
      query = query.limit(limit);
      if (offset > 0) query = query.offset(offset);
    } else if (offset > 0) {
      query = query.limit(Number.MAX_SAFE_INTEGER);
      query = query.offset(offset);
    }

    const rows = await query;
    return rows.map((row) => this.toEntry(row));
  }
}

/** Column builders of {@link sqliteAuditLogTable} (fresh per call — builders are single-use). */
function auditLogColumns() {
  return {
    id: text('id').primaryKey(),
    tableName: text('table_name').notNull(),
    recordId: text('record_id').notNull(),
    action: text('action').notNull(),
    timestamp: integer('timestamp').notNull(),
    userId: text('user_id'),
    record: text('record'),
    previousRecord: text('previous_record'),
    changes: text('changes'),
    metadata: text('metadata'),
  };
}

/** The built columns handed to an `extraConfig` callback of {@link sqliteAuditLogTable}. */
export type SqliteAuditLogColumns = BuildColumns<
  string,
  ReturnType<typeof auditLogColumns>,
  'sqlite'
>;

/**
 * Build a SQLite/D1 audit table with the columns {@link DrizzleAuditLogStorage}
 * expects. `tableName`/`recordId`/`timestamp` back the per-record lookups and
 * the `getAll` filters the storage performs, so the table ships with indexes
 * on `(table_name, record_id)` and `(timestamp)` — D1 charges per row
 * scanned, and an unindexed audit table grows without bound.
 *
 * @param name - Table name. Default `audit_logs` (matches `AuditConfig`'s
 *   default `tableName`).
 * @param extraConfig - Additional indexes/constraints, appended to the
 *   defaults (`(t) => [index('audit_user_idx').on(t.userId)]`).
 */
export function sqliteAuditLogTable(
  name = 'audit_logs',
  extraConfig?: (table: SqliteAuditLogColumns) => SQLiteTableExtraConfigValue[],
) {
  return sqliteTable(name, auditLogColumns(), (table) => [
    index(`${name}_record_idx`).on(table.tableName, table.recordId),
    index(`${name}_timestamp_idx`).on(table.timestamp),
    ...(extraConfig?.(table) ?? []),
  ]);
}
