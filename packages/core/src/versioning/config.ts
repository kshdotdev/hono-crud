/**
 * Versioning configuration normalization.
 */

import type { NormalizedVersioningConfig, VersioningConfig } from '../core/types';

/**
 * Get normalized versioning configuration with defaults.
 */
export function getVersioningConfig(
  config: VersioningConfig | undefined,
  tableName: string,
): NormalizedVersioningConfig {
  if (!config || !config.enabled) {
    return {
      enabled: false,
      field: 'version',
      historyTable: `${tableName}_history`,
      maxVersions: null,
      trackChangedBy: false,
      excludeFields: [],
    };
  }

  return {
    enabled: true,
    field: config.field || 'version',
    historyTable: config.historyTable || `${tableName}_history`,
    maxVersions: config.maxVersions ?? null,
    trackChangedBy: config.trackChangedBy ?? false,
    excludeFields: config.excludeFields || [],
    getUserId: config.getUserId,
  };
}
