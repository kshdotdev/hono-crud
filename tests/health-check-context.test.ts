import { Hono } from 'hono';
import { createHealthRoutes } from 'hono-crud/health';
import { describe, expect, it } from 'vitest';

type Env = { Bindings: { DB_NAME: string } };

describe('createHealthRoutes() checks receive the request context', () => {
  it('lets a readiness check reach c.env bindings', async () => {
    const app = new Hono<Env>();
    app.route(
      '/',
      createHealthRoutes<Env>({
        checks: [
          {
            name: 'binding',
            check: async (c) => `db=${c.env.DB_NAME}`,
          },
          {
            // Zero-argument checks keep working.
            name: 'legacy',
            check: async () => true,
          },
        ],
      }),
    );

    const res = await app.request('/ready', undefined, { DB_NAME: 'primary' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: Array<{ name: string; healthy: boolean; message?: string }>;
    };
    expect(body.status).toBe('healthy');
    expect(body.checks.find((c) => c.name === 'binding')?.message).toBe('db=primary');
    expect(body.checks.find((c) => c.name === 'legacy')?.healthy).toBe(true);
  });
});
