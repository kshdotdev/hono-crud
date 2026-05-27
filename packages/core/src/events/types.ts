/**
 * CRUD event types.
 */
export type CrudEventType = 'created' | 'updated' | 'deleted' | 'restored';

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
