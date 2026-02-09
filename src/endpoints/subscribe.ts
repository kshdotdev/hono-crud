import type { Context, Env } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { CrudEventPayload, CrudEventType, EventSubscription } from '../events/types';
import { getEventEmitter, type CrudEventEmitter } from '../events/emitter';

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
}

/**
 * Create an SSE subscription handler for real-time CRUD events.
 * Uses Hono's built-in `streamSSE()` which works on Cloudflare Workers.
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
  } = config;

  return (ctx: Context<Env>) => {
    return streamSSE(ctx, async (stream) => {
      const emitter = customEmitter ?? getEventEmitter();
      let subscription: EventSubscription;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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

        try {
          await stream.writeSSE({
            event: `${event.table}.${event.type}`,
            data: JSON.stringify({
              type: event.type,
              table: event.table,
              recordId: event.recordId,
              data: event.data,
              previousData: event.previousData,
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

      // Set up heartbeat to keep the connection alive
      heartbeatTimer = setInterval(async () => {
        try {
          await stream.writeSSE({
            event: 'heartbeat',
            data: JSON.stringify({ timestamp: new Date().toISOString() }),
          });
        } catch {
          // Stream closed
        }
      }, heartbeatInterval);

      // Clean up on abort
      stream.onAbort(() => {
        subscription.unsubscribe();
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }
      });

      // Keep the stream open until aborted
      while (!stream.closed) {
        await stream.sleep(1000);
      }
    });
  };
}
