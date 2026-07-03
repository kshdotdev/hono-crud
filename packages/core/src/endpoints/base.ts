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
import { type ZodObject, type ZodRawShape, z } from 'zod';

import { type AuditLogger, createAuditLogger } from '../audit';
import { getAuditConfig } from '../audit/config';
import { POLICIES_CONTEXT_KEY } from '../auth/guards';
import type { AuthUser } from '../auth/types';
import {
  type CacheInvalidateInput,
  type InvalidatingEndpoint,
  invalidateEndpointCache,
  warnCacheSkippedForPolicy,
} from '../core/cache';
import { applyComputedFields, applyComputedFieldsToArray } from '../core/computed-fields';
import { CONTEXT_KEYS } from '../core/context-keys';
import { ApiException, ForbiddenException, InputValidationException } from '../core/exceptions';
import {
  type AdapterKind,
  type NormalizedTimestampsConfig,
  applyManagedInsertFields,
  applyManagedUpdateFields,
  assertIdStrategySupported,
  getTimestampsConfig,
} from '../core/managed-fields';
import { extractNestedData } from '../core/nested-writes';
import { OpenAPIRoute } from '../core/route';
import { getSoftDeleteConfig } from '../core/soft-delete';
import {
  type AuditAction,
  type FilterCondition,
  type HookContext,
  type HookMode,
  type ListFilters,
  type MetaInput,
  type ModelPolicies,
  type NestedWriteResult,
  type NormalizedAuditConfig,
  type NormalizedMultiTenantConfig,
  type NormalizedSoftDeleteConfig,
  type NormalizedVersioningConfig,
  type PolicyContext,
  type RelationRequestScope,
  type SchemaResolveContext,
  type ValidatedData,
} from '../core/types';
import { decryptFields, encryptFields } from '../encryption/crypto';
import { resolveEventEmitter } from '../events/emitter';
import type { CrudEventType } from '../events/types';
import { extractTenantId, getMultiTenantConfig } from '../multi-tenant/config';
import { applyProfile, applyProfileToArray } from '../serialization/serialize';
import { getContextVar, setContextVar } from '../utils/context';
import { type VersionManager, createVersionManager } from '../versioning';
import { getVersioningConfig } from '../versioning/config';
import {
  type FieldSelection,
  type ModelObject,
  applyFieldSelection,
  applyFieldSelectionToArray,
} from './types';

/**
 * Per-request memoization key for `Model.resolveSchema(ctx)` results.
 * Per-table so a handler that touches multiple models keeps each cache hit
 * independent.
 */
const RESOLVED_SCHEMA_KEY_PREFIX = '__honoCrudResolvedSchema:';

/**
 * Extract the static Zod schema generic from a `MetaInput`. Lets the base
 * class type its schema-related accessors against the actual model schema
 * type rather than the wide `ZodObject<ZodRawShape>` upper bound, which
 * eliminates a class of `as ZodObject<ZodRawShape>` widening casts.
 */
type SchemaOf<M extends MetaInput> = M['model']['schema'];

/**
 * Inferred row type for a `MetaInput`'s model schema (i.e. `z.infer<...>`).
 * Used to type `policies` callbacks and other row-shaped helpers without
 * collapsing to `unknown`.
 */
type RowOf<M extends MetaInput> = z.infer<SchemaOf<M>>;

/**
 * Type predicate: does `o` expose a `getBodySchema()` method? Endpoints
 * with a request body (Create / Update / Upsert / Clone / Batch* /
 * Import) implement it; Read / List / Delete don't. Localising the
 * structural check here means callers do `if (hasGetBodySchema(this))
 * { ... this.getBodySchema() ... }` with no per-call cast.
 */
function hasGetBodySchema<T extends object>(
  o: T,
): o is T & { getBodySchema(): ZodObject<ZodRawShape> } {
  const candidate = o as { getBodySchema?: unknown };
  return typeof candidate.getBodySchema === 'function';
}

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
      this._auditLogger = createAuditLogger(
        this._meta.model.audit,
        undefined,
        this.context ?? undefined,
      );
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
    return this.context ? getContextVar<string>(this.context, CONTEXT_KEYS.userId) : undefined;
  }

  /**
   * Emit audit records for a completed batch mutation. Shared verbatim by all
   * six batch/import audit sites: maps each result record to a
   * `{ recordId, [recordKey]: record }` entry, drops any record whose primary
   * key can't be resolved, and — when at least one survives — logs the batch
   * through `runAfterResponse` so the write outlives the response on Workers.
   *
   * `recordKey` is `'record'` for every verb except batch-delete, which stores
   * the pre-deletion snapshot under `previousRecord`. Callers pass the already
   * unwrapped record array (e.g. `result.items.map((i) => i.data)`).
   */
  protected logBatchAudit(
    records: ReadonlyArray<unknown>,
    op: AuditAction,
    options?: { recordKey?: 'record' | 'previousRecord' },
  ): void {
    if (!this.isAuditEnabled()) return;
    const auditLogger = this.getAuditLogger();
    const recordKey = options?.recordKey ?? 'record';
    const auditRecords = records
      .map((record) => {
        const recordId = this.getRecordId(record);
        if (recordId === null) return null;
        return recordKey === 'previousRecord'
          ? { recordId, previousRecord: record as Record<string, unknown> }
          : { recordId, record: record as Record<string, unknown> };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (auditRecords.length > 0) {
      this.runAfterResponse(
        auditLogger.logBatch(op, this._meta.model.tableName, auditRecords, this.getAuditUserId()),
      );
    }
  }

  /**
   * Emit one CRUD event PER record of a completed batch mutation — the events
   * sibling of {@link logBatchAudit}. The payload's `recordId`/`data` are
   * singular, so a batch cannot be a single event; each record fans out exactly
   * as audit does. Records whose primary key can't be resolved are dropped
   * (they can't form a valid `CrudEventPayload`), matching `logBatchAudit`.
   *
   * `options.as` selects the payload slot: `'data'` (default) for create /
   * update / restore verbs, `'previousData'` for delete (the pre-mutation
   * snapshot). Verbs needing per-record metadata (import's row status,
   * batch-upsert's `created` flag) emit inline instead — that data lives on the
   * per-record result wrapper, not the bare record this helper iterates.
   *
   * Each emit is scheduled through `runAfterResponse` so it outlives the
   * response on Workers, exactly like the single-record verbs.
   */
  protected emitBatchEvents(
    type: CrudEventType,
    records: ReadonlyArray<unknown>,
    options?: { as?: 'data' | 'previousData' },
  ): void {
    const slot = options?.as ?? 'data';
    for (const record of records) {
      const recordId = this.getRecordId(record);
      if (recordId === null) continue;
      const payload =
        slot === 'previousData' ? { recordId, previousData: record } : { recordId, data: record };
      this.runAfterResponse(this.emitEvent(type, payload));
    }
  }

  // ============================================================================
  // Versioning
  // ============================================================================

  protected getVersionManager(): VersionManager {
    if (!this._versionManager) {
      this._versionManager = createVersionManager(
        this._meta.model.versioning,
        this._meta.model.tableName,
        undefined,
        this.context ?? undefined,
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
    return this.context ? getContextVar<string>(this.context, CONTEXT_KEYS.userId) : undefined;
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

  // ============================================================================
  // Engine-managed write-time fields (Model.id strategy + Model.timestamps)
  //
  // Thin pass-throughs to the single centralized resolver in
  // ../core/managed-fields — the PK-resolution precedence and timestamp
  // stamping live in exactly ONE place and are shared by every adapter at
  // every write site. The adapter kind is passed by the calling adapter so
  // `id:'database'` can be rejected for the memory adapter.
  // ============================================================================

  /**
   * Resolve managed write-time fields for a single INSERT record:
   * primary-key strategy (`Model.id`) plus timestamp stamping
   * (`Model.timestamps`). See {@link applyManagedInsertFields}.
   */
  protected applyManagedInsertFields<T extends Record<string, unknown>>(
    record: T,
    adapter: AdapterKind,
    defaultIdFactory?: () => string | number,
  ): T {
    return applyManagedInsertFields(record, this._meta.model, adapter, defaultIdFactory);
  }

  /**
   * Resolve managed write-time fields for an UPDATE payload: always bumps
   * `updatedAt` (server-managed) when timestamps are enabled, never touches
   * `createdAt`. See {@link applyManagedUpdateFields}.
   */
  protected applyManagedUpdateFields<T extends Record<string, unknown>>(data: T): T {
    return applyManagedUpdateFields(data, this._meta.model);
  }

  /**
   * Fail fast on an unsupported `id` strategy for this adapter (currently
   * only the memory adapter + `id:'database'`).
   */
  protected assertIdStrategySupported(adapter: AdapterKind): void {
    assertIdStrategySupported(this._meta.model, adapter);
  }

  /**
   * Normalized timestamps config (resolved field names + enabled flag).
   * Used by native-upsert paths that build their own UPDATE set clause and
   * need to inject the server-managed `updatedAt` column directly.
   */
  protected getTimestampsConfig(): NormalizedTimestampsConfig {
    return getTimestampsConfig(this._meta.model.timestamps);
  }

  protected getTenantId(): string | undefined {
    if (!this.context) return undefined;
    const config = this.getMultiTenantConfig();
    return extractTenantId(this.context, config);
  }

  /**
   * Build the request-scoped access scope for relation includes — the parent
   * request's resolved tenant id plus whether soft-deleted related rows are
   * wanted. Threaded into `IncludeOptions.scope` so the relation loader can
   * constrain included related rows per each relation's `scope` config
   * (owner-scope + soft-delete), preventing cross-tenant exposure via `?include=`.
   */
  protected getRelationScope(includeDeleted = false): RelationRequestScope {
    return { tenantId: this.getTenantId(), includeDeleted };
  }

  /**
   * The owner/tenant equality filter for the current request, or `undefined`
   * when multi-tenancy is off or no tenant is resolved. Adapters AND it into
   * batch-operation WHERE clauses so `batchUpdate` / `batchDelete` /
   * `batchRestore` only ever touch the caller's own rows — single-row verbs get
   * this via core-injected `additionalFilters`, but the batch verbs operate on a
   * client-supplied id list and must constrain it the same way.
   */
  protected getTenantScopeFilter(): { field: string; value: string } | undefined {
    const config = this.getMultiTenantConfig();
    if (!config.enabled) return undefined;
    const tenantId = this.getTenantId();
    return tenantId == null ? undefined : { field: config.field, value: tenantId };
  }

  /**
   * Constrain a parsed `ListFilters` to the caller's tenant by appending the
   * owner equality condition. This is the single, auditable owner-scope
   * injection that EVERY read/bulk verb building a `ListFilters` and handing it
   * to the adapter (`list`, `search`, `export`, `bulkPatch`) MUST call AFTER
   * parsing filters and BEFORE running the query, so the owner equality is
   * `AND`ed into the adapter WHERE clause and a client cannot read or mutate
   * another tenant's rows. Centralizing it here prevents the per-verb drift
   * that produced the recurring multi-tenant leak class — a new verb that
   * forgets to call it is the only way to reintroduce the hole.
   *
   * No-op when multi-tenancy is disabled. Throws `TENANT_REQUIRED` (400) when a
   * tenant is required but absent — identical contract to {@link validateTenantId},
   * which List already relies on.
   */
  protected applyTenantScope(filters: ListFilters): void {
    const tenantId = this.validateTenantId();
    if (!tenantId) return;
    filters.filters.push({
      field: this.getMultiTenantConfig().field,
      operator: 'eq',
      value: tenantId,
    });
  }

  /**
   * Aggregate-shaped owner scope. The aggregate WHERE clause is a
   * `Record<field, value>` map (not `FilterCondition[]`), so this forces the
   * owner field to the caller's tenant — overwriting any client-supplied value
   * for that field — making cross-tenant aggregation impossible. Returns the
   * scoped record. Same no-op / `TENANT_REQUIRED` contract as
   * {@link applyTenantScope}.
   */
  protected applyTenantScopeToAggregateFilters(
    filters: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    const tenantId = this.validateTenantId();
    if (!tenantId) return filters;
    return { ...(filters ?? {}), [this.getMultiTenantConfig().field]: tenantId };
  }

  /**
   * The owner scope as a `{ field, value }` pair, for endpoints whose existence
   * check isn't a `ListFilters` — notably the version endpoints' `recordExists`,
   * which must 404 a record in another tenant so its history/rollback stay
   * private (same leak class the {@link applyTenantScope} comment describes).
   * Same no-op / `TENANT_REQUIRED` contract as {@link applyTenantScope}; returns
   * `undefined` when multi-tenancy is off or no tenant is resolved.
   */
  protected getTenantScope(): { field: string; value: string } | undefined {
    const tenantId = this.validateTenantId();
    if (!tenantId) return undefined;
    return { field: this.getMultiTenantConfig().field, value: tenantId };
  }

  /**
   * Validates that tenant ID is present when required.
   * Throws a 400 `TENANT_REQUIRED` ApiException if missing and required.
   */
  protected validateTenantId(): string | undefined {
    const config = this.getMultiTenantConfig();
    if (!config.enabled) return undefined;

    const tenantId = this.getTenantId();
    if (!tenantId && config.required) {
      throw new ApiException(config.errorMessage, 400, 'TENANT_REQUIRED');
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
    },
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
        ? getContextVar<string>(this.context, CONTEXT_KEYS.organizationId)
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
  protected applyProfileToArray<T extends Record<string, unknown>>(
    records: T[],
  ): Record<string, unknown>[] {
    const profile = this._meta.model.serializationProfile;
    return profile ? applyProfileToArray(records, profile) : records;
  }

  // ============================================================================
  // Read-shaping pipeline
  // ============================================================================

  /**
   * Per-record output transform. Default is identity; concrete endpoints (and
   * the generated config/builder subclasses) override it. Declared here so the
   * shared `finalizeRecord` / `finalizeArray` tail can call it polymorphically.
   */
  protected transform(item: unknown): unknown {
    return item;
  }

  /**
   * Deterministic read-shaping tail shared by every record-returning verb:
   * `computed fields → serializer → serialization profile → transform →
   * field selection`. Each step runs only when the model/endpoint configured
   * it. This is the single source of truth for the chain that was previously
   * copy-pasted across ~14 endpoints — where omitting `applyProfile` silently
   * leaked fields the profile was meant to strip.
   *
   * `decrypt`, policy reads, and the user `after` hook stay in each verb's
   * `handle()` — they aren't uniform across verbs and run before this tail.
   */
  protected async finalizeRecord(
    record: ModelObject<M['model']>,
    fieldSelection?: FieldSelection,
  ): Promise<unknown> {
    const model = this._meta.model;
    let obj: Record<string, unknown> = record as Record<string, unknown>;
    if (model.computedFields) {
      obj = await applyComputedFields(obj, model.computedFields);
    }
    const serialized = model.serializer ? model.serializer(obj as ModelObject<M['model']>) : obj;
    const profiled = this.applyProfile(serialized as Record<string, unknown>);
    const transformed = this.transform(profiled as ModelObject<M['model']>);
    if (fieldSelection?.isActive && fieldSelection.fields.length > 0) {
      return applyFieldSelection(transformed as Record<string, unknown>, fieldSelection);
    }
    return transformed;
  }

  /** Array variant of {@link finalizeRecord}. Same ordered chain, per element. */
  protected async finalizeArray(
    records: ModelObject<M['model']>[],
    fieldSelection?: FieldSelection,
  ): Promise<unknown[]> {
    const model = this._meta.model;
    let items: Record<string, unknown>[] = records as Record<string, unknown>[];
    if (model.computedFields) {
      items = await applyComputedFieldsToArray(items, model.computedFields);
    }
    const serialized = model.serializer
      ? items.map((i) => model.serializer!(i as ModelObject<M['model']>))
      : items;
    const profiled = this.applyProfileToArray(serialized as Record<string, unknown>[]);
    const transformed = profiled.map((i) => this.transform(i as ModelObject<M['model']>));
    if (fieldSelection?.isActive && fieldSelection.fields.length > 0) {
      return applyFieldSelectionToArray(transformed as Record<string, unknown>[], fieldSelection);
    }
    return transformed;
  }

  // ============================================================================
  // Batch mutation: shared after-hook loop + response tail (id-list verbs)
  //
  // Update / Delete / Restore share these two blocks byte-for-byte, differing
  // only in the source array, the response result key, and the subclass-owned
  // `after` / `afterHookMode` / `stopOnError` members (passed in, since they
  // don't exist on the base). Batch-create and batch-upsert have divergent
  // tails and never call these. The before-loops stay per-verb (update walks
  // {id,data}; delete/restore walk bare ids).
  // ============================================================================

  /**
   * Run the per-item `after` hook across a batch's mutated rows. In
   * `fire-and-forget` mode the hook is scheduled via `runAfterResponse` and the
   * untransformed item is kept; otherwise the awaited result is kept. A
   * throwing hook re-raises under `stopOnError`, else records a per-id error
   * (id read via `lookupField`) and keeps the original item.
   */
  protected async applyBatchAfterHooks(
    items: ModelObject<M['model']>[],
    errors: Array<{ id: string; error: string }>,
    hooks: {
      after: (item: ModelObject<M['model']>) => Promise<ModelObject<M['model']>>;
      afterHookMode: HookMode;
      stopOnError: boolean;
    },
  ): Promise<ModelObject<M['model']>[]> {
    const results: ModelObject<M['model']>[] = [];
    for (const item of items) {
      try {
        if (hooks.afterHookMode === 'fire-and-forget') {
          this.runAfterResponse(Promise.resolve(hooks.after(item)));
          results.push(item);
        } else {
          results.push(await hooks.after(item));
        }
      } catch (err) {
        const id = String((item as Record<string, unknown>)[this.lookupField]);
        if (hooks.stopOnError) {
          throw err;
        }
        errors.push({ id, error: err instanceof Error ? err.message : String(err) });
        results.push(item);
      }
    }
    return results;
  }

  /**
   * Build the success response for an id-list batch verb: runs the read-shaping
   * `finalizeArray` chain, emits `{ [resultKey], count, notFound?, errors? }`,
   * returns 207 when anything was skipped (partial errors or not-found ids) and
   * 200 otherwise, and busts the model cache before responding.
   */
  protected async finalizeBatchResponse(
    resultKey: 'updated' | 'deleted' | 'restored',
    results: ModelObject<M['model']>[],
    notFound: string[],
    errors: Array<{ id: string; error: string }>,
  ): Promise<Response> {
    const serialized = await this.finalizeArray(results);

    const response = {
      success: true as const,
      result: {
        [resultKey]: serialized,
        count: serialized.length,
        ...(notFound.length > 0 && { notFound }),
        ...(errors.length > 0 && { errors }),
      },
    };

    // Return 207 if there were partial errors or not found items
    const status = errors.length > 0 || notFound.length > 0 ? 207 : 200;
    // Mutation changes which rows a cached list/read would return.
    await this.invalidateModelCache();

    return this.json(response, status);
  }

  // ============================================================================
  // Read query params: relation includes + field selection
  //
  // Shared by the three read-path verbs (Read / List / Search) that expose
  // `?include=` and `?fields=`. The fields live here — not per-verb — so the
  // query-schema fragment builder and `getAvailableSelectFields` below can read
  // them, and so all three endpoints emit byte-identical OpenAPI for these
  // params. Inert on the write verbs, which never call the helpers.
  // ============================================================================

  /** Allowed relation names that can be included via ?include=relation1,relation2 */
  protected allowedIncludes: string[] = [];
  /** Enable field selection via ?fields=field1,field2 */
  protected fieldSelectionEnabled = false;
  /** Fields that are allowed to be selected. If empty, all schema fields are allowed. */
  protected allowedSelectFields: string[] = [];
  /** Fields that are never returned, even if requested. */
  protected blockedSelectFields: string[] = [];
  /** Fields that are always included in the response. */
  protected alwaysIncludeFields: string[] = [];
  /** Default fields to return when no fields parameter is provided. */
  protected defaultSelectFields: string[] = [];

  /**
   * Gets the list of fields available for selection.
   */
  protected getAvailableSelectFields(): string[] {
    const schemaFields = Object.keys(this.getModelSchema().shape);
    const computedFields = this._meta.model.computedFields
      ? Object.keys(this._meta.model.computedFields)
      : [];
    const relationFields = this._meta.model.relations
      ? Object.keys(this._meta.model.relations)
      : [];

    let available = [...schemaFields, ...computedFields, ...relationFields];

    // Filter to allowed fields if specified
    if (this.allowedSelectFields.length > 0) {
      available = available.filter((f) => this.allowedSelectFields.includes(f));
    }

    // Remove blocked fields
    if (this.blockedSelectFields.length > 0) {
      available = available.filter((f) => !this.blockedSelectFields.includes(f));
    }

    return available;
  }

  /**
   * Appends the shared `?include=` and `?fields=` query params to a query-schema
   * `shape` when their respective features are enabled. Shared by Read / List /
   * Search so the three endpoints' generated OpenAPI for these params stays
   * byte-identical (same names, descriptions, optionality). Mutates `shape`.
   */
  protected addRelationAndFieldSelectionParams(shape: Record<string, z.ZodTypeAny>): void {
    // Add include parameter for relations
    if (this.allowedIncludes.length > 0) {
      shape.include = z
        .string()
        .optional()
        .meta({
          description: `Comma-separated list of relations to include. Allowed: ${this.allowedIncludes.join(', ')}`,
        });
    }

    // Add fields parameter for field selection
    if (this.fieldSelectionEnabled) {
      const availableFields = this.getAvailableSelectFields();
      shape.fields = z
        .string()
        .optional()
        .meta({
          description: `Comma-separated list of fields to return. Available: ${availableFields.join(', ')}`,
        });
    }
  }

  // ============================================================================
  // Item lookup (single-record path param)
  //
  // The id-lookup scaffolding shared by every single-record verb (Read /
  // Update / Delete / Restore / Clone + the version endpoints): the path-param
  // schema, the lookup-value accessor, and the optional query-param
  // `additionalFilters` accessor. Driven by `this.lookupField` /
  // `this.additionalFilters` so a subclass (or the config bridge) can rename
  // the path param or expose extra filter columns without re-implementing the
  // accessors. Verbs with a compound param (version read/rollback add
  // `:version`) override `getParamsSchema()`.
  // ============================================================================

  /** The path-param / column used to look a single record up. */
  protected lookupField = 'id';
  /** Extra query-param columns exposed as equality filters on the lookup. */
  protected additionalFilters?: string[];

  /**
   * Returns the path parameter schema.
   */
  protected getParamsSchema(): ZodObject<ZodRawShape> {
    return z.object({
      [this.lookupField]: z.string(),
    }) as unknown as ZodObject<ZodRawShape>;
  }

  /**
   * Gets the lookup value from path parameters.
   */
  protected async getLookupValue(): Promise<string> {
    const { params } = await this.getValidatedData();
    return params?.[this.lookupField] || '';
  }

  /**
   * Gets additional filter values from query parameters.
   */
  protected async getAdditionalFilters(): Promise<Record<string, string>> {
    if (!this.additionalFilters?.length) {
      return {};
    }

    const { query } = await this.getValidatedData();
    const filters: Record<string, string> = {};

    for (const field of this.additionalFilters) {
      if (query?.[field]) {
        filters[field] = String(query[field]);
      }
    }

    return filters;
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
  // Nested writes (create / update / upsert)
  //
  // Shared plumbing for the three write verbs that accept nested relation data
  // in the request body. `getNestedWritableRelations()` returns none by default
  // — Read/List/Delete never expose nested writes; the Create/Update/Upsert
  // subclasses override it with their verb-specific predicate. `extractNestedData`
  // then splits the body into main-record fields and nested-relation payloads
  // against whatever that predicate returns, so it lives here once for all three.
  // `attachNestedResults` is the Update/Upsert response-merge (create's result
  // shape differs, so create keeps its own attach path).
  // ============================================================================

  /**
   * Relations eligible for nested writes on this verb. Default: none.
   * Overridden by Create (`allowNestedCreate` + `allowCreate`) and by
   * Update / Upsert (`allowNestedWrites` + any nested-write flag).
   */
  protected getNestedWritableRelations(): string[] {
    return [];
  }

  /**
   * Split a request body into the main-record fields and the nested-relation
   * payloads, keyed off {@link getNestedWritableRelations}. Shared verbatim by
   * Create / Update / Upsert.
   */
  protected extractNestedData(data: Record<string, unknown>): {
    mainData: Record<string, unknown>;
    nestedData: Record<string, unknown>;
  } {
    const relationNames = this.getNestedWritableRelations();
    return extractNestedData(data, relationNames);
  }

  /**
   * Attach the results of Update / Upsert nested-write operations onto the
   * parent response object, in place. Per relation: `hasMany` → the created and
   * updated rows concatenated; otherwise the first created row, else the first
   * updated row, else `null`. Shared by Update and Upsert; Create attaches a
   * different result shape (plain `unknown[]` spread-merge) and keeps its own path.
   */
  protected attachNestedResults(
    obj: Record<string, unknown>,
    nestedResults: Record<string, NestedWriteResult>,
  ): void {
    for (const [relationName, result] of Object.entries(nestedResults)) {
      const relationConfig = this._meta.model.relations?.[relationName];
      if (!relationConfig) continue;

      if (relationConfig.type === 'hasMany') {
        obj[relationName] = [...result.created, ...result.updated];
      } else {
        obj[relationName] = result.created[0] || result.updated[0] || null;
      }
    }
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
  protected getPolicies(): ModelPolicies<RowOf<M>> | undefined {
    if (this.context) {
      const fromCtx = getContextVar<ModelPolicies<RowOf<M>>>(this.context, POLICIES_CONTEXT_KEY);
      if (fromCtx) return fromCtx;
    }
    // `ModelPolicies<X>` is invariant in X (X appears in both input and
    // output positions of `read`/`write`/`fields`), so the model's
    // concrete row type doesn't satisfy `RowOf<M>` structurally — even
    // when they're the same nominal type. The cast is honest at this
    // narrow boundary; downstream call sites in `applyRead*`/`applyWrite`
    // use the typed return without further casts.
    return this._meta.model.policies as ModelPolicies<RowOf<M>> | undefined;
  }

  // --- Response cache (config-driven) — shared across verbs -----------------

  /** Enable response caching (list/read). */
  protected cacheEnabled = false;
  /** TTL in seconds. @default 300 */
  protected cacheTtlSeconds?: number;
  /** Query params included in the cache key (default: all present query params). */
  protected cacheKeyFields?: string[];
  /** Add the request `userId` var to the cache key (per-user caching). */
  protected cachePerUser?: boolean;
  /** Tags attached to cache entries (for tag-based invalidation). */
  protected cacheTags?: string[];
  /** Invalidation config for mutation verbs (set by the config bridge). */
  protected cacheInvalidate?: CacheInvalidateInput;
  /** Cache key prefix (must match the read/list cache prefix). */
  protected cachePrefix?: string;

  /**
   * Whether config response-caching is active for THIS request. False when
   * disabled, or when user-scoped read policies are present and `cachePerUser`
   * is not set — caching a tenant-only key would serve one user's policy-shaped
   * view to another, so it is disabled (with a once-per-isolate warning) rather
   * than risk a leak. Used by list/read.
   */
  protected isResponseCacheActive(): boolean {
    if (!this.cacheEnabled) return false;
    if (this.cachePerUser) return true;
    if (this.hasUserScopedReadPolicy()) {
      warnCacheSkippedForPolicy();
      return false;
    }
    return true;
  }

  /**
   * Whether per-user read policies are configured. When true a response can
   * vary by caller identity (row filtering, field masking, existence-hiding),
   * so a tenant-only cache key would leak one user's view to another. List/Read
   * therefore SKIP config-caching when this is true unless `cachePerUser` folds
   * the userId into the key.
   */
  protected hasUserScopedReadPolicy(): boolean {
    const p = this.getPolicies();
    return !!(p && (p.read || p.fields || p.readPushdown));
  }

  /**
   * Invalidate this tenant's cached list/read entries after a successful
   * mutation. Best-effort + a no-op when no cache store is configured, so every
   * mutation verb can call it unconditionally. Defaults to busting all of the
   * model's cache for the tenant; `cacheInvalidate` narrows it.
   */
  protected async invalidateModelCache(): Promise<void> {
    // Context<E> → Context<Env> is invariant; the whole shape is cast at this
    // boundary (the helper only reads context + meta + the cache config).
    await invalidateEndpointCache(
      {
        getContext: () => this.getContext(),
        _meta: this._meta,
        cacheInvalidate: this.cacheInvalidate ?? true,
        cachePrefix: this.cachePrefix,
      } as unknown as InvalidatingEndpoint,
      this.getTenantId(),
    );
  }

  /**
   * Build the `PolicyContext` passed to `ModelPolicies` callbacks. Sourced
   * from `c.var.user`, `c.var.tenantId`, etc.
   */
  protected buildPolicyContext(): PolicyContext {
    const ctx = this.context;
    return {
      user: ctx ? getContextVar<AuthUser>(ctx, CONTEXT_KEYS.user) : undefined,
      userId: ctx ? getContextVar<string>(ctx, CONTEXT_KEYS.userId) : undefined,
      tenantId: ctx ? getContextVar<string>(ctx, CONTEXT_KEYS.tenantId) : undefined,
      organizationId: ctx ? getContextVar<string>(ctx, CONTEXT_KEYS.organizationId) : undefined,
      request: ctx?.req?.raw ?? new Request('http://localhost/'),
    };
  }

  /**
   * Apply the policy `read` predicate (if any) to a single record. Returns
   * the record if allowed, `null` otherwise. Field masking via
   * `policies.fields(...)` is also applied.
   *
   * Typed against `RowOf<M>` so the policies' callbacks see the same row
   * shape as the model — no cast needed at the call site.
   */
  protected async applyReadPolicy(record: RowOf<M>): Promise<RowOf<M> | null> {
    const policies = this.getPolicies();
    if (!policies) return record;
    const policyCtx = this.buildPolicyContext();

    if (policies.read) {
      const allowed = await policies.read(policyCtx, record);
      if (!allowed) return null;
    }

    if (policies.fields) {
      const mask = policies.fields(policyCtx, record);
      return { ...record, ...mask };
    }

    return record;
  }

  /**
   * Apply the policy `read` predicate to an array of records, dropping
   * disallowed entries and applying any field mask. Used by List endpoints.
   */
  protected async applyReadPolicyToArray(records: RowOf<M>[]): Promise<RowOf<M>[]> {
    const policies = this.getPolicies();
    if (!policies) return records;
    const out: RowOf<M>[] = [];
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
  protected async applyWritePolicy(record: RowOf<M>): Promise<void> {
    const policies = this.getPolicies();
    if (!policies?.write) return;
    const allowed = await policies.write(this.buildPolicyContext(), record);
    if (!allowed) {
      // Use a generic 403 message — don't leak which field tripped the policy.
      throw new ForbiddenException('Forbidden by policy');
    }
  }

  /**
   * Inject `policies.readPushdown(ctx)` filter conditions into the
   * provided filters array so the adapter never returns rows the policy
   * would have stripped post-fetch. No-op when no pushdown is set.
   */
  protected applyReadPushdown(filters: { filters: FilterCondition[] }): void {
    const policies = this.getPolicies();
    if (!policies?.readPushdown) return;
    const extra = policies.readPushdown(this.buildPolicyContext());
    if (extra && extra.length > 0) {
      filters.filters.push(...extra);
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
      organizationId: ctx ? getContextVar<string>(ctx, CONTEXT_KEYS.organizationId) : undefined,
      userId: ctx ? getContextVar<string>(ctx, CONTEXT_KEYS.userId) : undefined,
      agentId: ctx ? getContextVar<string>(ctx, CONTEXT_KEYS.agentId) : undefined,
      agentRunId: ctx ? getContextVar<string>(ctx, CONTEXT_KEYS.agentRunId) : undefined,
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
  protected getModelSchema(): SchemaOf<M> {
    if (this.context && this._meta.model.resolveSchema) {
      const cached = getContextVar<SchemaOf<M>>(
        this.context,
        RESOLVED_SCHEMA_KEY_PREFIX + this._meta.model.tableName,
      );
      if (cached) return cached;
    }
    return this._meta.model.schema;
  }

  /**
   * Awaits `Model.resolveSchema(ctx)` and caches the result on the Hono
   * context. No-op when no resolver is configured. Idempotent within a
   * single request — subsequent calls return the cached schema without
   * re-invoking the resolver.
   *
   * Resolver throws surface as a structured 500 (`SCHEMA_RESOLVE_ERROR`).
   */
  protected async resolveModelSchema(): Promise<SchemaOf<M>> {
    const resolver = this._meta.model.resolveSchema;
    if (!resolver || !this.context) {
      return this._meta.model.schema;
    }
    const cacheKey = RESOLVED_SCHEMA_KEY_PREFIX + this._meta.model.tableName;
    const cached = getContextVar<SchemaOf<M>>(this.context, cacheKey);
    if (cached) return cached;

    // Read tenant/org from the conventional context vars set by the
    // `multiTenant()` middleware (or by `buildPerTenantOpenApi`'s synthetic
    // context). This deliberately does NOT require `Model.multiTenant` to
    // be configured — the resolver hook is independent of the per-model
    // tenant-injection feature.
    const resolveCtx: SchemaResolveContext = {
      tenantId: getContextVar<string>(this.context, CONTEXT_KEYS.tenantId),
      organizationId: getContextVar<string>(this.context, CONTEXT_KEYS.organizationId),
      request: this.context.req?.raw,
      env: this.context.env,
    };

    let resolved: SchemaOf<M>;
    try {
      resolved = await resolver(resolveCtx);
    } catch (err) {
      throw new ApiException(
        err instanceof Error ? err.message : 'Schema resolution failed',
        500,
        'SCHEMA_RESOLVE_ERROR',
        err instanceof Error ? { cause: err.message } : undefined,
      );
    }

    setContextVar(this.context, cacheKey, resolved);
    return resolved;
  }

  /**
   * Override of `OpenAPIRoute.getValidatedData()` that resolves the
   * per-tenant schema (`Model.resolveSchema` if configured), then
   * re-validates the body against the endpoint's `getBodySchema()`.
   *
   * Single code path — runs whether or not a resolver is configured.
   * For the static-schema case the re-parse is a no-op against the same
   * Zod instance zod-openapi already validated against; the cost is a
   * few hundred nanoseconds and buys one consistent path to test.
   *
   * Reads body from the raw request (`ctx.req.json()`) so fields the
   * static body schema would have stripped survive into the
   * resolved-schema parse. Hono caches the parsed JSON body, so repeated
   * calls don't re-consume the request stream.
   */
  override async getValidatedData<T = unknown>(): Promise<ValidatedData<T>> {
    await this.resolveModelSchema();
    const data = await super.getValidatedData<T>();

    if (this.context && data.body !== undefined && hasGetBodySchema(this)) {
      let rawBody: unknown = data.body;
      try {
        rawBody = await this.context.req.json();
      } catch {
        // Fall back to the static-schema-validated body if the raw JSON
        // read fails (e.g. body already consumed in an unusual setup).
      }
      const bodySchema = this.getBodySchema();
      const parsed = bodySchema.safeParse(rawBody);
      if (!parsed.success) {
        throw InputValidationException.fromZodError(parsed.error);
      }
      // `parsed.data` has the inferred shape of the body schema, but the
      // generic `T` is the caller's chosen output type; honest erasure at
      // the Zod-output → caller-type boundary.
      data.body = parsed.data as T;
    }

    return data;
  }
}
