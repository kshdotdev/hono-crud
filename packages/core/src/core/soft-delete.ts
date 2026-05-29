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
