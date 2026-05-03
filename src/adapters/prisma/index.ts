export {
  registerPrismaModelMapping,
  registerPrismaModelMappings,
  clearPrismaModelMappings,
} from './helpers';
export * from './crud';
export * from './batch';
export * from './advanced';

import type { AdapterBundle } from '../../config/index';
import {
  PrismaCreateEndpoint,
  PrismaListEndpoint,
  PrismaReadEndpoint,
  PrismaUpdateEndpoint,
  PrismaDeleteEndpoint,
} from './crud';
import {
  PrismaRestoreEndpoint,
  PrismaBatchCreateEndpoint,
  PrismaBatchUpdateEndpoint,
  PrismaBatchDeleteEndpoint,
  PrismaBatchRestoreEndpoint,
  PrismaBatchUpsertEndpoint,
} from './batch';
import {
  PrismaSearchEndpoint,
  PrismaAggregateEndpoint,
  PrismaExportEndpoint,
  PrismaImportEndpoint,
  PrismaUpsertEndpoint,
  PrismaCloneEndpoint,
} from './advanced';

/**
 * Prisma adapter bundle for use with `defineEndpoints`.
 *
 * Populates the 11 verbs Prisma implements natively plus a stub
 * `CloneEndpoint` (throws on request — subclass to implement).
 *
 * @example
 * ```ts
 * const endpoints = defineEndpoints({ meta, create: {}, search: { fields: ['name'] } }, PrismaAdapters);
 * ```
 */
export const PrismaAdapters: AdapterBundle = {
  CreateEndpoint: PrismaCreateEndpoint,
  ListEndpoint: PrismaListEndpoint,
  ReadEndpoint: PrismaReadEndpoint,
  UpdateEndpoint: PrismaUpdateEndpoint,
  DeleteEndpoint: PrismaDeleteEndpoint,
  RestoreEndpoint: PrismaRestoreEndpoint,
  BatchCreateEndpoint: PrismaBatchCreateEndpoint,
  BatchUpdateEndpoint: PrismaBatchUpdateEndpoint,
  BatchDeleteEndpoint: PrismaBatchDeleteEndpoint,
  BatchRestoreEndpoint: PrismaBatchRestoreEndpoint,
  BatchUpsertEndpoint: PrismaBatchUpsertEndpoint,
  SearchEndpoint: PrismaSearchEndpoint,
  AggregateEndpoint: PrismaAggregateEndpoint,
  ExportEndpoint: PrismaExportEndpoint,
  ImportEndpoint: PrismaImportEndpoint,
  UpsertEndpoint: PrismaUpsertEndpoint,
  CloneEndpoint: PrismaCloneEndpoint,
};
