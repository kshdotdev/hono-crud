/**
 * Cross-adapter conformance contract: descriptor types + exact-assertion helpers.
 *
 * Audit findings 73/74/76: the behavioral surface (soft-delete where-clauses,
 * operator translation, unique-409 detection, finalize pipeline, ...) is
 * reimplemented per adapter, but contracts were pinned almost exclusively
 * against the memory adapter — the structural cause of adapter drift. This
 * suite runs ONE set of contract cells against every adapter through the real
 * HTTP surface, asserting exact status codes and exact error-envelope shapes.
 *
 * Capability skips are explicit and named in test titles; an adapter never
 * goes silently green on a contract it does not actually run.
 */
import { expect } from 'vitest';

// ============================================================================
// Adapter descriptor
// ============================================================================

/** Minimal surface of a mounted conformance app (fromHono wrapper or Hono). */
export interface ConformanceApp {
  request(path: string, init?: RequestInit): Response | Promise<Response>;
}

/**
 * How tenant scoping is wired for a given adapter leg.
 *
 * Memory/drizzle use a dedicated nullable `tenantId` column. The prisma leg
 * reuses the examples schema (`examples/prisma/schema.prisma`), which has no
 * tenant column — there the existing `status` enum column doubles as the
 * tenant discriminator (`active` vs `pending`). Tenant enforcement lives
 * entirely in core (extra equality filter + create-injection), so the
 * contract under test is identical: the adapter must faithfully apply the
 * additional filters core hands it.
 */
export interface TenantWiring {
  /** Model field carrying the tenant discriminator. */
  field: string;
  /** Header read by the `multiTenant()` middleware (its default). */
  headerName: string;
  tenantA: string;
  tenantB: string;
}

export interface ConformanceCapabilities {
  /**
   * Whether the backing store enforces the model's unique column (email).
   * The memory adapter has no constraint surface and the framework has no
   * model-level unique declaration, so it genuinely cannot run the
   * unique-conflict cell. Skips referencing this capability are named.
   */
  uniqueConstraints: boolean;
  /**
   * 'epoch-ms': library-managed timestamps (`Model.timestamps: true`,
   * numbers from `Date.now()`).
   * 'iso-datetime': DB-managed timestamps (Prisma `@default(now())` /
   * `@updatedAt`, serialized as ISO strings).
   * Either way the contract is: both fields set on create, `updatedAt`
   * strictly bumped on update, `createdAt` immutable.
   */
  timestampKind: 'epoch-ms' | 'iso-datetime';
  /**
   * 'rollback': with `useTransaction = true`, an after-hook throw rolls the
   *   parent write back (transactional hook pair).
   * 'noop-sentinel': no transaction machinery; the documented LOUD contract
   *   is `HookContext.db.tx === <frozen sentinel>` and no rollback
   *   (memory adapter, `MEMORY_NOOP_TX`).
   */
  transactionalHooks: 'rollback' | 'noop-sentinel';
  /**
   * Whether this leg's conformance model carries an owner-scoped self-relation
   * (`parent` belongsTo via `parentId`, `scope` tied to the tenant + soft-delete
   * columns), so the relation-include scoping cell can run. False on the prisma
   * leg — it reuses the fixed examples `users` schema, which has no self-relation
   * column; the skip is named.
   */
  relationScoping: boolean;
}

export interface HookObservation {
  phase: 'before' | 'after';
  /** Shallow copy of the record the hook observed. */
  data: Record<string, unknown>;
  /** `HookContext.db.tx` as seen by the hook. */
  tx: unknown;
}

export interface HookRecorder {
  observations: HookObservation[];
  /** When true, the after-hook throws (exercises rollback semantics). */
  failAfter: boolean;
}

export interface AdapterContext {
  app: ConformanceApp;
  hookRecorder: HookRecorder;
  /** Wipe all rows + the hook recorder. Runs in beforeEach. */
  reset(): Promise<void>;
  teardown?(): Promise<void>;
}

export interface AdapterDescriptor {
  name: string;
  capabilities: ConformanceCapabilities;
  tenant: TenantWiring;
  /** Expected `HookContext.db.tx` value for 'noop-sentinel' adapters. */
  noopTxSentinel?: unknown;
  setup(): Promise<AdapterContext>;
}

/** Lazily resolves the context built in the adapter describe's beforeAll. */
export type CtxGetter = () => AdapterContext;

// ============================================================================
// Response envelopes (the canonical shapes, pinned exactly)
// ============================================================================

/** `ApiException.toJSON()` / `OpenAPIRoute.error()` envelope. */
export interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export interface SuccessEnvelope<T> {
  success: true;
  result: T;
}

/** Offset-pagination metadata (PaginatedResult.result_info, core/types.ts). */
export interface ResultInfo {
  page: number;
  per_page: number;
  total_count: number;
  total_pages: number;
  has_next_page: boolean;
  has_prev_page: boolean;
}

export interface ListEnvelope<T> {
  success: true;
  result: T[];
  result_info: ResultInfo;
}

/**
 * Cursor-mode pagination metadata (keyset walks, next-only / Stripe-style).
 * Exact shape pinned by the cursor-pagination cell: `page` is always 0, no
 * `total_pages`, no `prev_cursor` — `next_cursor` only while more rows exist.
 */
export interface CursorResultInfo {
  page: 0;
  per_page: number;
  total_count: number;
  has_next_page: boolean;
  has_prev_page: boolean;
  next_cursor?: string;
}

export interface CursorListEnvelope<T> {
  success: true;
  result: T[];
  result_info: CursorResultInfo;
}

/** Single upsert: `{ success, result, created }`, 201 created / 200 updated. */
export interface UpsertEnvelope<T> {
  success: true;
  result: T;
  created: boolean;
}

/**
 * BatchUpsert request body is a BARE ARRAY of items (unlike batchCreate's
 * `{ items: [...] }`); each result item wraps the record in `data` plus a
 * per-item `created` flag.
 */
export interface BatchUpsertItem<T> {
  data: T;
  created: boolean;
}

export interface BatchUpsertResult<T> {
  items: BatchUpsertItem<T>[];
  createdCount: number;
  updatedCount: number;
  totalCount: number;
}

export interface BatchCreateResult<T> {
  created: T[];
  count: number;
}

export interface BatchDeleteResult<T> {
  deleted: T[];
  count: number;
}

/** A conformance record as returned over HTTP. */
export interface ConformanceRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  age?: number | null;
  deletedAt?: string | null;
  createdAt?: number | string;
  updatedAt?: number | string;
  [field: string]: unknown;
}

// ============================================================================
// HTTP + assertion helpers
// ============================================================================

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Quoted, 32-hex-char truncated SHA-256 (core/utils/etag.ts). */
export const ETAG_SHAPE = /^"[0-9a-f]{32}"$/;

export function jsonInit(
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/**
 * Asserts the exact error contract: status code, `success: false`, exact
 * `error.code`, and a non-empty `error.message` string.
 */
export async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<ErrorEnvelope> {
  expect(response.status).toBe(status);
  const body = await readJson<ErrorEnvelope>(response);
  expect(body.success).toBe(false);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  expect(body.error.message.length).toBeGreaterThan(0);
  return body;
}

/** Asserts exact status + `success: true` and returns the result payload. */
export async function expectSuccess<T>(response: Response, status: number): Promise<T> {
  expect(response.status).toBe(status);
  const body = await readJson<SuccessEnvelope<T>>(response);
  expect(body.success).toBe(true);
  return body.result;
}

/** Asserts a 200 list envelope and returns it (result + result_info). */
export async function expectList(response: Response): Promise<ListEnvelope<ConformanceRecord>> {
  expect(response.status).toBe(200);
  const body = await readJson<ListEnvelope<ConformanceRecord>>(response);
  expect(body.success).toBe(true);
  expect(Array.isArray(body.result)).toBe(true);
  return body;
}

/** POSTs a record and asserts the exact create contract (201 + uuid id). */
export async function createRecord(
  app: ConformanceApp,
  basePath: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<ConformanceRecord> {
  const response = await app.request(basePath, jsonInit('POST', body, headers));
  const result = await expectSuccess<ConformanceRecord>(response, 201);
  expect(result.id).toMatch(UUID_V4);
  return result;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalizes a timestamp value to epoch milliseconds, asserting the
 * capability-declared representation on the way.
 */
export function timestampToMillis(
  value: unknown,
  kind: ConformanceCapabilities['timestampKind'],
): number {
  if (kind === 'epoch-ms') {
    expect(typeof value).toBe('number');
    return value as number;
  }
  expect(typeof value).toBe('string');
  const millis = Date.parse(value as string);
  expect(Number.isNaN(millis)).toBe(false);
  return millis;
}
