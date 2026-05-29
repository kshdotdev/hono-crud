/**
 * Apply model computed-field functions to records.
 */

import type { ComputedFieldsConfig } from './types';

/**
 * Apply computed fields to a single record.
 * @param record - The record to add computed fields to
 * @param computedFields - The computed fields configuration
 * @returns The record with computed fields added
 */
export async function applyComputedFields<T extends Record<string, unknown>>(
  record: T,
  computedFields?: ComputedFieldsConfig<T>,
): Promise<Record<string, unknown>> {
  if (!computedFields || Object.keys(computedFields).length === 0) {
    return record;
  }

  const result: Record<string, unknown> = { ...record };

  for (const [fieldName, config] of Object.entries(computedFields)) {
    try {
      const value = await config.compute(record);
      result[fieldName] = value;
    } catch {
      // If computation fails, set field to undefined
      result[fieldName] = undefined;
    }
  }

  return result;
}

/**
 * Apply computed fields to an array of records.
 * @param records - The records to add computed fields to
 * @param computedFields - The computed fields configuration
 * @returns The records with computed fields added
 */
export async function applyComputedFieldsToArray<T extends Record<string, unknown>>(
  records: T[],
  computedFields?: ComputedFieldsConfig<T>,
): Promise<Array<Record<string, unknown>>> {
  if (!computedFields || Object.keys(computedFields).length === 0) {
    return records;
  }

  return Promise.all(records.map((record) => applyComputedFields(record, computedFields)));
}
