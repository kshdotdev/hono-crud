export {
  type QueryBuilder,
  type Database,
  type DrizzleDatabaseConstraint,
  type DrizzleDatabase,
  type DrizzleDB,
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

import type { AdapterBundle } from '../../config/index';
import {
  DrizzleCreateEndpoint,
  DrizzleListEndpoint,
  DrizzleReadEndpoint,
  DrizzleUpdateEndpoint,
  DrizzleDeleteEndpoint,
  DrizzleRestoreEndpoint,
} from './crud';
import {
  DrizzleBatchCreateEndpoint,
  DrizzleBatchUpdateEndpoint,
  DrizzleBatchDeleteEndpoint,
  DrizzleBatchRestoreEndpoint,
} from './batch';
import {
  DrizzleSearchEndpoint,
  DrizzleAggregateEndpoint,
  DrizzleExportEndpoint,
  DrizzleImportEndpoint,
  DrizzleUpsertEndpoint,
  DrizzleBatchUpsertEndpoint,
  DrizzleCloneEndpoint,
} from './advanced';

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
