/**
 * Tiny edge-safe parser for ISO 8601 duration strings.
 *
 * Supports the subset hono-crud cares about: `P[nD][T[nH][nM][nS]]`.
 * Examples: `P1D` → 86_400_000ms, `PT15M` → 900_000ms, `P1DT2H` →
 * 93_600_000ms.
 *
 * Years and months are rejected (variable length — not meaningful for
 * approval expiry windows). Throws on malformed input.
 *
 * No node:* imports, no Buffer, no regex with catastrophic backtracking.
 */
const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

export function parseIso8601Duration(input: string): number {
  const match = ISO_DURATION.exec(input);
  if (!match) {
    throw new Error(
      `Invalid ISO 8601 duration: ${input}. Use P[nD][T[nH][nM][nS]] (years and months unsupported).`
    );
  }
  const [, days, hours, minutes, seconds] = match;
  const ms =
    (days ? Number(days) * 86_400_000 : 0) +
    (hours ? Number(hours) * 3_600_000 : 0) +
    (minutes ? Number(minutes) * 60_000 : 0) +
    (seconds ? Number(seconds) * 1_000 : 0);
  if (ms === 0 && input !== 'PT0S' && input !== 'P0D') {
    throw new Error(
      `ISO 8601 duration ${input} parsed to zero milliseconds — verify the format.`
    );
  }
  return ms;
}
