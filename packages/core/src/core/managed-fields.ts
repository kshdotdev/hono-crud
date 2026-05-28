import { ConfigurationException, ConflictException } from './exceptions';
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
  timestamps: boolean | { createdAt?: string; updatedAt?: string } | undefined,
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

/**
 * The set of engine-managed / server-owned field names that must be
 * excluded from a **model-derived request/input** schema.
 *
 * This is the single source of truth for "which fields does the engine
 * own on writes, so the client must not be forced to send them" — it
 * mirrors and reuses the same `Model.primaryKeys` / `Model.id` /
 * `getTimestampsConfig(model)` inputs the write-site resolvers
 * ({@link applyManagedInsertFields} / {@link applyManagedUpdateFields})
 * already consume, so the precedence is never duplicated per endpoint.
 *
 * Returned names are excluded from the *model-derived* schema only — a
 * consumer-supplied per-endpoint body schema always wins and is never
 * rewritten. RESPONSE/output schemas are unaffected: clients still read
 * `id` / `createdAt` / `updatedAt`.
 *
 * @param model - the model whose managed fields to resolve.
 * @param options.includePrimaryKeys - when `true` (the default) the
 *   model's primary keys are part of the exclusion set, matching the
 *   long-standing single-create derivation (`[...model.primaryKeys]`).
 *   Pass `false` for upsert-style schemas where the primary key may be
 *   the matching/upsert key and the existing code intentionally keeps it.
 */
export function getManagedInputExclusions(
  model: Pick<Model, 'id' | 'timestamps' | 'primaryKeys'>,
  options: { includePrimaryKeys?: boolean } = {},
): string[] {
  const { includePrimaryKeys = true } = options;
  const exclude = new Set<string>();

  if (includePrimaryKeys) {
    for (const pk of model.primaryKeys) {
      exclude.add(pk);
    }
  }

  // Timestamps are stamped by the engine at every write site
  // (createdAt + updatedAt on insert, updatedAt always on update),
  // so a client must never be forced to supply them. Resolve the
  // (possibly renamed) field names from the normalized config — never
  // recompute or hardcode the names here.
  const ts = getTimestampsConfig(model.timestamps);
  if (ts.enabled) {
    exclude.add(ts.createdAt);
    exclude.add(ts.updatedAt);
  }

  return [...exclude];
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
  defaultIdFactory?: () => string | number,
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
          "MemoryAdapter does not support id:'database' (no database to generate the key)",
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
  model: Pick<Model, 'timestamps'>,
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
export function assertIdStrategySupported(model: Pick<Model, 'id'>, adapter: AdapterKind): void {
  if (adapter === 'memory' && model.id === 'database') {
    throw new ConfigurationException(
      "MemoryAdapter does not support id:'database' (no database to generate the key)",
    );
  }
}

/**
 * Strip the engine-managed write-time fields from a record so the
 * downstream {@link applyManagedInsertFields} call can stamp fresh
 * values. The clone endpoint's source row carries the source's
 * `createdAt` / `updatedAt` (and the source PK); those must NOT be
 * copied into the new row — the new row is a brand-new write site and
 * must get engine-fresh values exactly as a single-create does.
 *
 * Returns a NEW object — the input is never mutated. The set of stripped
 * names mirrors {@link getManagedInputExclusions} (same PK + timestamps
 * resolution), so the rule is never duplicated.
 */
export function stripManagedInsertFields<T extends Record<string, unknown>>(
  record: T,
  model: Pick<Model, 'id' | 'timestamps' | 'primaryKeys'>,
): T {
  const out: Record<string, unknown> = { ...record };
  for (const field of getManagedInputExclusions(model)) {
    delete out[field];
  }
  return out as T;
}

/**
 * Driver error codes that mean "unique constraint violated". String/number
 * values are accepted to cover every adapter shape without coercion:
 *
 *  - `'P2002'`                    — Prisma `PrismaClientKnownRequestError`
 *  - `'SQLITE_CONSTRAINT_UNIQUE'` — libSQL / better-sqlite3 / D1 (specific)
 *  - `'SQLITE_CONSTRAINT'`        — generic SQLite (less specific)
 *  - `'23505'`                    — PostgreSQL `unique_violation`
 *  - `'ER_DUP_ENTRY' | 1062 | '1062'` — MySQL / MariaDB
 */
const UNIQUE_VIOLATION_CODES: ReadonlySet<string | number> = new Set([
  'P2002',
  'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CONSTRAINT',
  '23505',
  'ER_DUP_ENTRY',
  1062,
  '1062',
]);

/** Fallback for adapters that don't expose a structured driver code. */
const UNIQUE_VIOLATION_MESSAGE =
  /UNIQUE constraint failed|duplicate key value violates unique constraint|Duplicate entry/i;

/**
 * Returns `true` when an arbitrary thrown value carries a known
 * unique-violation shape — driver code first, message regex as a
 * fallback. Property-based (no `instanceof`) so adapters keep their
 * runtime dependencies optional (a Prisma-free build never imports
 * `@prisma/client/runtime` just to check an error).
 */
function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { code, message } = e as { code?: unknown; message?: unknown };
  if ((typeof code === 'string' || typeof code === 'number') && UNIQUE_VIOLATION_CODES.has(code)) {
    return true;
  }
  return typeof message === 'string' && UNIQUE_VIOLATION_MESSAGE.test(message);
}

/**
 * Walk a bounded {@link Error.cause} chain, yielding each link in order
 * (the original error first). Reusable for any future driver-error →
 * HTTP-error mapper (NOT NULL, FK, CHECK …) — every mapper should walk
 * the cause chain the same way so a wrapper (e.g. drizzle's
 * `DrizzleQueryError` wrapping a `LibsqlError`) doesn't hide the
 * underlying driver error. Depth-bounded as a guard against pathological
 * cycles in user-constructed chains.
 *
 * @param err - the error to walk.
 * @param maxDepth - bounded depth, defaults to 8.
 */
export function* causeChain(err: unknown, maxDepth = 8): Iterable<unknown> {
  for (
    let cursor: unknown = err, i = 0;
    i < maxDepth && cursor != null && typeof cursor === 'object';
    i++
  ) {
    yield cursor;
    cursor = (cursor as { cause?: unknown }).cause;
  }
}

/**
 * Detect a UNIQUE-constraint violation from any adapter's underlying
 * driver and surface it as a {@link ConflictException} (HTTP 409) so the
 * engine's standard `{success:false, error:{code:'CONFLICT', …}}`
 * envelope is returned to the caller instead of a plaintext 500.
 *
 * Returns the mapped exception when the input matches a known
 * unique-violation shape (anywhere in the {@link causeChain}), or `null`
 * for anything else (so the caller rethrows the original and the global
 * error handler decides). The recognised shapes are:
 *
 *  - **Drizzle (libsql / better-sqlite3 / D1)**: `LibsqlError` /
 *    `SqliteError` with `code === 'SQLITE_CONSTRAINT_UNIQUE'` or a
 *    message containing `UNIQUE constraint failed`.
 *  - **Drizzle (postgres-js / node-postgres)**: PostgresError with
 *    `code === '23505'` (`unique_violation`).
 *  - **Drizzle (MySQL)**: `code === 'ER_DUP_ENTRY'` (or 1062).
 *  - **Prisma**: `PrismaClientKnownRequestError` with `code === 'P2002'`.
 *
 * The detector inspects properties (no `instanceof`) so adapters keep
 * their dependencies optional.
 */
export function mapUniqueViolation(err: unknown): ConflictException | null {
  for (const e of causeChain(err)) {
    if (isUniqueViolation(e)) {
      return new ConflictException('Unique constraint violation');
    }
  }
  return null;
}

/**
 * Translate an adapter error to the engine's standard 409 CONFLICT
 * envelope (via {@link mapUniqueViolation}) when it represents a
 * UNIQUE-constraint violation; otherwise rethrow the original error
 * unchanged. Returns `never` — always throws.
 *
 * Designed to compose with a promise's native `.catch(...)` so call
 * sites read top-to-bottom in execution order, with no thunk wrapper:
 *
 * ```ts
 * const result = await this.upsert(data).catch(rethrowAsConstraintError);
 * ```
 *
 * Used at every insert/upsert write site (`create`, `batchCreate`,
 * `upsert` / `nativeUpsert`, `batchUpsert` / `nativeBatchUpsert`,
 * `clone`) so the plaintext-500-on-UNIQUE mapping is never duplicated
 * per endpoint.
 */
export function rethrowAsConstraintError(err: unknown): never {
  throw mapUniqueViolation(err) ?? err;
}
