export {
  type QueryBuilder,
  type Database,
  type DrizzleDatabaseConstraint,
  type DrizzleDatabase,
  type DrizzleDB,
  type DrizzleDialect,
  type DrizzleEnv,
  cast,
  getTable,
  getColumn,
  loadDrizzleRelation,
  loadDrizzleRelations,
  batchLoadDrizzleRelations,
  buildWhereCondition,
} from './helpers';
export * from './crud';
export * from './batch';
export * from './advanced';
export * from './factory';

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
  DrizzleCloneEndpoint,
  DrizzleExportEndpoint,
  DrizzleImportEndpoint,
  DrizzleSearchEndpoint,
  DrizzleUpsertEndpoint,
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
 * Populates the 11 verbs Drizzle implements natively plus a stub
 * `CloneEndpoint` (throws on request — subclass to implement).
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
};
