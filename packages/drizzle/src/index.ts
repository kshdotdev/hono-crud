export {
  type QueryBuilder,
  type Database,
  type DrizzleDatabaseConstraint,
  type DrizzleTable,
  type DrizzleColumn,
  type DrizzleSql,
  type DrizzleDialect,
  type DrizzleEnv,
  type CountRow,
  DRIZZLE_DIALECTS,
  cast,
  getTable,
  getColumn,
  loadDrizzleRelation,
  loadDrizzleRelations,
  batchLoadDrizzleRelations,
  buildWhereCondition,
  readCount,
} from './helpers';
export * from './crud';
export * from './batch';
export * from './advanced';
export * from './factory';
export * from './versioning-storage';

// Re-export drizzle-zod schema utilities
export {
  createSelectSchema,
  createInsertSchema,
  createUpdateSchema,
  createDrizzleSchemas,
  isDrizzleZodAvailable,
} from './schema-utils';
export type { DrizzleSchemas } from './schema-utils';

import type { AdapterBundle } from 'hono-crud/internal';
import {
  DrizzleAggregateEndpoint,
  DrizzleBatchUpsertEndpoint,
  DrizzleBulkPatchEndpoint,
  DrizzleCloneEndpoint,
  DrizzleExportEndpoint,
  DrizzleImportEndpoint,
  DrizzleSearchEndpoint,
  DrizzleUpsertEndpoint,
  DrizzleVersionCompareEndpoint,
  DrizzleVersionHistoryEndpoint,
  DrizzleVersionReadEndpoint,
  DrizzleVersionRollbackEndpoint,
} from './advanced';
import {
  DrizzleBatchCreateEndpoint,
  DrizzleBatchDeleteEndpoint,
  DrizzleBatchRestoreEndpoint,
  DrizzleBatchUpdateEndpoint,
} from './batch';
import {
  DrizzleCreateEndpoint,
  DrizzleDeleteEndpoint,
  DrizzleListEndpoint,
  DrizzleReadEndpoint,
  DrizzleRestoreEndpoint,
  DrizzleUpdateEndpoint,
} from './crud';

/**
 * Drizzle adapter bundle for use with `defineEndpoints`.
 *
 * Populates every `defineEndpoints` slot (all 22 verbs), including
 * `CloneEndpoint` (a stub that throws on request — subclass to implement).
 *
 * @example
 * ```ts
 * const endpoints = defineEndpoints({ meta, create: {}, search: { fields: ['name'] } }, DrizzleAdapters);
 * ```
 */
export const DrizzleAdapters: AdapterBundle = {
  CreateEndpoint: DrizzleCreateEndpoint,
  ListEndpoint: DrizzleListEndpoint,
  ReadEndpoint: DrizzleReadEndpoint,
  UpdateEndpoint: DrizzleUpdateEndpoint,
  DeleteEndpoint: DrizzleDeleteEndpoint,
  RestoreEndpoint: DrizzleRestoreEndpoint,
  BatchCreateEndpoint: DrizzleBatchCreateEndpoint,
  BatchUpdateEndpoint: DrizzleBatchUpdateEndpoint,
  BatchDeleteEndpoint: DrizzleBatchDeleteEndpoint,
  BatchRestoreEndpoint: DrizzleBatchRestoreEndpoint,
  BatchUpsertEndpoint: DrizzleBatchUpsertEndpoint,
  SearchEndpoint: DrizzleSearchEndpoint,
  AggregateEndpoint: DrizzleAggregateEndpoint,
  ExportEndpoint: DrizzleExportEndpoint,
  ImportEndpoint: DrizzleImportEndpoint,
  UpsertEndpoint: DrizzleUpsertEndpoint,
  CloneEndpoint: DrizzleCloneEndpoint,
  BulkPatchEndpoint: DrizzleBulkPatchEndpoint,
  VersionHistoryEndpoint: DrizzleVersionHistoryEndpoint,
  VersionReadEndpoint: DrizzleVersionReadEndpoint,
  VersionCompareEndpoint: DrizzleVersionCompareEndpoint,
  VersionRollbackEndpoint: DrizzleVersionRollbackEndpoint,
};
