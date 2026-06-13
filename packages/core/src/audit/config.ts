/**
 * Audit configuration normalization + field-change diffing.
 */

import type { AuditConfig, AuditFieldChange, NormalizedAuditConfig } from '../core/types';

/**
 * Get normalized audit configuration with defaults.
 * Accepts the model-side union: `true` enables with defaults, a config
 * object enables with overrides, `false`/`undefined` disables.
 */
export function getAuditConfig(config?: boolean | AuditConfig): NormalizedAuditConfig {
  if (!config) {
    return {
      enabled: false,
      tableName: 'audit_logs',
      actions: [],
      excludeFields: [],
      storeRecord: true,
      storePreviousRecord: true,
      trackChanges: true,
    };
  }

  const overrides: AuditConfig = config === true ? {} : config;

  return {
    enabled: true,
    tableName: overrides.tableName || 'audit_logs',
    actions: overrides.actions || ['create', 'update', 'delete'],
    excludeFields: overrides.excludeFields || [],
    storeRecord: overrides.storeRecord ?? true,
    storePreviousRecord: overrides.storePreviousRecord ?? true,
    trackChanges: overrides.trackChanges ?? true,
    getUserId: overrides.getUserId,
  };
}

/**
 * Calculate field changes between two records.
 */
export function calculateChanges(
  oldRecord: Record<string, unknown> | undefined,
  newRecord: Record<string, unknown> | undefined,
  excludeFields: string[] = [],
): AuditFieldChange[] {
  const changes: AuditFieldChange[] = [];

  if (!oldRecord && !newRecord) {
    return changes;
  }

  const allKeys = new Set([...Object.keys(oldRecord || {}), ...Object.keys(newRecord || {})]);

  for (const key of allKeys) {
    if (excludeFields.includes(key)) continue;

    const oldValue = oldRecord?.[key];
    const newValue = newRecord?.[key];

    // Deep comparison for objects
    const oldStr = JSON.stringify(oldValue);
    const newStr = JSON.stringify(newValue);

    if (oldStr !== newStr) {
      changes.push({
        field: key,
        oldValue,
        newValue,
      });
    }
  }

  return changes;
}
