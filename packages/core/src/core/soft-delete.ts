/**
 * Normalize a model's soft-delete configuration.
 */

import type { NormalizedSoftDeleteConfig, SoftDeleteConfig } from './types';

/**
 * Get normalized soft delete configuration from a model.
 * Returns a consistent config object with all defaults applied.
 */
export function getSoftDeleteConfig(
  softDelete: boolean | SoftDeleteConfig | undefined,
): NormalizedSoftDeleteConfig {
  if (!softDelete) {
    return {
      enabled: false,
      field: 'deletedAt',
      allowQueryDeleted: true,
      queryParam: 'withDeleted',
    };
  }

  if (softDelete === true) {
    return {
      enabled: true,
      field: 'deletedAt',
      allowQueryDeleted: true,
      queryParam: 'withDeleted',
    };
  }

  return {
    enabled: true,
    field: softDelete.field ?? 'deletedAt',
    allowQueryDeleted: softDelete.allowQueryDeleted ?? true,
    queryParam: softDelete.queryParam ?? 'withDeleted',
  };
}

/**
 * Inject the soft-delete restore into upsert-family update data.
 *
 * Upsert-family endpoints (upsert / import / batchUpsert) MATCH soft-deleted
 * rows in `findExisting` and restore them on update ("match-and-restore").
 * Treating deleted rows as absent would attempt a fresh insert, which hits
 * the unique constraint backing the upsert keys on SQL adapters (or silently
 * creates a duplicate logical row in memory).
 */
export function applyUpsertRestore(
  data: Record<string, unknown>,
  existing: Record<string, unknown>,
  softDeleteConfig: NormalizedSoftDeleteConfig,
): Record<string, unknown> {
  if (softDeleteConfig.enabled && existing[softDeleteConfig.field] != null) {
    return { ...data, [softDeleteConfig.field]: null };
  }
  return data;
}
