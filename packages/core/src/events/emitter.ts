import { CONTEXT_KEYS } from '../core/context-keys';
import { getLogger } from '../core/logger';
import { createStorageFeature } from '../storage/feature';
import type {
  CrudEventListener,
  CrudEventPayload,
  CrudEventType,
  EventSubscription,
} from './types';

/**
 * Lightweight event emitter for CRUD operations.
 * Designed to be request-scoped or global — no Node.js EventEmitter dependency.
 * Edge-safe: pure in-memory, no background timers.
 *
 * @example
 * ```ts
 * import { CrudEventEmitter } from 'hono-crud';
 *
 * const events = new CrudEventEmitter();
 *
 * // Subscribe to all events on the 'users' table
 * events.on('users', 'created', (event) => {
 *   console.log('User created:', event.recordId);
 * });
 *
 * // Subscribe to all events on any table
 * events.onAny((event) => {
 *   console.log(`${event.type} on ${event.table}:`, event.recordId);
 * });
 *
 * // Emit an event
 * await events.emit({
 *   type: 'created',
 *   table: 'users',
 *   recordId: '123',
 *   data: { id: '123', name: 'John' },
 *   timestamp: new Date().toISOString(),
 * });
 * ```
 */
export class CrudEventEmitter {
  /** Listeners keyed by "table:eventType" */
  private listeners = new Map<string, Set<CrudEventListener>>();
  /** Listeners for all events on a specific table */
  private tableListeners = new Map<string, Set<CrudEventListener>>();
  /** Listeners for all events on all tables */
  private globalListeners = new Set<CrudEventListener>();
  /** Maximum listeners per event key. 0 = unlimited. */
  private maxListeners: number;

  constructor(options?: { maxListeners?: number }) {
    this.maxListeners = options?.maxListeners ?? 100;
  }

  /**
   * Subscribe to a specific event type on a specific table.
   */
  on(table: string, type: CrudEventType, listener: CrudEventListener): EventSubscription {
    const key = `${table}:${type}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    const set = this.listeners.get(key)!;
    if (this.maxListeners > 0 && set.size >= this.maxListeners) {
      getLogger().warn(
        `Max listeners (${this.maxListeners}) reached for event "${key}". Listener not added.`,
      );
      return { unsubscribe: () => {} };
    }
    set.add(listener);

    return {
      unsubscribe: () => {
        this.listeners.get(key)?.delete(listener);
      },
    };
  }

  /**
   * Subscribe to all event types on a specific table.
   */
  onTable(table: string, listener: CrudEventListener): EventSubscription {
    if (!this.tableListeners.has(table)) {
      this.tableListeners.set(table, new Set());
    }
    const set = this.tableListeners.get(table)!;
    if (this.maxListeners > 0 && set.size >= this.maxListeners) {
      getLogger().warn(
        `Max listeners (${this.maxListeners}) reached for table "${table}". Listener not added.`,
      );
      return { unsubscribe: () => {} };
    }
    set.add(listener);

    return {
      unsubscribe: () => {
        this.tableListeners.get(table)?.delete(listener);
      },
    };
  }

  /**
   * Subscribe to all events on all tables.
   */
  onAny(listener: CrudEventListener): EventSubscription {
    if (this.maxListeners > 0 && this.globalListeners.size >= this.maxListeners) {
      getLogger().warn(`Max global listeners (${this.maxListeners}) reached. Listener not added.`);
      return { unsubscribe: () => {} };
    }
    this.globalListeners.add(listener);

    return {
      unsubscribe: () => {
        this.globalListeners.delete(listener);
      },
    };
  }

  /**
   * Remove all listeners for a specific table and event type.
   */
  off(table: string, type: CrudEventType): void {
    this.listeners.delete(`${table}:${type}`);
  }

  /**
   * Remove all listeners.
   */
  removeAll(): void {
    this.listeners.clear();
    this.tableListeners.clear();
    this.globalListeners.clear();
  }

  /**
   * Emit a CRUD event. Calls all matching listeners.
   * Listener errors are caught and logged — they do not propagate.
   */
  async emit(event: CrudEventPayload): Promise<void> {
    const promises: Promise<void>[] = [];

    // Specific table:type listeners
    const key = `${event.table}:${event.type}`;
    const specific = this.listeners.get(key);
    if (specific) {
      for (const listener of specific) {
        promises.push(this.safeCall(listener, event));
      }
    }

    // Table-level listeners
    const tableLevel = this.tableListeners.get(event.table);
    if (tableLevel) {
      for (const listener of tableLevel) {
        promises.push(this.safeCall(listener, event));
      }
    }

    // Global listeners
    for (const listener of this.globalListeners) {
      promises.push(this.safeCall(listener, event));
    }

    await Promise.all(promises);
  }

  /**
   * Get the count of registered listeners.
   */
  listenerCount(): number {
    let count = this.globalListeners.size;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    for (const set of this.tableListeners.values()) {
      count += set.size;
    }
    return count;
  }

  /**
   * Safely call a listener, catching errors.
   */
  private async safeCall(listener: CrudEventListener, event: CrudEventPayload): Promise<void> {
    try {
      await listener(event);
    } catch (err) {
      getLogger().error('Event listener error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ============================================================================
// Global Event Emitter
// ============================================================================

/**
 * Global event-emitter feature. Uses the shared `createStorageFeature` so the
 * resolve precedence (explicit > context > global) matches audit / versioning
 * / logging / api-key instead of being hand-rolled here. The emitter is the one
 * non-storage member of the storage-feature family; it is injected and resolved
 * for parity (see `createStorageMiddleware`).
 *
 * Compatibility API only. In edge runtimes (Cloudflare Workers, Deno, Bun)
 * the global emitter is per-isolate state — listeners are not shared across
 * isolates and may surprise multi-tenant code. Prefer passing an emitter
 * explicitly or injecting one via `createStorageMiddleware`.
 */
const eventEmitterFeature = createStorageFeature<CrudEventEmitter>({
  contextKey: CONTEXT_KEYS.eventEmitter,
  defaultFactory: () => new CrudEventEmitter(),
  // The emitter's whole purpose is to always return a usable bus, so its
  // `getEventEmitter()` getter stays never-null (lazy default on get). This is
  // an intentional, documented exception to the nullable-`getX` convention.
  lazyDefaultOnGet: true,
});

/**
 * Global event-emitter registry (exported for advanced use / tests).
 */
export const eventEmitterRegistry = eventEmitterFeature.registry;

/**
 * Get or create the global event emitter (compatibility API).
 *
 * Intentionally never-null: backed by `getRequired()` with a lazy default. This
 * is the documented exception to the "getX is nullable" rule because the bus
 * must always be usable.
 */
export const getEventEmitter = eventEmitterFeature.getRequired;

/**
 * Set a custom global event emitter.
 */
export const setEventEmitter = eventEmitterFeature.set;

/**
 * Resolve an event emitter without creating a global instance.
 * Priority: explicit > context > explicitly-configured global.
 */
export const resolveEventEmitter = eventEmitterFeature.resolve;
