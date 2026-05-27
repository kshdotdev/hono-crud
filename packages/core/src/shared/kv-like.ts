/**
 * Minimal KV-store interface shared by Cloudflare KV and Redis backends
 * across cache/, rate-limit/, logging/, idempotency/.
 *
 * Each module's storage layer can require this base plus any extras it needs
 * (e.g. rate-limit additionally needs incr/zadd/zcount).
 */
export interface KvLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}
