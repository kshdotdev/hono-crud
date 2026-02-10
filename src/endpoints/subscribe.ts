import type { Context, Env } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { CrudEventPayload, CrudEventType, EventSubscription } from '../events/types';
import { getEventEmitter, type CrudEventEmitter } from '../events/emitter';

// Module-level connection tracking per table
const connectionCounts = new Map<string, number>();

/** Default sensitive fields to strip from SSE event payloads. */
const DEFAULT_EXCLUDE_FIELDS = ['password', 'token', 'secret', 'apiKey', 'creditCard', 'ssn'];

/**
 * Configuration for creating an SSE subscription endpoint.
 */
export interface SubscribeEndpointConfig {
  /** The table/model name to subscribe to */
  table: string;
  /** Specific event types to subscribe to. If empty, subscribes to all. */
  events?: CrudEventType[];
  /** Custom event emitter. Uses global emitter if not provided. */
  emitter?: CrudEventEmitter;
  /** Filter function to control which events are sent to a specific client */
  filter?: (event: CrudEventPayload, ctx: Context) => boolean;
  /** Heartbeat interval in milliseconds. @default 30000 */
  heartbeatInterval?: number;
  /** Maximum concurrent SSE connections per table. @default 1000 */
  maxConnections?: number;
  /** Connection timeout in milliseconds. @default 300000 (5 min) */
  connectionTimeout?: number;
  /** Fields to strip from event payloads before streaming. @default ['password', 'token', 'secret', 'apiKey', 'creditCard', 'ssn'] */
  excludeFields?: string[];
}

/**
 * Strips sensitive fields from an object.
 */
function stripSensitiveFields(
  data: unknown,
  excludeFields: string[]
): unknown {
  if (data === null || data === undefined || typeof data !== 'object') {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => stripSensitiveFields(item, excludeFields));
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!excludeFields.includes(key)) {
      result[key] = typeof value === 'object' && value !== null
        ? stripSensitiveFields(value, excludeFields)
        : value;
    }
  }
  return result;
}

/**
 * Create an SSE subscription handler for real-time CRUD events.
 * Uses Hono's built-in `streamSSE()` which works on Cloudflare Workers.
 * Edge-compatible: uses stream.sleep() instead of setInterval/setTimeout.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { createSubscribeHandler } from 'hono-crud';
 *
 * const app = new Hono();
 *
 * // Subscribe to all user events
 * app.get('/users/subscribe', createSubscribeHandler({ table: 'users' }));
 *
 * // Subscribe to specific events with filtering
 * app.get('/users/subscribe', createSubscribeHandler({
 *   table: 'users',
 *   events: ['created', 'updated'],
 *   filter: (event, ctx) => {
 *     // Only send events for the authenticated user's records
 *     const userId = ctx.get('userId');
 *     return event.metadata?.ownerId === userId;
 *   },
 * }));
 * ```
 */
export function createSubscribeHandler(config: SubscribeEndpointConfig) {
  const {
    table,
    events: eventFilter,
    emitter: customEmitter,
    filter,
    heartbeatInterval = 30000,
    maxConnections = 1000,
    connectionTimeout = 300_000,
    excludeFields = DEFAULT_EXCLUDE_FIELDS,
  } = config;

  return (ctx: Context<Env>) => {
    // Check connection limit
    const currentCount = connectionCounts.get(table) || 0;
    if (currentCount >= maxConnections) {
      return ctx.json(
        { success: false, error: { code: 'TOO_MANY_CONNECTIONS', message: 'Too many SSE connections' } },
        503
      );
    }

    // Increment connection count
    connectionCounts.set(table, currentCount + 1);

    return streamSSE(ctx, async (stream) => {
      const emitter = customEmitter ?? getEventEmitter();
      let subscription: EventSubscription;

      // Subscribe to events
      const listener = async (event: CrudEventPayload) => {
        // Filter by event type if specified
        if (eventFilter && eventFilter.length > 0 && !eventFilter.includes(event.type)) {
          return;
        }

        // Apply custom filter
        if (filter && !filter(event, ctx)) {
          return;
        }

        // Strip sensitive fields from event data
        const sanitizedData = excludeFields.length > 0
          ? stripSensitiveFields(event.data, excludeFields)
          : event.data;
        const sanitizedPreviousData = event.previousData && excludeFields.length > 0
          ? stripSensitiveFields(event.previousData, excludeFields)
          : event.previousData;

        try {
          await stream.writeSSE({
            event: `${event.table}.${event.type}`,
            data: JSON.stringify({
              type: event.type,
              table: event.table,
              recordId: event.recordId,
              data: sanitizedData,
              previousData: sanitizedPreviousData,
              timestamp: event.timestamp,
            }),
            id: `${event.table}-${event.recordId}-${Date.now()}`,
          });
        } catch {
          // Stream closed by client
        }
      };

      // Subscribe to the specific table
      subscription = emitter.onTable(table, listener);

      // Cleanup helper — decrements connection count
      const cleanup = () => {
        subscription.unsubscribe();
        const count = connectionCounts.get(table) || 1;
        if (count <= 1) {
          connectionCounts.delete(table);
        } else {
          connectionCounts.set(table, count - 1);
        }
      };

      // Clean up on abort
      stream.onAbort(() => {
        cleanup();
      });

      // Edge-compatible loop: heartbeat + timeout using stream.sleep()
      const startTime = Date.now();
      let lastHeartbeat = startTime;

      while (!stream.closed) {
        await stream.sleep(1000);

        const now = Date.now();

        // Connection timeout
        if (now - startTime >= connectionTimeout) {
          stream.abort();
          break;
        }

        // Heartbeat
        if (now - lastHeartbeat >= heartbeatInterval) {
          lastHeartbeat = now;
          try {
            await stream.writeSSE({
              event: 'heartbeat',
              data: JSON.stringify({ timestamp: new Date().toISOString() }),
            });
          } catch {
            // Stream closed
            break;
          }
        }
      }
    });
  };
}
