import type { CrudEventType, CrudEventPayload, CrudEventListener, EventSubscription } from './types';
import { getLogger } from '../core/logger';

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

  /**
   * Subscribe to a specific event type on a specific table.
   */
  on(table: string, type: CrudEventType, listener: CrudEventListener): EventSubscription {
    const key = `${table}:${type}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener);

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
    this.tableListeners.get(table)!.add(listener);

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
   * Emit without awaiting — fire and forget.
   * Use this when you don't need to wait for listeners to complete.
   */
  emitAsync(event: CrudEventPayload): void {
    this.emit(event).catch((err) => {
      getLogger().error('Event emission error', { error: err instanceof Error ? err.message : String(err) });
    });
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
      getLogger().error('Event listener error', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

// ============================================================================
// Global Event Emitter
// ============================================================================

let globalEmitter: CrudEventEmitter | null = null;

/**
 * Get or create the global event emitter.
 */
export function getEventEmitter(): CrudEventEmitter {
  if (!globalEmitter) {
    globalEmitter = new CrudEventEmitter();
  }
  return globalEmitter;
}

/**
 * Set a custom global event emitter.
 */
export function setEventEmitter(emitter: CrudEventEmitter): void {
  globalEmitter = emitter;
}
