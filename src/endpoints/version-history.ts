import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { OpenAPIRoute } from '../core/route';
import type {
  MetaInput,
  OpenAPIRouteSchema,
  NormalizedVersioningConfig,
} from '../core/types';
import { getVersioningConfig } from '../core/types';
import { ApiException, NotFoundException } from '../core/exceptions';
import type { ModelObject } from './types';
import { createVersionManager, type VersionManager } from '../core/versioning';

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
  changes: z.array(z.object({
    field: z.string(),
    oldValue: z.unknown().optional(),
    newValue: z.unknown().optional(),
  })).optional(),
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
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  /** The field used to identify the parent record */
  protected lookupField: string = 'id';

  /** Default number of versions to return */
  protected defaultLimit: number = 20;

  /** Maximum number of versions to return */
  protected maxLimit: number = 100;

  // Versioning
  private _versionManager?: VersionManager;

  /**
   * Get the version manager for this endpoint.
   */
  protected getVersionManager(): VersionManager {
    if (!this._versionManager) {
      this._versionManager = createVersionManager(
        this._meta.model.versioning,
        this._meta.model.tableName
      );
    }
    return this._versionManager;
  }

  /**
   * Get the versioning configuration for this model.
   */
  protected getVersioningConfig(): NormalizedVersioningConfig {
    return getVersioningConfig(this._meta.model.versioning, this._meta.model.tableName);
  }

  /**
   * Check if versioning is enabled for this model.
   */
  protected isVersioningEnabled(): boolean {
    return this.getVersioningConfig().enabled;
  }

  /**
   * Returns the path parameter schema.
   */
  protected getParamsSchema(): ZodObject<ZodRawShape> {
    return z.object({
      [this.lookupField]: z.string(),
    }) as unknown as ZodObject<ZodRawShape>;
  }

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
    return {
      ...this.schema,
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
        400: {
          description: 'Versioning not enabled',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                }),
              }),
            },
          },
        },
        404: {
          description: 'Record not found',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                }),
              }),
            },
          },
        },
      },
    };
  }

  /**
   * Gets the lookup value from path parameters.
   */
  protected async getLookupValue(): Promise<string> {
    const { params } = await this.getValidatedData();
    return params?.[this.lookupField] || '';
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
    _lookupValue: string
  ): Promise<boolean> {
    // Default implementation - override in adapter
    return true;
  }

  /**
   * Main handler.
   */
  async handle(): Promise<Response> {

    if (!this.isVersioningEnabled()) {
      throw new ApiException('Versioning is not enabled for this model', 400, 'VERSIONING_NOT_ENABLED');
    }

    const lookupValue = await this.getLookupValue();
    const { limit, offset } = await this.getPaginationOptions();

    // Check if record exists
    const exists = await this.recordExists(lookupValue);
    if (!exists) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    const versionManager = this.getVersionManager();
    const versions = await versionManager.getVersions(lookupValue, { limit, offset });
    const latestVersion = await versionManager.getLatestVersion(lookupValue);

    return this.success({
      versions,
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
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  /** The field used to identify the parent record */
  protected lookupField: string = 'id';

  // Versioning
  private _versionManager?: VersionManager;

  /**
   * Get the version manager for this endpoint.
   */
  protected getVersionManager(): VersionManager {
    if (!this._versionManager) {
      this._versionManager = createVersionManager(
        this._meta.model.versioning,
        this._meta.model.tableName
      );
    }
    return this._versionManager;
  }

  /**
   * Get the versioning configuration for this model.
   */
  protected getVersioningConfig(): NormalizedVersioningConfig {
    return getVersioningConfig(this._meta.model.versioning, this._meta.model.tableName);
  }

  /**
   * Check if versioning is enabled for this model.
   */
  protected isVersioningEnabled(): boolean {
    return this.getVersioningConfig().enabled;
  }

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
    return {
      ...this.schema,
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
        400: {
          description: 'Versioning not enabled',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                }),
              }),
            },
          },
        },
        404: {
          description: 'Version not found',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                }),
              }),
            },
          },
        },
      },
    };
  }

  /**
   * Gets the lookup value from path parameters.
   */
  protected async getLookupValue(): Promise<string> {
    const { params } = await this.getValidatedData();
    return params?.[this.lookupField] || '';
  }

  /**
   * Gets the version number from path parameters.
   */
  protected async getVersionNumber(): Promise<number> {
    const { params } = await this.getValidatedData();
    return params?.version ? Number(params.version) : 0;
  }

  /**
   * Main handler.
   */
  async handle(): Promise<Response> {

    if (!this.isVersioningEnabled()) {
      throw new ApiException('Versioning is not enabled for this model', 400, 'VERSIONING_NOT_ENABLED');
    }

    const lookupValue = await this.getLookupValue();
    const versionNumber = await this.getVersionNumber();

    const versionManager = this.getVersionManager();
    const version = await versionManager.getVersion(lookupValue, versionNumber);

    if (!version) {
      throw new NotFoundException(`version ${versionNumber}`, lookupValue);
    }

    return this.success(version);
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
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  /** The field used to identify the parent record */
  protected lookupField: string = 'id';

  // Versioning
  private _versionManager?: VersionManager;

  /**
   * Get the version manager for this endpoint.
   */
  protected getVersionManager(): VersionManager {
    if (!this._versionManager) {
      this._versionManager = createVersionManager(
        this._meta.model.versioning,
        this._meta.model.tableName
      );
    }
    return this._versionManager;
  }

  /**
   * Get the versioning configuration for this model.
   */
  protected getVersioningConfig(): NormalizedVersioningConfig {
    return getVersioningConfig(this._meta.model.versioning, this._meta.model.tableName);
  }

  /**
   * Check if versioning is enabled for this model.
   */
  protected isVersioningEnabled(): boolean {
    return this.getVersioningConfig().enabled;
  }

  /**
   * Returns the path parameter schema.
   */
  protected getParamsSchema(): ZodObject<ZodRawShape> {
    return z.object({
      [this.lookupField]: z.string(),
    }) as unknown as ZodObject<ZodRawShape>;
  }

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
    return {
      ...this.schema,
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
                  changes: z.array(z.object({
                    field: z.string(),
                    oldValue: z.unknown().optional(),
                    newValue: z.unknown().optional(),
                  })),
                }),
              }),
            },
          },
        },
        400: {
          description: 'Versioning not enabled or invalid parameters',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                }),
              }),
            },
          },
        },
        404: {
          description: 'Version not found',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                }),
              }),
            },
          },
        },
      },
    };
  }

  /**
   * Gets the lookup value from path parameters.
   */
  protected async getLookupValue(): Promise<string> {
    const { params } = await this.getValidatedData();
    return params?.[this.lookupField] || '';
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
   * Main handler.
   */
  async handle(): Promise<Response> {

    if (!this.isVersioningEnabled()) {
      throw new ApiException('Versioning is not enabled for this model', 400, 'VERSIONING_NOT_ENABLED');
    }

    const lookupValue = await this.getLookupValue();
    const { from, to } = await this.getVersionNumbers();

    const versionManager = this.getVersionManager();
    const changes = await versionManager.compareVersions(lookupValue, from, to);

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
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  /** The field used to identify the parent record */
  protected lookupField: string = 'id';

  // Versioning
  private _versionManager?: VersionManager;

  /**
   * Get the version manager for this endpoint.
   */
  protected getVersionManager(): VersionManager {
    if (!this._versionManager) {
      this._versionManager = createVersionManager(
        this._meta.model.versioning,
        this._meta.model.tableName
      );
    }
    return this._versionManager;
  }

  /**
   * Get the versioning configuration for this model.
   */
  protected getVersioningConfig(): NormalizedVersioningConfig {
    return getVersioningConfig(this._meta.model.versioning, this._meta.model.tableName);
  }

  /**
   * Check if versioning is enabled for this model.
   */
  protected isVersioningEnabled(): boolean {
    return this.getVersioningConfig().enabled;
  }

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
    return {
      ...this.schema,
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
                result: this._meta.model.schema,
              }),
            },
          },
        },
        400: {
          description: 'Versioning not enabled',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                }),
              }),
            },
          },
        },
        404: {
          description: 'Version not found',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                }),
              }),
            },
          },
        },
      },
    };
  }

  /**
   * Gets the lookup value from path parameters.
   */
  protected async getLookupValue(): Promise<string> {
    const { params } = await this.getValidatedData();
    return params?.[this.lookupField] || '';
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
    tx?: unknown
  ): Promise<ModelObject<M['model']>>;

  /**
   * Main handler.
   */
  async handle(): Promise<Response> {

    if (!this.isVersioningEnabled()) {
      throw new ApiException('Versioning is not enabled for this model', 400, 'VERSIONING_NOT_ENABLED');
    }

    const lookupValue = await this.getLookupValue();
    const versionNumber = await this.getVersionNumber();

    const versionManager = this.getVersionManager();
    const version = await versionManager.getVersion(lookupValue, versionNumber);

    if (!version) {
      throw new NotFoundException(`version ${versionNumber}`, lookupValue);
    }

    // Get current version number and increment
    const currentVersion = await versionManager.getLatestVersion(lookupValue);
    const newVersion = currentVersion + 1;

    // Rollback to the version data
    const result = await this.rollback(lookupValue, version.data, newVersion);

    // Apply serializer if defined
    const serialized = this._meta.model.serializer
      ? this._meta.model.serializer(result)
      : result;

    return this.success(serialized);
  }
}
