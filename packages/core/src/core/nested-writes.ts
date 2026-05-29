/**
 * Helpers for separating nested-relation write data from the main record body.
 */

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
