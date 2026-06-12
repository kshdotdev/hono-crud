export { getPrismaClient } from './connection';
export { createPrismaCrud, type PrismaCrudClasses } from './factory';
export * from './crud';
export * from './batch';
export * from './advanced';

import type { AdapterBundle } from 'hono-crud/internal';
import {
  PrismaAggregateEndpoint,
  PrismaBulkPatchEndpoint,
  PrismaCloneEndpoint,
  PrismaExportEndpoint,
  PrismaImportEndpoint,
  PrismaSearchEndpoint,
  PrismaUpsertEndpoint,
  PrismaVersionCompareEndpoint,
  PrismaVersionHistoryEndpoint,
  PrismaVersionReadEndpoint,
  PrismaVersionRollbackEndpoint,
} from './advanced';
import {
  PrismaBatchCreateEndpoint,
  PrismaBatchDeleteEndpoint,
  PrismaBatchRestoreEndpoint,
  PrismaBatchUpdateEndpoint,
  PrismaBatchUpsertEndpoint,
  PrismaRestoreEndpoint,
} from './batch';
import {
  PrismaCreateEndpoint,
  PrismaDeleteEndpoint,
  PrismaListEndpoint,
  PrismaReadEndpoint,
  PrismaUpdateEndpoint,
} from './crud';

/**
 * Prisma adapter bundle for use with `defineEndpoints`.
 *
 * Populates every `defineEndpoints` slot (all 22 verbs), including
 * `CloneEndpoint` (a stub that throws on request — subclass to implement).
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
  BulkPatchEndpoint: PrismaBulkPatchEndpoint,
  VersionHistoryEndpoint: PrismaVersionHistoryEndpoint,
  VersionReadEndpoint: PrismaVersionReadEndpoint,
  VersionCompareEndpoint: PrismaVersionCompareEndpoint,
  VersionRollbackEndpoint: PrismaVersionRollbackEndpoint,
};
