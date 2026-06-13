/**
 * Versioning configuration normalization.
 */

import type { NormalizedVersioningConfig, VersioningConfig } from '../core/types';

/**
 * Get normalized versioning configuration with defaults.
 * Accepts the model-side union: `true` enables with defaults, a config
 * object enables with overrides, `false`/`undefined` disables.
 */
export function getVersioningConfig(
  config: boolean | VersioningConfig | undefined,
  tableName: string,
): NormalizedVersioningConfig {
  if (!config) {
    return {
      enabled: false,
      field: 'version',
      historyTable: `${tableName}_history`,
      maxVersions: null,
      trackChangedBy: false,
      excludeFields: [],
    };
  }

  const overrides: VersioningConfig = config === true ? {} : config;

  return {
    enabled: true,
    field: overrides.field || 'version',
    historyTable: overrides.historyTable || `${tableName}_history`,
    maxVersions: overrides.maxVersions ?? null,
    trackChangedBy: overrides.trackChangedBy ?? false,
    excludeFields: overrides.excludeFields || [],
    getUserId: overrides.getUserId,
  };
}
