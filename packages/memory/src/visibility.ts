/**
 * Visibility predicate shared across the memory adapter.
 *
 * A record is visible when:
 *   - it is not soft-deleted (if soft-delete is configured), AND
 *   - all `additionalFilters` keys exist with matching string values.
 *
 * Used by every memory CRUD/batch/advanced endpoint to replace the 11+
 * inlined "if deletedAt !== null && deletedAt !== undefined" / "for…of
 * additionalFilters" checks.
 */

export interface SoftDeleteConfig {
  enabled: boolean;
  field: string;
}

export function isVisible(
  record: unknown,
  softDelete: SoftDeleteConfig,
  additionalFilters?: Record<string, string>
): boolean {
  if (record === null || record === undefined || typeof record !== 'object') {
    return false;
  }
  const data = record as Record<string, unknown>;

  if (softDelete.enabled) {
    const deletedAt = data[softDelete.field];
    if (deletedAt !== null && deletedAt !== undefined) return false;
  }

  if (additionalFilters) {
    for (const [key, value] of Object.entries(additionalFilters)) {
      if (String(data[key]) !== value) return false;
    }
  }

  return true;
}
