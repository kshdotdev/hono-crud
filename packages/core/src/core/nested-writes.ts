/**
 * Helpers for separating nested-relation write data from the main record body.
 */

import type { RelationsConfig } from './types';

/**
 * Resolve the relations eligible for nested writes on the Update and Upsert
 * verbs: an explicit `allowNestedWrites` allow-list wins; otherwise every
 * relation whose `nestedWrites` config enables any write operation
 * (create / update / delete / connect / disconnect). Create uses a create-only
 * variant keyed on `allowCreate` and does not call this.
 *
 * @param relations - The model's relation configs (`Model.relations`)
 * @param allowNestedWrites - The endpoint's explicit allow-list override
 * @returns Names of relations that accept nested writes
 */
export function getNestedWritableRelations(
  relations: RelationsConfig | undefined,
  allowNestedWrites: string[],
): string[] {
  // If explicitly configured, use that
  if (allowNestedWrites.length > 0) {
    return allowNestedWrites;
  }

  // Otherwise, check relation configs
  if (!relations) return [];

  return Object.entries(relations)
    .filter(([_, config]) => {
      const nw = config.nestedWrites;
      return (
        nw &&
        (nw.allowCreate ||
          nw.allowUpdate ||
          nw.allowDelete ||
          nw.allowConnect ||
          nw.allowDisconnect)
      );
    })
    .map(([name]) => name);
}

/**
 * Extract nested write data from a request body.
 *
 * @param data - The request body data
 * @param relationNames - Names of relations that support nested writes
 * @returns Object with main data and nested data separated
 */
export function extractNestedData<T extends Record<string, unknown>>(
  data: T,
  relationNames: string[],
): {
  mainData: Record<string, unknown>;
  nestedData: Record<string, unknown>;
} {
  const mainData: Record<string, unknown> = {};
  const nestedData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (relationNames.includes(key) && value !== undefined) {
      nestedData[key] = value;
    } else {
      mainData[key] = value;
    }
  }

  return { mainData, nestedData };
}

/**
 * Check if nested data is a "create" operation (direct data vs operation object).
 * Direct data: { name: "John" } or [{ name: "John" }]
 * Operation object: { create: [...], update: [...] }
 */
export function isDirectNestedData(data: unknown): boolean {
  if (Array.isArray(data)) {
    return true;
  }
  if (typeof data === 'object' && data !== null) {
    const keys = Object.keys(data);
    const operationKeys = ['create', 'update', 'delete', 'connect', 'disconnect', 'set'];
    return !keys.some((key) => operationKeys.includes(key));
  }
  return false;
}
