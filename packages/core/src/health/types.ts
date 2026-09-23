import type { Context, Env } from 'hono';

/**
 * Result of a single health check.
 */
export interface HealthCheckResult {
  /** Name of the check */
  name: string;
  /** Whether the check passed */
  healthy: boolean;
  /** Time taken in milliseconds */
  latency: number;
  /** Optional message (e.g. error details) */
  message?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A health check function.
 * Returns true/message for healthy, throws/returns false for unhealthy.
 * Checks that resolve with nothing (`Promise<void>`) count as healthy.
 *
 * Receives the readiness request's context, so a probe can reach
 * per-request resources such as `c.env` bindings on Cloudflare Workers.
 * Zero-argument checks are of course still valid.
 */
export type HealthCheckFn<E extends Env = Env> = (
  ctx: Context<E>,
) => Promise<boolean | string> | Promise<void>;

/**
 * Named health check registration.
 */
export interface HealthCheck<E extends Env = Env> {
  /** Unique name for this check */
  name: string;
  /** The check function to execute */
  check: HealthCheckFn<E>;
  /** Whether this check is critical (affects overall status). @default true */
  critical?: boolean;
  /** Timeout in milliseconds for this check. @default 5000 */
  timeoutMs?: number;
}

/**
 * Overall health response.
 */
export interface HealthResponse {
  /** Overall status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Individual check results */
  checks: HealthCheckResult[];
  /** Total latency of all checks in milliseconds */
  latency: number;
  /** ISO timestamp of the check */
  timestamp: string;
  /** Application version if provided */
  version?: string;
}

/**
 * Configuration for health endpoints.
 */
export interface HealthConfig<E extends Env = Env> {
  /** Health checks to run */
  checks?: HealthCheck<E>[];
  /** Application version string */
  version?: string;
  /** Path for the liveness endpoint. @default '/health' */
  path?: string;
  /** Path for the readiness endpoint. @default '/ready' */
  readyPath?: string;
  /** Default timeout per check in milliseconds. @default 5000 */
  defaultTimeoutMs?: number;
  /** Whether to include detailed check info in response. @default true */
  verbose?: boolean;
}
