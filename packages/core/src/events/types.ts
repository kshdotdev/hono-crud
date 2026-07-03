/**
 * CRUD event types.
 *
 * Single source for the {@link CrudEventType} union and any derived shape (e.g.
 * the webhook event-filter template-literal type), so adding an event type here
 * propagates everywhere instead of silently leaving a new type unfilterable.
 *
 * The verb surface splits into four families, all past-tense to match the
 * original four names:
 * 1. Single-record core:  `created` / `updated` / `deleted` / `restored`.
 * 2. Single-record extras: `upserted` (carries `metadata.created`), `cloned`,
 *    `imported` (per row, carries `metadata.status`).
 * 3. Filter-scoped bulk:  `bulk_patched` (one event per affected record).
 * 4. Batch verbs:  `batch_created` / `batch_updated` / `batch_deleted` /
 *    `batch_restored` / `batch_upserted` — one event PER record (the payload's
 *    `recordId`/`data` are singular), fanned out exactly as `logBatchAudit`
 *    fans out audit entries. The `batch_` prefix mirrors the `AuditAction`
 *    grouping (`batch_create`…); the past-tense suffix mirrors this vocabulary.
 */
export const CRUD_EVENT_TYPES = [
  'created',
  'updated',
  'deleted',
  'restored',
  'upserted',
  'cloned',
  'imported',
  'bulk_patched',
  'batch_created',
  'batch_updated',
  'batch_deleted',
  'batch_restored',
  'batch_upserted',
] as const;
export type CrudEventType = (typeof CRUD_EVENT_TYPES)[number];

/**
 * Payload for a CRUD event.
 */
export interface CrudEventPayload<T = unknown> {
  /** The type of operation that triggered the event */
  type: CrudEventType;
  /** The table/model name */
  table: string;
  /** The record ID */
  recordId: string | number;
  /** The record data after the operation (null for deletes) */
  data: T | null;
  /** The record data before the operation (null for creates) */
  previousData?: T | null;
  /** The user who triggered the operation */
  userId?: string;
  /**
   * Tenant identifier resolved by the multi-tenant middleware
   * (`c.var.tenantId`). Surfaced so subscribers can fan out per-tenant
   * without re-deriving it from the record. Optional — populated only when
   * the request was tenant-scoped.
   */
  tenantId?: string;
  /**
   * Organization identifier from `c.var.organizationId`. Optional —
   * populated only when an upstream middleware set it.
   */
  organizationId?: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Event listener function type.
 */
export type CrudEventListener<T = unknown> = (event: CrudEventPayload<T>) => void | Promise<void>;

/**
 * Event subscription handle returned when subscribing.
 * Call unsubscribe() to remove the listener.
 */
export interface EventSubscription {
  unsubscribe(): void;
}
