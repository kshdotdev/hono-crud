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
