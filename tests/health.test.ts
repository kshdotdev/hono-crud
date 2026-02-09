import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createHealthEndpoints, createHealthHandler } from '../src/health/index';

describe('Health Endpoints', () => {
  describe('createHealthEndpoints', () => {
    it('should return 200 for liveness check', async () => {
      const app = new Hono();
      createHealthEndpoints(app);

      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('healthy');
      expect(body.checks).toEqual([]);
      expect(body.timestamp).toBeTruthy();
    });

    it('should include version when provided', async () => {
      const app = new Hono();
      createHealthEndpoints(app, { version: '1.2.3' });

      const res = await app.request('/health');
      const body = await res.json();
      expect(body.version).toBe('1.2.3');
    });

    it('should use custom paths', async () => {
      const app = new Hono();
      createHealthEndpoints(app, {
        path: '/liveness',
        readyPath: '/readiness',
      });

      const res1 = await app.request('/liveness');
      expect(res1.status).toBe(200);

      const res2 = await app.request('/readiness');
      expect(res2.status).toBe(200);
    });

    it('should return 200 readiness when all checks pass', async () => {
      const app = new Hono();
      createHealthEndpoints(app, {
        checks: [
          { name: 'db', check: async () => true },
          { name: 'cache', check: async () => 'connected' },
        ],
      });

      const res = await app.request('/ready');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('healthy');
      expect(body.checks).toHaveLength(2);
      expect(body.checks[0].healthy).toBe(true);
      expect(body.checks[1].healthy).toBe(true);
      expect(body.checks[1].message).toBe('connected');
    });

    it('should return 503 when critical check fails', async () => {
      const app = new Hono();
      createHealthEndpoints(app, {
        checks: [
          { name: 'db', check: async () => { throw new Error('Connection refused'); } },
          { name: 'cache', check: async () => true },
        ],
      });

      const res = await app.request('/ready');
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe('unhealthy');
      expect(body.checks[0].healthy).toBe(false);
      expect(body.checks[0].message).toBe('Connection refused');
    });

    it('should return degraded when non-critical check fails', async () => {
      const app = new Hono();
      createHealthEndpoints(app, {
        checks: [
          { name: 'db', check: async () => true },
          {
            name: 'cache',
            check: async () => { throw new Error('Cache down'); },
            critical: false,
          },
        ],
      });

      const res = await app.request('/ready');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('degraded');
    });

    it('should timeout slow checks', async () => {
      const app = new Hono();
      createHealthEndpoints(app, {
        defaultTimeout: 50,
        checks: [
          {
            name: 'slow',
            check: async () => {
              await new Promise((r) => setTimeout(r, 200));
            },
          },
        ],
      });

      const res = await app.request('/ready');
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.checks[0].healthy).toBe(false);
      expect(body.checks[0].message).toContain('timed out');
    });

    it('should report latency', async () => {
      const app = new Hono();
      createHealthEndpoints(app, {
        checks: [
          { name: 'fast', check: async () => true },
        ],
      });

      const res = await app.request('/ready');
      const body = await res.json();
      expect(typeof body.latency).toBe('number');
      expect(body.checks[0].latency).toBeGreaterThanOrEqual(0);
    });

    it('should respect per-check timeout', async () => {
      const app = new Hono();
      createHealthEndpoints(app, {
        defaultTimeout: 5000,
        checks: [
          {
            name: 'slow',
            check: async () => {
              await new Promise((r) => setTimeout(r, 200));
            },
            timeout: 50,
          },
        ],
      });

      const res = await app.request('/ready');
      const body = await res.json();
      expect(body.checks[0].healthy).toBe(false);
    });
  });

  describe('createHealthHandler', () => {
    it('should create a standalone Hono app with health routes', async () => {
      const health = createHealthHandler({ version: '2.0.0' });
      const res = await health.request('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.version).toBe('2.0.0');
    });
  });
});
