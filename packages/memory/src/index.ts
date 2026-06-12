export { clearStorage, getStore, storage } from './helpers';
export * from './crud';
export * from './batch';
export * from './advanced';

import type { AdapterBundle } from 'hono-crud/internal';
import {
  MemoryAggregateEndpoint,
  MemoryBulkPatchEndpoint,
  MemoryCloneEndpoint,
  MemoryExportEndpoint,
  MemoryImportEndpoint,
  MemorySearchEndpoint,
  MemoryUpsertEndpoint,
  MemoryVersionCompareEndpoint,
  MemoryVersionHistoryEndpoint,
  MemoryVersionReadEndpoint,
  MemoryVersionRollbackEndpoint,
} from './advanced';
import {
  MemoryBatchCreateEndpoint,
  MemoryBatchDeleteEndpoint,
  MemoryBatchRestoreEndpoint,
  MemoryBatchUpdateEndpoint,
  MemoryBatchUpsertEndpoint,
} from './batch';
import {
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryRestoreEndpoint,
  MemoryUpdateEndpoint,
} from './crud';

/**
 * Pre-built adapter bundle wiring the in-memory endpoint classes for use with
 * `defineEndpoints` from `hono-crud`.
 *
 * @example
 * ```ts
 * import { defineEndpoints } from 'hono-crud/config';
 * import { MemoryAdapters } from '@hono-crud/memory';
 *
 * const userEndpoints = defineEndpoints({ meta: userMeta, list: {}, create: {} }, MemoryAdapters);
 * ```
 */
export const MemoryAdapters: AdapterBundle = {
  CreateEndpoint: MemoryCreateEndpoint,
  ListEndpoint: MemoryListEndpoint,
  ReadEndpoint: MemoryReadEndpoint,
  UpdateEndpoint: MemoryUpdateEndpoint,
  DeleteEndpoint: MemoryDeleteEndpoint,
  SearchEndpoint: MemorySearchEndpoint,
  AggregateEndpoint: MemoryAggregateEndpoint,
  RestoreEndpoint: MemoryRestoreEndpoint,
  BatchCreateEndpoint: MemoryBatchCreateEndpoint,
  BatchUpdateEndpoint: MemoryBatchUpdateEndpoint,
  BatchDeleteEndpoint: MemoryBatchDeleteEndpoint,
  BatchRestoreEndpoint: MemoryBatchRestoreEndpoint,
  BatchUpsertEndpoint: MemoryBatchUpsertEndpoint,
  ExportEndpoint: MemoryExportEndpoint,
  ImportEndpoint: MemoryImportEndpoint,
  UpsertEndpoint: MemoryUpsertEndpoint,
  CloneEndpoint: MemoryCloneEndpoint,
  BulkPatchEndpoint: MemoryBulkPatchEndpoint,
  VersionHistoryEndpoint: MemoryVersionHistoryEndpoint,
  VersionReadEndpoint: MemoryVersionReadEndpoint,
  VersionCompareEndpoint: MemoryVersionCompareEndpoint,
  VersionRollbackEndpoint: MemoryVersionRollbackEndpoint,
};
