import { OpenAPIHono } from '@hono/zod-openapi';
import { Hono } from 'hono';
import { OpenAPIRoute, fromHono } from 'hono-crud';
import { describe, expect, it } from 'vitest';

class Ping extends OpenAPIRoute {
  async handle(): Promise<Response> {
    return this.success({ pong: true });
  }
}

describe('fromHono() setup guard', () => {
  it('throws when a plain Hono already carries middleware', () => {
    const plain = new Hono();
    plain.use('*', async (_c, next) => {
      await next();
    });

    expect(() => fromHono(plain)).toThrow(/would be discarded/);
    expect(() => fromHono(plain)).toThrow(/new OpenAPIHono<Env>\(\)/);
  });

  it('throws when a plain Hono already carries routes', () => {
    const plain = new Hono();
    plain.get('/health', (c) => c.json({ ok: true }));

    expect(() => fromHono(plain)).toThrow(/GET \/health/);
  });

  it('accepts a fresh plain Hono (nothing to lose)', () => {
    expect(() => fromHono(new Hono())).not.toThrow();
  });

  it('keeps middleware registered on an OpenAPIHono', async () => {
    const app = new OpenAPIHono();
    const seen: string[] = [];
    app.use('*', async (c, next) => {
      seen.push(c.req.path);
      await next();
    });

    const wrapped = fromHono(app);
    wrapped.get('/ping', Ping);

    const res = await wrapped.request('/ping');
    expect(res.status).toBe(200);
    expect(seen).toEqual(['/ping']);
  });
});

describe('fromHono() proxy chaining', () => {
  it('registers a class route after a plain handler in the same chain', async () => {
    const app = fromHono(new OpenAPIHono());

    app.get('/plain', (c) => c.json({ plain: true })).get('/ping', Ping);

    const plain = await app.request('/plain');
    expect(plain.status).toBe(200);

    const ping = await app.request('/ping');
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual({ success: true, result: { pong: true } });
  });

  it('keeps chaining through use()', async () => {
    const app = fromHono(new OpenAPIHono());
    const calls: string[] = [];

    app
      .use('*', async (_c, next) => {
        calls.push('mw');
        await next();
      })
      .get('/ping', Ping);

    const res = await app.request('/ping');
    expect(res.status).toBe(200);
    expect(calls).toEqual(['mw']);
  });
});
