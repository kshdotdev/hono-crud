/**
 * Cursor-pagination codec. Opaque base64 wrapper around a cursor value.
 */

/** Encodes a cursor value to an opaque base64 string. */
export function encodeCursor(value: string | number): string {
  return btoa(String(value));
}

/**
 * Decodes an opaque cursor string back to the original value.
 * Returns null if the cursor is invalid.
 */
export function decodeCursor(cursor: string): string | null {
  try {
    return atob(cursor);
  } catch {
    return null;
  }
}
