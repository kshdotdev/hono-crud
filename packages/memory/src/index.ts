export { clearStorage, getStorage, getStore, storage } from './helpers';
export * from './crud';
export * from './batch';
export * from './advanced';

import type { AdapterBundle } from 'hono-crud/internal';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryRestoreEndpoint,
} from './crud';
import {
  MemoryBatchCreateEndpoint,
  MemoryBatchUpdateEndpoint,
  MemoryBatchDeleteEndpoint,
  MemoryBatchRestoreEndpoint,
  MemoryBatchUpsertEndpoint,
} from './batch';
import {
  MemorySearchEndpoint,
  MemoryAggregateEndpoint,
  MemoryExportEndpoint,
  MemoryImportEndpoint,
  MemoryUpsertEndpoint,
  MemoryCloneEndpoint,
} from './advanced';

/**
 * Pre-built adapter bundle wiring the in-memory endpoint classes for use with
 * `defineEndpoints` from `hono-crud`.
 *
 * @example
 * ```ts
 * import { defineEndpoints } from 'hono-crud';
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
};
