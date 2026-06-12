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
 * a silently-ignored option. Each key here must match a `protected` field or
 * lifecycle method on the corresponding endpoint base class (Object.assign
 * shadows a prototype method with an instance property, which is how the
 * non-`before`/`after` hook names are wired).
 *
 * Hook-valued keys are typed loosely (`AnyExtraHook`) because the extras
 * bridge is not generic over the model; the precise signatures live on the
 * config-API hook bags in `config/index.ts`, which are the typed surface
 * consumers write against.
 */

import type { SearchMode } from '../core/types';
import type { ExportFormat } from './export';

type AnyExtraHook = (...args: never[]) => unknown;

/** Overrides for `SearchEndpoint` (`searchFields`, `defaultMode`, `searchParamName`, `afterSearch`). */
export type SearchExtras = {
  searchFields?: string[];
  defaultMode?: SearchMode;
  searchParamName?: string;
  /** Wires the config-API `hooks.after` to `SearchEndpoint.afterSearch`. */
  afterSearch?: AnyExtraHook;
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
  /** Wires the config-API `hooks.before` to `BatchUpsertEndpoint.beforeBatch`. */
  beforeBatch?: AnyExtraHook;
  /** Wires the config-API `hooks.after` to `BatchUpsertEndpoint.afterBatch`. */
  afterBatch?: AnyExtraHook;
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

/** Overrides for `BulkPatchEndpoint`. */
export type BulkPatchExtras = {
  filterFields?: string[];
  maxBulkSize?: number;
  confirmThreshold?: number;
  returnRecords?: boolean;
};

/** Overrides for `VersionHistoryEndpoint`. */
export type VersionHistoryExtras = {
  defaultLimit?: number;
  maxLimit?: number;
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
  | CloneExtras
  | BulkPatchExtras
  | VersionHistoryExtras;
