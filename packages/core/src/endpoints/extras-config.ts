/**
 * Typed "extras" payloads for the extended-verb endpoints.
 *
 * The shared 5-verb surface (create/read/update/delete/list) has dedicated
 * typed fields on `NormalizedEndpointConfig`. The remaining verbs carry their
 * verb-specific options through `config.extras`, which is `Object.assign`ed
 * onto the generated endpoint instance to override its `protected` defaults.
 *
 * These types give that bridge compile-time safety: the config-API build
 * sites in `config/index.ts` type their `extras` object as the matching
 * `*Extras` type, so a misspelled or unknown key is a `tsc` error instead of
 * a silently-ignored option. Each key here must match a `protected` field on
 * the corresponding endpoint base class.
 */

import type { SearchMode } from '../core/types';
import type { ExportFormat } from './export';

/** Overrides for `SearchEndpoint` (`searchFields`, `defaultMode`, `searchParamName`). */
export type SearchExtras = {
  searchFields?: string[];
  defaultMode?: SearchMode;
  searchParamName?: string;
};

/** Overrides for `AggregateEndpoint`. */
export type AggregateExtras = {
  filterFields?: string[];
};

/** Overrides for the batch-create/update/delete/restore endpoints. */
export type BatchExtras = {
  maxBatchSize?: number;
};

/** Overrides for `UpsertEndpoint`. */
export type UpsertExtras = {
  upsertKeys?: string[];
};

/** Overrides for `BatchUpsertEndpoint`. */
export type BatchUpsertExtras = {
  maxBatchSize?: number;
  upsertKeys?: string[];
};

/** Overrides for `ExportEndpoint`. */
export type ExportExtras = {
  maxExportRecords?: number;
  defaultFormat?: ExportFormat;
};

/** Overrides for `ImportEndpoint`. */
export type ImportExtras = {
  maxBatchSize?: number;
};

/** Overrides for `CloneEndpoint`. */
export type CloneExtras = {
  excludeFromClone?: string[];
};

/** Union of every extended-verb extras payload. */
export type EndpointExtras =
  | SearchExtras
  | AggregateExtras
  | BatchExtras
  | UpsertExtras
  | BatchUpsertExtras
  | ExportExtras
  | ImportExtras
  | CloneExtras;
