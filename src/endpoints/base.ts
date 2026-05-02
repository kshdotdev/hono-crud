/**
 * Shared base class for every CRUD endpoint.
 *
 * Houses the cross-cutting helpers (audit, multi-tenant, soft-delete,
 * versioning, primary-key extraction) that were previously inlined into
 * 11+ endpoint files. Extends `OpenAPIRoute` and adds the `_meta` model
 * binding that every CRUD endpoint requires.
 *
 * Subclasses MUST declare `abstract _meta: M` if they want full type
 * inference on `getRecordId(record)` etc., but the helpers themselves
 * read through `this._meta` at runtime.
 */

import type { Env } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z, type ZodObject, type ZodRawShape } from 'zod';

import { OpenAPIRoute } from '../core/route';
import { ApiException, InputValidationException } from '../core/exceptions';
import { getContextVar, setContextVar } from '../utils/context';
import {
  getAuditConfig,
  getMultiTenantConfig,
  extractTenantId,
  getSoftDeleteConfig,
  getVersioningConfig,
  type HookContext,
  type MetaInput,
  type ModelPolicies,
  type NormalizedAuditConfig,
  type NormalizedMultiTenantConfig,
  type NormalizedSoftDeleteConfig,
  type NormalizedVersioningConfig,
  type PolicyContext,
  type SchemaResolveContext,
  type ValidatedData,
} from '../core/types';
import { POLICIES_CONTEXT_KEY } from '../auth/guards';
import type { AuthUser } from '../auth/types';
import { createAuditLogger, type AuditLogger } from '../audit';
import { createVersionManager, type VersionManager } from '../versioning';
import { resolveEventEmitter } from '../events/emitter';
import type { CrudEventType } from '../events/types';
import { encryptFields, decryptFields } from '../encryption/crypto';
import { applyProfile, applyProfileToArray } from '../serialization/serialize';

/**
 * Per-request memoization key for `Model.resolveSchema(ctx)` results.
 * Per-table so a handler that touches multiple models keeps each cache hit
 * independent.
 */
const RESOLVED_SCHEMA_KEY_PREFIX = '__honoCrudResolvedSchema:';

export abstract class CrudEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  // Per-instance caches. Lazily populated by getAuditLogger / getVersionManager.
  protected _auditLogger?: AuditLogger;
  protected _versionManager?: VersionManager;

  /**
   * Adapter-specific transaction handle for the in-flight write. Adapter
   * subclasses (e.g. `DrizzleCreateEndpoint`) populate this inside their
   * `handle()` override when `useTransaction === true`. Lifecycle hooks
   * read it via `buildHookContext()` so they can participate in the same
   * transaction as the parent INSERT/UPDATE/DELETE.
   */
  protected _tx?: unknown;

  // ============================================================================
  // Audit logging
  // ============================================================================

  protected getAuditLogger(): AuditLogger {
    if (!this._auditLogger) {
      this._auditLogger = createAuditLogger(this._meta.model.audit);
    }
    return this._auditLogger;
  }

  protected getAuditConfig(): NormalizedAuditConfig {
    return getAuditConfig(this._meta.model.audit);
  }

  protected isAuditEnabled(): boolean {
    return this.getAuditConfig().enabled;
  }

  /**
   * Get the user ID for audit logging.
   * Override to customize how user ID is extracted.
   */
  protected getAuditUserId(): string | undefined {
    const config = this.getAuditConfig();
    if (config.getUserId && this.context) {
      return config.getUserId(this.context);
    }
    const ctx = this.context as unknown as { var?: Record<string, unknown> };
    return ctx?.var?.userId as string | undefined;
  }

  // ============================================================================
  // Versioning
  // ============================================================================

  protected getVersionManager(): VersionManager {
    if (!this._versionManager) {
      this._versionManager = createVersionManager(
        this._meta.model.versioning,
        this._meta.model.tableName
      );
    }
    return this._versionManager;
  }

  protected getVersioningConfig(): NormalizedVersioningConfig {
    return getVersioningConfig(this._meta.model.versioning, this._meta.model.tableName);
  }

  protected isVersioningEnabled(): boolean {
    return this.getVersioningConfig().enabled;
  }

  protected getVersioningUserId(): string | undefined {
    const config = this.getVersioningConfig();
    if (config.getUserId && this.context) {
      return config.getUserId(this.context);
    }
    const ctx = this.context as unknown as { var?: Record<string, unknown> };
    return ctx?.var?.userId as string | undefined;
  }

  // ============================================================================
  // Soft delete
  // ============================================================================

  protected getSoftDeleteConfig(): NormalizedSoftDeleteConfig {
    return getSoftDeleteConfig(this._meta.model.softDelete);
  }

  protected isSoftDeleteEnabled(): boolean {
    return this.getSoftDeleteConfig().enabled;
  }

  // ============================================================================
  // Multi-tenancy
  // ============================================================================

  protected getMultiTenantConfig(): NormalizedMultiTenantConfig {
    return getMultiTenantConfig(this._meta.model.multiTenant);
  }

  protected isMultiTenantEnabled(): boolean {
    return this.getMultiTenantConfig().enabled;
  }

  protected getTenantId(): string | undefined {
    if (!this.context) return undefined;
    const config = this.getMultiTenantConfig();
    return extractTenantId(this.context, config);
  }

  /**
   * Validates that tenant ID is present when required.
   * Throws HTTPException if missing and required.
   */
  protected validateTenantId(): string | undefined {
    const config = this.getMultiTenantConfig();
    if (!config.enabled) return undefined;

    const tenantId = this.getTenantId();
    if (!tenantId && config.required) {
      throw new HTTPException(400, { message: config.errorMessage });
    }
    return tenantId;
  }

  /**
   * Injects tenant ID into the data object when multi-tenancy is enabled.
   */
  protected injectTenantId<T extends Record<string, unknown>>(data: T): T {
    const config = this.getMultiTenantConfig();
    if (!config.enabled) return data;

    const tenantId = this.getTenantId();
    if (!tenantId) return data;

    return {
      ...data,
      [config.field]: tenantId,
    };
  }

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * Emit a CRUD event for this model. No-op if no event emitter is configured
   * (explicit, context-injected, or global). Errors in listeners are caught by
   * the emitter so they cannot break the request.
   */
  protected async emitEvent(
    type: CrudEventType,
    payload: {
      recordId: string | number;
      data?: unknown;
      previousData?: unknown;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    const emitter = resolveEventEmitter(this.context ?? undefined);
    if (!emitter) return;
    await emitter.emit({
      type,
      table: this._meta.model.tableName,
      recordId: payload.recordId,
      data: payload.data ?? null,
      previousData: payload.previousData,
      userId: this.getAuditUserId(),
      tenantId: this.context ? this.getTenantId() : undefined,
      organizationId: this.context
        ? getContextVar<string>(this.context, 'organizationId')
        : undefined,
      timestamp: new Date().toISOString(),
      metadata: payload.metadata,
    });
  }

  // ============================================================================
  // Field-level encryption
  // ============================================================================

  /**
   * Encrypt configured fields on a record before writing it to the adapter.
   * No-op when `model.fieldEncryption` is undefined.
   */
  protected async encryptOnWrite<T extends Record<string, unknown>>(record: T): Promise<T> {
    const config = this._meta.model.fieldEncryption;
    if (!config) return record;
    const out = await encryptFields(record, config.fields, config.keyProvider);
    return out as T;
  }

  /**
   * Decrypt configured fields on a record returned from the adapter.
   * No-op when `model.fieldEncryption` is undefined.
   */
  protected async decryptOnRead<T extends Record<string, unknown>>(record: T): Promise<T> {
    const config = this._meta.model.fieldEncryption;
    if (!config) return record;
    const out = await decryptFields(record, config.fields, config.keyProvider);
    return out as T;
  }

  // ============================================================================
  // Serialization profile
  // ============================================================================

  /**
   * Apply the model's default serialization profile to a single record.
   * Returns the record unchanged when no profile is configured.
   */
  protected applyProfile<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
    const profile = this._meta.model.serializationProfile;
    return profile ? applyProfile(record, profile) : record;
  }

  /**
   * Apply the model's default serialization profile to an array of records.
   * Returns the array unchanged when no profile is configured.
   */
  protected applyProfileToArray<T extends Record<string, unknown>>(records: T[]): Record<string, unknown>[] {
    const profile = this._meta.model.serializationProfile;
    return profile ? applyProfileToArray(records, profile) : records;
  }

  // ============================================================================
  // Primary-key extraction
  // ============================================================================

  /**
   * Extract the primary-key value of a record. Returns `null` if the PK
   * is missing or not a string/number.
   */
  protected getRecordId(record: unknown): string | number | null {
    if (record === null || typeof record !== 'object') return null;
    const pk = this._meta.model.primaryKeys[0];
    const id = (record as Record<string, unknown>)[pk];
    if (typeof id === 'string' || typeof id === 'number') return id;
    return null;
  }

  /**
   * Alias for `getRecordId`. Kept because `create`/`update`/`upsert` historically
   * used "parent" terminology in the context of nested writes.
   */
  protected getParentId(record: unknown): string | number | null {
    return this.getRecordId(record);
  }

  // ============================================================================
  // Policies (Model.policies + requirePolicy(...) middleware)
  // ============================================================================

  /**
   * Resolve the effective `ModelPolicies` for the current request.
   * Route-scoped policies attached via `requirePolicy(...)` middleware win
   * over the model-level `Model.policies` default. Returns `undefined`
   * when no policies are configured (endpoint behaviour is unchanged
   * from pre-0.7.0).
   */
  protected getPolicies(): ModelPolicies<unknown> | undefined {
    if (this.context) {
      const fromCtx = getContextVar<ModelPolicies<unknown>>(
        this.context,
        POLICIES_CONTEXT_KEY
      );
      if (fromCtx) return fromCtx;
    }
    return this._meta.model.policies as ModelPolicies<unknown> | undefined;
  }

  /**
   * Build the `PolicyContext` passed to `ModelPolicies` callbacks. Sourced
   * from `c.var.user`, `c.var.tenantId`, etc.
   */
  protected buildPolicyContext(): PolicyContext {
    const ctx = this.context;
    return {
      user: ctx ? getContextVar<AuthUser>(ctx, 'user') : undefined,
      userId: ctx ? getContextVar<string>(ctx, 'userId') : undefined,
      tenantId: ctx ? getContextVar<string>(ctx, 'tenantId') : undefined,
      organizationId: ctx ? getContextVar<string>(ctx, 'organizationId') : undefined,
      request: ctx?.req?.raw ?? new Request('http://localhost/'),
    };
  }

  /**
   * Apply the policy `read` predicate (if any) to a single record. Returns
   * the record if allowed, `null` otherwise. Field masking via
   * `policies.fields(...)` is also applied.
   */
  protected async applyReadPolicy<T>(record: T): Promise<T | null> {
    const policies = this.getPolicies();
    if (!policies) return record;
    const policyCtx = this.buildPolicyContext();

    if (policies.read) {
      const allowed = await policies.read(policyCtx, record);
      if (!allowed) return null;
    }

    if (policies.fields) {
      const mask = policies.fields(policyCtx, record);
      return { ...record, ...mask } as T;
    }

    return record;
  }

  /**
   * Apply the policy `read` predicate to an array of records, dropping
   * disallowed entries and applying any field mask. Used by List endpoints.
   */
  protected async applyReadPolicyToArray<T>(records: T[]): Promise<T[]> {
    const policies = this.getPolicies();
    if (!policies) return records;
    const out: T[] = [];
    for (const record of records) {
      const masked = await this.applyReadPolicy(record);
      if (masked !== null) out.push(masked);
    }
    return out;
  }

  /**
   * Apply the policy `write` predicate (if any) to a record before mutation.
   * Throws `ForbiddenException` when the policy denies the write.
   */
  protected async applyWritePolicy<T>(record: T): Promise<void> {
    const policies = this.getPolicies();
    if (!policies?.write) return;
    const allowed = await policies.write(this.buildPolicyContext(), record);
    if (!allowed) {
      // Use a generic 403 message — don't leak which field tripped the policy.
      throw new HTTPException(403, { message: 'Forbidden by policy' });
    }
  }

  /**
   * Inject `policies.readPushdown(ctx)` filter conditions into the
   * provided filters array so the adapter never returns rows the policy
   * would have stripped post-fetch. No-op when no pushdown is set.
   */
  protected applyReadPushdown(filters: { filters: unknown[] }): void {
    const policies = this.getPolicies();
    if (!policies?.readPushdown) return;
    const extra = policies.readPushdown(this.buildPolicyContext());
    if (extra && extra.length > 0) {
      filters.filters.push(...(extra as unknown[]));
    }
  }

  // ============================================================================
  // Hook context (HookContext.db.tx + actor identity)
  // ============================================================================

  /**
   * Build the `HookContext` passed to lifecycle hooks (`before`/`after`).
   * Reads the current transaction handle from `this._tx` (adapter-set) and
   * pulls tenant/org/user/agent identifiers from the conventional Hono
   * context vars. Safe to call even when no context is set — fields are
   * left undefined when their source is absent.
   */
  protected buildHookContext(): HookContext {
    const ctx = this.context;
    return {
      db: { tx: this._tx },
      request: ctx?.req?.raw,
      tenantId: ctx ? this.getTenantId() : undefined,
      organizationId: ctx ? getContextVar<string>(ctx, 'organizationId') : undefined,
      userId: ctx ? getContextVar<string>(ctx, 'userId') : undefined,
      agentId: ctx ? getContextVar<string>(ctx, 'agentId') : undefined,
      agentRunId: ctx ? getContextVar<string>(ctx, 'agentRunId') : undefined,
    };
  }

  // ============================================================================
  // Per-request schema resolution (Model.resolveSchema)
  // ============================================================================

  /**
   * Returns the effective Zod schema for the current request: the result of
   * `Model.resolveSchema(ctx)` if it was already awaited via
   * `resolveModelSchema()` and cached on the Hono context, otherwise the
   * static `Model.schema`.
   *
   * Sync — safe to call from `getSchema()` paths. Use `resolveModelSchema()`
   * to populate the cache before a sync read is needed at request time.
   */
  protected getModelSchema(): ZodObject<ZodRawShape> {
    if (this.context && this._meta.model.resolveSchema) {
      const cached = getContextVar<ZodObject<ZodRawShape>>(
        this.context,
        RESOLVED_SCHEMA_KEY_PREFIX + this._meta.model.tableName
      );
      if (cached) return cached;
    }
    return this._meta.model.schema as ZodObject<ZodRawShape>;
  }

  /**
   * Awaits `Model.resolveSchema(ctx)` and caches the result on the Hono
   * context. No-op when no resolver is configured. Idempotent within a
   * single request — subsequent calls return the cached schema without
   * re-invoking the resolver.
   *
   * Resolver throws surface as a structured 500 (`SCHEMA_RESOLVE_ERROR`).
   */
  protected async resolveModelSchema(): Promise<ZodObject<ZodRawShape>> {
    const resolver = this._meta.model.resolveSchema;
    if (!resolver || !this.context) {
      return this._meta.model.schema as ZodObject<ZodRawShape>;
    }
    const cacheKey = RESOLVED_SCHEMA_KEY_PREFIX + this._meta.model.tableName;
    const cached = getContextVar<ZodObject<ZodRawShape>>(this.context, cacheKey);
    if (cached) return cached;

    // Read tenant/org from the conventional context vars set by the
    // `multiTenant()` middleware (or by `buildPerTenantOpenApi`'s synthetic
    // context). This deliberately does NOT require `Model.multiTenant` to
    // be configured — the resolver hook is independent of the per-model
    // tenant-injection feature.
    const resolveCtx: SchemaResolveContext = {
      tenantId: getContextVar<string>(this.context, 'tenantId'),
      organizationId: getContextVar<string>(this.context, 'organizationId'),
      request: this.context.req?.raw,
      env: this.context.env as unknown,
    };

    let resolved: ZodObject<ZodRawShape>;
    try {
      resolved = (await resolver(resolveCtx)) as ZodObject<ZodRawShape>;
    } catch (err) {
      throw new ApiException(
        err instanceof Error ? err.message : 'Schema resolution failed',
        500,
        'SCHEMA_RESOLVE_ERROR',
        err instanceof Error ? { cause: err.message } : undefined
      );
    }

    setContextVar(this.context, cacheKey, resolved);
    return resolved;
  }

  /**
   * Override of `OpenAPIRoute.getValidatedData()` that resolves the
   * per-tenant schema (if `Model.resolveSchema` is configured) before
   * reading validated request data, then re-validates the body against the
   * endpoint's `getBodySchema()` so per-tenant fields are enforced beyond
   * zod-openapi's static-schema pre-validation.
   *
   * Reads body from the raw request (`ctx.req.json()`) when the resolver
   * is active so fields the static body schema would have stripped are
   * preserved for the resolved-schema parse. Hono caches the parsed JSON
   * body, so repeated calls don't re-consume the request stream.
   *
   * When no resolver is set this is a thin pass-through to the parent
   * implementation — same behavior as before 0.6.0.
   */
  override async getValidatedData<T = unknown>(): Promise<ValidatedData<T>> {
    await this.resolveModelSchema();
    const data = await super.getValidatedData<T>();

    if (this._meta.model.resolveSchema && this.context && data.body !== undefined) {
      const candidate = this as { getBodySchema?: () => ZodObject<ZodRawShape> };
      if (typeof candidate.getBodySchema === 'function') {
        let rawBody: unknown = data.body;
        try {
          rawBody = await this.context.req.json();
        } catch {
          // Fall back to the static-schema-validated body if raw JSON read
          // fails (e.g. body already consumed in an unusual middleware setup).
        }
        const bodySchema = candidate.getBodySchema();
        const parsed = bodySchema.safeParse(rawBody);
        if (!parsed.success) {
          throw InputValidationException.fromZodError(parsed.error);
        }
        data.body = parsed.data as T;
      }
    }

    return data;
  }
}

// ============================================================================
// Shared error-response Zod schema factory
// ============================================================================

/**
 * Build a `{ success: false, error: { code, message, details? } }` Zod
 * response schema. Replaces the 14+ inlined copies of this schema across
 * endpoint files.
 */
export function errorResponseSchema(description?: string) {
  const schema = z.object({
    success: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  });
  return {
    description: description ?? 'Error',
    content: {
      'application/json': { schema },
    },
  };
}

/**
 * Returns just the Zod schema (for callers that want to embed it in a
 * custom response shape).
 */
export function errorResponseZodSchema(): ZodObject<{
  success: z.ZodLiteral<false>;
  error: ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
    details: z.ZodOptional<z.ZodUnknown>;
  }>;
}> {
  return z.object({
    success: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  });
}
