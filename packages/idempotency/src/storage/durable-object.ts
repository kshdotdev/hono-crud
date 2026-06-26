import type { IdempotencyEntry, IdempotencyStorage } from '../types';

/**
 * Durable-Objects idempotency storage — the edge-native backend.
 *
 * KV has no compare-and-swap, so it can't implement an atomic `lock()` (see the
 * package README). A Durable Object can: each idempotency key maps to its OWN DO
 * instance (`idFromName(key)`), so different keys never contend, while concurrent
 * requests for the SAME key serialize on that one instance — and the lock
 * compare-and-set runs inside `blockConcurrencyWhile`, giving true CAS.
 *
 * Wiring (Cloudflare Worker):
 * 1. Export {@link IdempotencyDurableObject} from your Worker entry (so wrangler
 *    can bind the class).
 * 2. Declare the DO binding + a migration tag in `wrangler.toml`.
 * 3. `setIdempotencyStorage(new DOIdempotencyStorage(env.IDEMPOTENCY))` (or inject
 *    via `createStorageMiddleware`), then add `createIdempotencyMiddleware()`.
 *
 * Types are structural (no `@cloudflare/workers-types` dependency) — they match
 * the runtime shape this backend uses.
 */

// ---- Minimal structural Cloudflare DO types (avoid a workers-types dep) ------
interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
}
interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}
interface DurableObjectStubLike {
  fetch(input: string, init?: { method?: string; body?: string }): Promise<Response>;
}
interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

interface LockReply {
  acquired: boolean;
}
interface IsLockedReply {
  locked: boolean;
}
interface GetReply {
  entry: IdempotencyEntry | null;
}

const STORAGE_URL = 'https://do.idempotency/op';
const ENTRY_KEY = 'entry';
const LOCK_KEY = 'lock';

interface StoredEntry {
  entry: IdempotencyEntry;
  expiresAt: number;
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The Durable Object class. One instance per idempotency key (named by the key).
 * Stores the in-flight lock + the completed response entry in DO storage; an
 * alarm sweeps the instance once the entry TTL elapses.
 *
 * Old-style DO (no `cloudflare:workers` import) so the package stays
 * runtime-neutral: wrangler instantiates it with `(state, env)`.
 */
export class IdempotencyDurableObject {
  constructor(
    private readonly state: DurableObjectStateLike,
    _env?: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const msg = (await request.json()) as {
      op: 'get' | 'set' | 'isLocked' | 'lock' | 'unlock';
      entry?: IdempotencyEntry;
      ttlMs?: number;
    };
    const now = Date.now();

    switch (msg.op) {
      case 'get': {
        const stored = await this.state.storage.get<StoredEntry>(ENTRY_KEY);
        if (!stored || stored.expiresAt <= now) {
          if (stored) await this.state.storage.delete(ENTRY_KEY);
          return json({ entry: null } satisfies GetReply);
        }
        return json({ entry: stored.entry } satisfies GetReply);
      }

      case 'set': {
        const expiresAt = now + (msg.ttlMs ?? 0);
        await this.state.storage.put<StoredEntry>(ENTRY_KEY, {
          entry: msg.entry as IdempotencyEntry,
          expiresAt,
        });
        // Self-clean once the entry expires (also clears any stale lock).
        const existing = await this.state.storage.getAlarm();
        if (existing === null || existing < expiresAt) {
          await this.state.storage.setAlarm(expiresAt);
        }
        return json({ ok: true });
      }

      case 'isLocked': {
        const exp = await this.state.storage.get<number>(LOCK_KEY);
        return json({ locked: typeof exp === 'number' && exp > now } satisfies IsLockedReply);
      }

      case 'lock': {
        // Atomic compare-and-set: serialize the read+write for this key.
        const acquired = await this.state.blockConcurrencyWhile(async () => {
          const exp = await this.state.storage.get<number>(LOCK_KEY);
          if (typeof exp === 'number' && exp > now) return false;
          await this.state.storage.put<number>(LOCK_KEY, now + (msg.ttlMs ?? 0));
          return true;
        });
        return json({ acquired } satisfies LockReply);
      }

      case 'unlock': {
        await this.state.storage.delete(LOCK_KEY);
        return json({ ok: true });
      }

      default:
        return json({ error: 'unknown op' });
    }
  }

  /** TTL sweep: drop the per-key instance's data once the entry has expired. */
  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

/** Options for {@link DOIdempotencyStorage}. */
export interface DOIdempotencyStorageOptions {
  /** Prefix applied to DO instance names (namespacing within one DO class). */
  keyPrefix?: string;
}

/**
 * {@link IdempotencyStorage} backed by {@link IdempotencyDurableObject}. Routes
 * each key to its own DO instance for contention-free, atomically-locked
 * idempotency on Cloudflare Workers.
 */
export class DOIdempotencyStorage implements IdempotencyStorage {
  private readonly prefix: string;

  constructor(
    private readonly namespace: DurableObjectNamespaceLike,
    options?: DOIdempotencyStorageOptions,
  ) {
    this.prefix = options?.keyPrefix ?? 'idem:';
  }

  private async call<T>(key: string, body: Record<string, unknown>): Promise<T> {
    const stub = this.namespace.get(this.namespace.idFromName(this.prefix + key));
    const res = await stub.fetch(STORAGE_URL, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  }

  async get(key: string): Promise<IdempotencyEntry | null> {
    return (await this.call<GetReply>(key, { op: 'get' })).entry;
  }

  async set(key: string, entry: IdempotencyEntry, ttlMs: number): Promise<void> {
    await this.call(key, { op: 'set', entry, ttlMs });
  }

  async isLocked(key: string): Promise<boolean> {
    return (await this.call<IsLockedReply>(key, { op: 'isLocked' })).locked;
  }

  async lock(key: string, ttlMs: number): Promise<boolean> {
    return (await this.call<LockReply>(key, { op: 'lock', ttlMs })).acquired;
  }

  async unlock(key: string): Promise<void> {
    await this.call(key, { op: 'unlock' });
  }
}
