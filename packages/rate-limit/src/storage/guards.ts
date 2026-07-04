import type { FixedWindowEntry, SlidingWindowEntry } from '../types';

/**
 * Runtime validators for rate-limit entries read back from external storage
 * (Redis values, Lua-script results, KV JSON). Shared by every adapter so a
 * malformed or foreign value is rejected instead of being cast into a window
 * entry — for a rate limiter, blessing garbage means silently weakened limits.
 */
export function isFixedWindowEntry(value: unknown): value is FixedWindowEntry {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.count === 'number' && typeof record.windowStart === 'number';
}

export function isSlidingWindowEntry(value: unknown): value is SlidingWindowEntry {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.timestamps) && record.timestamps.every((item) => typeof item === 'number')
  );
}
