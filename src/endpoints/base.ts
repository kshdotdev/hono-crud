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
import { z, type ZodObject } from 'zod';

import { OpenAPIRoute } from '../core/route';
import {
  getAuditConfig,
  getMultiTenantConfig,
  extractTenantId,
  getSoftDeleteConfig,
  getVersioningConfig,
  type MetaInput,
  type NormalizedAuditConfig,
  type NormalizedMultiTenantConfig,
  type NormalizedSoftDeleteConfig,
  type NormalizedVersioningConfig,
} from '../core/types';
import { createAuditLogger, type AuditLogger } from '../audit';
import { createVersionManager, type VersionManager } from '../versioning';
import { resolveEventEmitter } from '../events/emitter';
import type { CrudEventType } from '../events/types';
import { encryptFields, decryptFields } from '../encryption/crypto';
import { applyProfile, applyProfileToArray } from '../serialization/serialize';

export abstract class CrudEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  // Per-instance caches. Lazily populated by getAuditLogger / getVersionManager.
  protected _auditLogger?: AuditLogger;
  protected _versionManager?: VersionManager;

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
