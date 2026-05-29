/**
 * Audit configuration normalization + field-change diffing.
 */

import type { AuditConfig, AuditFieldChange, NormalizedAuditConfig } from '../core/types';

/**
 * Get normalized audit configuration with defaults.
 */
export function getAuditConfig(config?: AuditConfig): NormalizedAuditConfig {
  if (!config || !config.enabled) {
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

  return {
    enabled: true,
    tableName: config.tableName || 'audit_logs',
    actions: config.actions || ['create', 'update', 'delete'],
    excludeFields: config.excludeFields || [],
    storeRecord: config.storeRecord ?? true,
    storePreviousRecord: config.storePreviousRecord ?? true,
    trackChanges: config.trackChanges ?? true,
    getUserId: config.getUserId,
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
