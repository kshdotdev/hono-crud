/**
 * @deprecated This module has been renamed to `src/utils/error-coerce.ts`
 * to disambiguate from the `ApiException` hierarchy in `src/core/exceptions.ts`.
 * Existing imports continue to work via this re-export shim.
 */
export { toError, wrapError, getErrorMessage } from './error-coerce';
