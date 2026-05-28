/**
 * Prefix wrapper for KV stores. Owns the `prefix + ":" + key` plumbing
 * so storage backends share one key-namespacing convention instead of
 * repeating it inline.
 */
export class PrefixedKv {
  constructor(
    private readonly prefix: string,
    private readonly separator: string = ':',
  ) {}

  key(suffix: string): string {
    return `${this.prefix}${this.separator}${suffix}`;
  }

  unkey(prefixed: string): string {
    const head = `${this.prefix}${this.separator}`;
    return prefixed.startsWith(head) ? prefixed.slice(head.length) : prefixed;
  }
}
