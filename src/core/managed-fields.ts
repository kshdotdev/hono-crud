/**
 * Engine-managed write-time fields: primary-key generation strategy
 * (`Model.id`) and auto-managed timestamps (`Model.timestamps`).
 *
 * This is the SINGLE source of truth for the PK-resolution precedence and
 * timestamp stamping. Every adapter (drizzle / memory / prisma) routes
 * every write site through these helpers — the precedence is never
 * copy-pasted. Members of the same managed-field family as `softDelete`,
 * `audit`, `versioning` and `multiTenant`.
 */
import type { IdStrategy, Model } from './types';
import { ConfigurationException } from './exceptions';

/**
 * Adapter identity used to reject `id:'database'` where there is no
 * database to generate the key (the memory adapter).
 */
export type AdapterKind = 'drizzle' | 'prisma' | 'memory';

/**
 * Normalized timestamp configuration with field names resolved.
 * `enabled: false` ⇒ no stamping (the default).
 */
export interface NormalizedTimestampsConfig {
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_CREATED_AT = 'createdAt';
const DEFAULT_UPDATED_AT = 'updatedAt';

/**
 * Resolve the timestamps configuration from a model.
 *
 * - unset / falsy ⇒ disabled (unchanged, backward compatible)
 * - `true` ⇒ enabled with default `createdAt` / `updatedAt` field names
 * - object ⇒ enabled, with either field name optionally overridden
 */
export function getTimestampsConfig(
  timestamps: boolean | { createdAt?: string; updatedAt?: string } | undefined
): NormalizedTimestampsConfig {
  if (!timestamps) {
    return { enabled: false, createdAt: DEFAULT_CREATED_AT, updatedAt: DEFAULT_UPDATED_AT };
  }
  if (timestamps === true) {
    return { enabled: true, createdAt: DEFAULT_CREATED_AT, updatedAt: DEFAULT_UPDATED_AT };
  }
  return {
    enabled: true,
    createdAt: timestamps.createdAt ?? DEFAULT_CREATED_AT,
    updatedAt: timestamps.updatedAt ?? DEFAULT_UPDATED_AT,
  };
}

/** Treat `null`, `undefined` and `''` as "the caller did not supply a PK". */
function pkSupplied(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

/**
 * Resolve the engine-managed write-time fields for a single INSERT record.
 *
 * Applies, in order, exactly once per write site:
 *  1. Primary-key strategy ({@link Model.id}) on `primaryKeys[0]`:
 *     - caller-supplied non-empty PK wins, untouched;
 *     - else `function` ⇒ call it;
 *     - else `'database'` ⇒ DELETE the PK key so the DB/ORM default fills
 *       it (read back via the adapter's existing RETURNING / create-return);
 *       throws for the memory adapter (no database);
 *     - else (`'uuid'` or unset) ⇒ `crypto.randomUUID()`.
 *  2. Timestamps ({@link Model.timestamps}) when enabled: sets `createdAt`
 *     and `updatedAt` to `Date.now()` unless the caller explicitly supplied
 *     that field.
 *
 * Returns a NEW object — the input is never mutated.
 */
export function applyManagedInsertFields<T extends Record<string, unknown>>(
  record: T,
  model: Pick<Model, 'id' | 'timestamps' | 'primaryKeys'>,
  adapter: AdapterKind,
  /**
   * Optional default-branch generator for the `'uuid'`/unset case. Lets the
   * clone endpoints keep their long-standing overridable `generateId()` hook
   * working — a `function` or `'database'` strategy still takes precedence.
   * Omitted ⇒ `crypto.randomUUID()` (the historical default).
   */
  defaultIdFactory?: () => string | number
): T {
  const out: Record<string, unknown> = { ...record };
  const pk = model.primaryKeys[0];

  if (!pkSupplied(out[pk])) {
    const strategy: IdStrategy | undefined = model.id;
    if (typeof strategy === 'function') {
      out[pk] = strategy();
    } else if (strategy === 'database') {
      if (adapter === 'memory') {
        throw new ConfigurationException(
          "MemoryAdapter does not support id:'database' (no database to generate the key)"
        );
      }
      // Omit the PK entirely: the DB/ORM column default fills it and the
      // adapter reads the generated value back via its existing RETURNING.
      delete out[pk];
    } else {
      // 'uuid' or unset — unchanged historical default.
      out[pk] = defaultIdFactory ? defaultIdFactory() : crypto.randomUUID();
    }
  }

  const ts = getTimestampsConfig(model.timestamps);
  if (ts.enabled) {
    const now = Date.now();
    if (!(ts.createdAt in record)) {
      out[ts.createdAt] = now;
    }
    if (!(ts.updatedAt in record)) {
      out[ts.updatedAt] = now;
    }
  }

  return out as T;
}

/**
 * Resolve the engine-managed write-time fields for an UPDATE payload.
 *
 * When timestamps are enabled, ALWAYS sets `updatedAt = Date.now()` —
 * it is a server-managed column, so any client-supplied value is ignored.
 * `createdAt` is never touched on update. When timestamps are disabled the
 * payload is returned unchanged (a new object is still returned so callers
 * never mutate their input).
 */
export function applyManagedUpdateFields<T extends Record<string, unknown>>(
  data: T,
  model: Pick<Model, 'timestamps'>
): T {
  const ts = getTimestampsConfig(model.timestamps);
  if (!ts.enabled) {
    return { ...data } as T;
  }
  return { ...data, [ts.updatedAt]: Date.now() } as T;
}

/**
 * Eagerly validate the `id` strategy against the adapter so a
 * misconfiguration surfaces at the earliest write rather than as a silent
 * fallback. Currently the only invalid combination is the memory adapter
 * with `id:'database'`.
 */
export function assertIdStrategySupported(
  model: Pick<Model, 'id'>,
  adapter: AdapterKind
): void {
  if (adapter === 'memory' && model.id === 'database') {
    throw new ConfigurationException(
      "MemoryAdapter does not support id:'database' (no database to generate the key)"
    );
  }
}
