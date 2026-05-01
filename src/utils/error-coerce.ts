/**
 * Low-level Error coercion helpers.
 *
 * Distinct from `src/core/exceptions.ts` which defines the typed
 * `ApiException` hierarchy; this module just turns unknown values
 * into `Error` instances.
 */

export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(String(value));
}

export function wrapError(error: unknown, context: string): Error {
  const base = toError(error);
  const wrapped = new Error(`${context}: ${base.message}`);
  wrapped.cause = base;
  return wrapped;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
