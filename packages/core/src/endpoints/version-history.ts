import type { Env } from 'hono';
import { type ZodObject, type ZodRawShape, z } from 'zod';
import { calculateChanges } from '../audit/config';
import { ApiException, NotFoundException } from '../core/exceptions';
import type {
  AuditFieldChange,
  MetaInput,
  OpenAPIRouteSchema,
  VersionHistoryEntry,
} from '../core/types';
import { CrudEndpoint } from './base';
import { errorResponseSchema, mergeRouteSchema } from './responses';
import type { ModelObject } from './types';

/**
 * Decrypt the configured encrypted fields inside a version snapshot's `data`
 * before it leaves a returning version endpoint (history / read). Mirrors the
 * `decryptOnRead` placement doctrine of the CRUD read verbs: after the storage
 * read, before serialization. Callers gate on `model.fieldEncryption` so
 * non-encrypted models keep the exact stored entry (no needless clone).
 */
async function decryptVersionEntry(
  entry: VersionHistoryEntry,
  decrypt: (record: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<VersionHistoryEntry> {
  return { ...entry, data: await decrypt(entry.data as Record<string, unknown>) };
}

/**
 * Response schema for a single version entry.
 */
const VersionEntrySchema = z.object({
  id: z.string(),
  recordId: z.union([z.string(), z.number()]),
  version: z.number(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.date(),
  changedBy: z.string().optional(),
  changeReason: z.string().optional(),
  changes: z
    .array(
      z.object({
        field: z.string(),
        oldValue: z.unknown().optional(),
        newValue: z.unknown().optional(),
      }),
    )
    .optional(),
});

/**
 * Endpoint to list version history for a record.
 * Returns all versions in descending order (newest first).
 *
 * @example
 * ```
 * GET /documents/:id/versions
 * GET /documents/:id/versions?limit=10&offset=0
 * ```
 */
export abstract class VersionHistoryEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CrudEndpoint<E, M> {
  /** Default number of versions to return */
  protected defaultLimit = 20;

  /** Maximum number of versions to return */
  protected maxLimit = 100;

  // Versioning

  /**
   * Get the version manager for this endpoint.
   */

  /**
   * Get the versioning configuration for this model.
   */

  /**
   * Check if versioning is enabled for this model.
   */

  /**
   * Returns the query parameter schema.
   */
  protected getQuerySchema(): ZodObject<ZodRawShape> {
    return z.object({
      limit: z.coerce.number().min(1).max(this.maxLimit).optional(),
      offset: z.coerce.number().min(0).optional(),
    }) as unknown as ZodObject<ZodRawShape>;
  }

  /**
   * Generates OpenAPI schema.
   */
  getSchema(): OpenAPIRouteSchema {
    return mergeRouteSchema(
      {
        request: {
          params: this.getParamsSchema(),
          query: this.getQuerySchema(),
        },
        responses: {
          200: {
            description: 'Version history retrieved successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.literal(true),
                  result: z.object({
                    versions: z.array(VersionEntrySchema),
                    totalVersions: z.number(),
                  }),
                }),
              },
            },
          },
          400: errorResponseSchema('Versioning not enabled'),
          404: errorResponseSchema('Record not found'),
        },
      },
      this.schema,
    );
  }

  /**
   * Gets the pagination options from query parameters.
   */
  protected async getPaginationOptions(): Promise<{ limit: number; offset: number }> {
    const { query } = await this.getValidatedData();
    return {
      limit: query?.limit ? Number(query.limit) : this.defaultLimit,
      offset: query?.offset ? Number(query.offset) : 0,
    };
  }

  /**
   * Checks if the parent record exists.
   * Override in ORM-specific subclasses.
   */
  protected async recordExists(
    _lookupValue: string,
    _tenantScope?: { field: string; value: string },
  ): Promise<boolean> {
    // Default implementation - override in adapter
    return true;
  }

  /**
   * Main handler.
   */
  async handle(): Promise<Response> {
    if (!this.isVersioningEnabled()) {
      throw new ApiException(
        'Versioning is not enabled for this model',
        400,
        'VERSIONING_NOT_ENABLED',
      );
    }

    const lookupValue = await this.getLookupValue();
    const { limit, offset } = await this.getPaginationOptions();

    // Owner-scope the existence check: a record in another tenant is 404, so its
    // version history never leaks (parity with base CRUD reads). Owning the
    // record implies owning its versions — recordIds are unique.
    const exists = await this.recordExists(lookupValue, this.getTenantScope());
    if (!exists) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    const versionManager = this.getVersionManager();
    const versions = await versionManager.getVersions(lookupValue, { limit, offset });
    const latestVersion = await versionManager.getLatestVersion(lookupValue);

    // Decrypt each snapshot's encrypted fields on the way out (no-op without
    // fieldEncryption; snapshots stay ciphertext at rest).
    const decryptedVersions = this._meta.model.fieldEncryption
      ? await Promise.all(
          versions.map((entry) => decryptVersionEntry(entry, (r) => this.decryptOnRead(r))),
        )
      : versions;

    return this.success({
      versions: decryptedVersions,
      totalVersions: latestVersion,
    });
  }
}

/**
 * Endpoint to get a specific version of a record.
 *
 * @example
 * ```
 * GET /documents/:id/versions/:version
 * ```
 */
export abstract class VersionReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CrudEndpoint<E, M> {
  abstract _meta: M;

  // Versioning

  /**
   * Get the version manager for this endpoint.
   */

  /**
   * Get the versioning configuration for this model.
   */

  /**
   * Check if versioning is enabled for this model.
   */

  /**
   * Returns the path parameter schema.
   */
  protected getParamsSchema(): ZodObject<ZodRawShape> {
    return z.object({
      [this.lookupField]: z.string(),
      version: z.coerce.number().min(1),
    }) as unknown as ZodObject<ZodRawShape>;
  }

  /**
   * Generates OpenAPI schema.
   */
  getSchema(): OpenAPIRouteSchema {
    return mergeRouteSchema(
      {
        request: {
          params: this.getParamsSchema(),
        },
        responses: {
          200: {
            description: 'Version retrieved successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.literal(true),
                  result: VersionEntrySchema,
                }),
              },
            },
          },
          400: errorResponseSchema('Versioning not enabled'),
          404: errorResponseSchema('Version not found'),
        },
      },
      this.schema,
    );
  }

  /**
   * Gets the version number from path parameters.
   */
  protected async getVersionNumber(): Promise<number> {
    const { params } = await this.getValidatedData();
    return params?.version ? Number(params.version) : 0;
  }

  /**
   * Checks if the parent record exists (owner-scoped). Override in adapter.
   */
  protected async recordExists(
    _lookupValue: string,
    _tenantScope?: { field: string; value: string },
  ): Promise<boolean> {
    return true;
  }

  /**
   * Main handler.
   */
  async handle(): Promise<Response> {
    if (!this.isVersioningEnabled()) {
      throw new ApiException(
        'Versioning is not enabled for this model',
        400,
        'VERSIONING_NOT_ENABLED',
      );
    }

    const lookupValue = await this.getLookupValue();
    const versionNumber = await this.getVersionNumber();

    // Owner-scope: a record in another tenant is 404 (its versions stay private).
    const exists = await this.recordExists(lookupValue, this.getTenantScope());
    if (!exists) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    const versionManager = this.getVersionManager();
    const version = await versionManager.getVersion(lookupValue, versionNumber);

    if (!version) {
      throw new NotFoundException(`version ${versionNumber}`, lookupValue);
    }

    // Decrypt the snapshot's encrypted fields on the way out (no-op without
    // fieldEncryption; the snapshot stays ciphertext at rest).
    const decrypted = this._meta.model.fieldEncryption
      ? await decryptVersionEntry(version, (r) => this.decryptOnRead(r))
      : version;

    return this.success(decrypted);
  }
}

/**
 * Endpoint to compare two versions of a record.
 *
 * @example
 * ```
 * GET /documents/:id/versions/compare?from=1&to=3
 * ```
 */
export abstract class VersionCompareEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CrudEndpoint<E, M> {
  abstract _meta: M;

  // Versioning

  /**
   * Get the version manager for this endpoint.
   */

  /**
   * Get the versioning configuration for this model.
   */

  /**
   * Check if versioning is enabled for this model.
   */

  /**
   * Returns the query parameter schema.
   */
  protected getQuerySchema(): ZodObject<ZodRawShape> {
    return z.object({
      from: z.coerce.number().min(1),
      to: z.coerce.number().min(1),
    }) as unknown as ZodObject<ZodRawShape>;
  }

  /**
   * Generates OpenAPI schema.
   */
  getSchema(): OpenAPIRouteSchema {
    return mergeRouteSchema(
      {
        request: {
          params: this.getParamsSchema(),
          query: this.getQuerySchema(),
        },
        responses: {
          200: {
            description: 'Version comparison completed',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.literal(true),
                  result: z.object({
                    from: z.number(),
                    to: z.number(),
                    changes: z.array(
                      z.object({
                        field: z.string(),
                        oldValue: z.unknown().optional(),
                        newValue: z.unknown().optional(),
                      }),
                    ),
                  }),
                }),
              },
            },
          },
          400: errorResponseSchema('Versioning not enabled or invalid parameters'),
          404: errorResponseSchema('Version not found'),
        },
      },
      this.schema,
    );
  }

  /**
   * Gets the version numbers from query parameters.
   */
  protected async getVersionNumbers(): Promise<{ from: number; to: number }> {
    const { query } = await this.getValidatedData();
    return {
      from: query?.from ? Number(query.from) : 0,
      to: query?.to ? Number(query.to) : 0,
    };
  }

  /**
   * Checks if the parent record exists (owner-scoped). Override in adapter.
   */
  protected async recordExists(
    _lookupValue: string,
    _tenantScope?: { field: string; value: string },
  ): Promise<boolean> {
    return true;
  }

  /**
   * Main handler.
   */
  async handle(): Promise<Response> {
    if (!this.isVersioningEnabled()) {
      throw new ApiException(
        'Versioning is not enabled for this model',
        400,
        'VERSIONING_NOT_ENABLED',
      );
    }

    const lookupValue = await this.getLookupValue();
    const { from, to } = await this.getVersionNumbers();

    // Owner-scope: a record in another tenant is 404 (its versions stay private).
    const exists = await this.recordExists(lookupValue, this.getTenantScope());
    if (!exists) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    const versionManager = this.getVersionManager();

    // For encrypted models, decrypt BOTH snapshots before diffing so the
    // comparison is over plaintext. Two versions with the SAME plaintext but
    // different IVs at rest must show NO change for that field — a raw ciphertext
    // diff (via `JSON.stringify`) would report a spurious change on every write.
    let changes: AuditFieldChange[];
    if (this._meta.model.fieldEncryption) {
      const [entryFrom, entryTo] = await Promise.all([
        versionManager.getVersion(lookupValue, from),
        versionManager.getVersion(lookupValue, to),
      ]);
      if (!entryFrom || !entryTo) {
        changes = [];
      } else {
        const [dataFrom, dataTo] = await Promise.all([
          this.decryptOnRead(entryFrom.data as Record<string, unknown>),
          this.decryptOnRead(entryTo.data as Record<string, unknown>),
        ]);
        changes = calculateChanges(dataFrom, dataTo, this.getVersioningConfig().excludeFields);
      }
    } else {
      changes = await versionManager.compareVersions(lookupValue, from, to);
    }

    return this.success({
      from,
      to,
      changes,
    });
  }
}

/**
 * Endpoint to rollback a record to a previous version.
 *
 * @example
 * ```
 * POST /documents/:id/versions/:version/rollback
 * ```
 */
export abstract class VersionRollbackEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CrudEndpoint<E, M> {
  abstract _meta: M;

  // Versioning

  /**
   * Get the version manager for this endpoint.
   */

  /**
   * Get the versioning configuration for this model.
   */

  /**
   * Check if versioning is enabled for this model.
   */

  /**
   * Returns the path parameter schema.
   */
  protected getParamsSchema(): ZodObject<ZodRawShape> {
    return z.object({
      [this.lookupField]: z.string(),
      version: z.coerce.number().min(1),
    }) as unknown as ZodObject<ZodRawShape>;
  }

  /**
   * Generates OpenAPI schema.
   */
  getSchema(): OpenAPIRouteSchema {
    return mergeRouteSchema(
      {
        request: {
          params: this.getParamsSchema(),
        },
        responses: {
          200: {
            description: 'Record rolled back successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.literal(true),
                  result: this.getModelSchema(),
                }),
              },
            },
          },
          400: errorResponseSchema('Versioning not enabled'),
          404: errorResponseSchema('Version not found'),
        },
      },
      this.schema,
    );
  }

  /**
   * Gets the version number from path parameters.
   */
  protected async getVersionNumber(): Promise<number> {
    const { params } = await this.getValidatedData();
    return params?.version ? Number(params.version) : 0;
  }

  /**
   * Rolls back the record to a previous version.
   * Must be implemented by ORM-specific subclasses.
   *
   * @param lookupValue - The record ID
   * @param versionData - The data from the version to rollback to
   * @param newVersion - The new version number to set
   * @param tx - Optional transaction context
   * @returns The updated record
   */
  abstract rollback(
    lookupValue: string,
    versionData: Record<string, unknown>,
    newVersion: number,
    tx?: unknown,
  ): Promise<ModelObject<M['model']>>;

  /**
   * Checks if the parent record exists (owner-scoped). Override in adapter.
   */
  protected async recordExists(
    _lookupValue: string,
    _tenantScope?: { field: string; value: string },
  ): Promise<boolean> {
    return true;
  }

  /**
   * Main handler.
   */
  async handle(): Promise<Response> {
    if (!this.isVersioningEnabled()) {
      throw new ApiException(
        'Versioning is not enabled for this model',
        400,
        'VERSIONING_NOT_ENABLED',
      );
    }

    const lookupValue = await this.getLookupValue();
    const versionNumber = await this.getVersionNumber();

    // Owner-scope BEFORE mutating: rolling back another tenant's record is 404.
    const exists = await this.recordExists(lookupValue, this.getTenantScope());
    if (!exists) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    const versionManager = this.getVersionManager();
    const version = await versionManager.getVersion(lookupValue, versionNumber);

    if (!version) {
      throw new NotFoundException(`version ${versionNumber}`, lookupValue);
    }

    // Get current version number and increment
    const currentVersion = await versionManager.getLatestVersion(lookupValue);
    const newVersion = currentVersion + 1;

    // Rollback to the version data. The snapshot at rest is CIPHERTEXT for
    // encrypted fields and is written back verbatim by the adapter — it must NOT
    // be re-encrypted (that would `String()`-cast the `{ ct, iv, v }` envelope
    // and double-wrap it). The adapters' `rollback` bypass the encryptOnWrite
    // path exactly so the historical ciphertext survives intact.
    const result = await this.rollback(lookupValue, version.data, newVersion);

    // Decrypt the returned record for the response (mirrors update/restore). The
    // value at rest stays the historical ciphertext; this only affects the body.
    const decrypted = (await this.decryptOnRead(result as Record<string, unknown>)) as ModelObject<
      M['model']
    >;

    // Apply serializer if defined
    const serialized = this._meta.model.serializer
      ? this._meta.model.serializer(decrypted)
      : decrypted;

    return this.success(serialized);
  }
}
