import { Hono } from 'hono';
import type { Env } from 'hono';
import type {
  HealthCheck,
  HealthCheckResult,
  HealthConfig,
  HealthResponse,
} from './types';

/**
 * Run a single health check with timeout.
 */
async function runCheck(
  check: HealthCheck,
  defaultTimeout: number
): Promise<HealthCheckResult> {
  const timeout = check.timeout ?? defaultTimeout;
  const start = Date.now();

  try {
    const result = await Promise.race([
      check.check(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Health check timed out')), timeout)
      ),
    ]);

    return {
      name: check.name,
      healthy: true,
      latency: Date.now() - start,
      message: typeof result === 'string' ? result : undefined,
    };
  } catch (err) {
    return {
      name: check.name,
      healthy: false,
      latency: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run all health checks and compute overall status.
 */
async function runAllChecks(
  checks: HealthCheck[],
  defaultTimeout: number
): Promise<{ results: HealthCheckResult[]; status: HealthResponse['status'] }> {
  const start = Date.now();
  const results = await Promise.all(
    checks.map((c) => runCheck(c, defaultTimeout))
  );

  const criticalFailed = results.some(
    (r, i) => !r.healthy && (checks[i].critical ?? true)
  );
  const anyFailed = results.some((r) => !r.healthy);

  let status: HealthResponse['status'] = 'healthy';
  if (criticalFailed) {
    status = 'unhealthy';
  } else if (anyFailed) {
    status = 'degraded';
  }

  return { results, status };
}

/**
 * Create health check endpoints and register them on a Hono app.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { createHealthEndpoints } from 'hono-crud';
 *
 * const app = new Hono();
 *
 * createHealthEndpoints(app, {
 *   version: '1.0.0',
 *   checks: [
 *     {
 *       name: 'database',
 *       check: async () => { await db.ping(); },
 *     },
 *     {
 *       name: 'cache',
 *       check: async () => { await redis.ping(); },
 *       critical: false, // degraded, not unhealthy
 *     },
 *   ],
 * });
 * ```
 */
export function createHealthEndpoints<E extends Env = Env>(
  app: Hono<E>,
  config: HealthConfig = {}
): void {
  const {
    checks = [],
    version,
    path = '/health',
    readyPath = '/ready',
    defaultTimeout = 5000,
    verbose = true,
  } = config;

  // Liveness — always 200 if process is running
  app.get(path, (c) => {
    const response: HealthResponse = {
      status: 'healthy',
      checks: [],
      latency: 0,
      timestamp: new Date().toISOString(),
      ...(version ? { version } : {}),
    };
    return c.json(response, 200);
  });

  // Readiness — runs all checks
  app.get(readyPath, async (c) => {
    const start = Date.now();
    const { results, status } = await runAllChecks(checks, defaultTimeout);
    const totalLatency = Date.now() - start;

    const response: HealthResponse = {
      status,
      checks: verbose ? results : results.map(({ name, healthy, latency }) => ({ name, healthy, latency })),
      latency: totalLatency,
      timestamp: new Date().toISOString(),
      ...(version ? { version } : {}),
    };

    const statusCode = status === 'unhealthy' ? 503 : 200;
    return c.json(response, statusCode);
  });
}

/**
 * Create a standalone health check handler (no app registration).
 * Useful for composing into existing routers.
 */
export function createHealthHandler(config: HealthConfig = {}) {
  const app = new Hono();
  createHealthEndpoints(app, config);
  return app;
}
