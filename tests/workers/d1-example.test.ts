import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { openApiApp } from '../../examples/drizzle/d1-crud';

async function request(path: string, init?: RequestInit): Promise<Response> {
  return await openApiApp.fetch(new Request(`https://example.com${path}`, init), {
    DB: env.DB,
    CACHE_KV: env.CACHE_KV,
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('drizzle d1 worker example', () => {
  beforeEach(async () => {
    await env.DB.prepare('DROP TABLE IF EXISTS tasks').run();
    await env.DB.prepare(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `).run();
  });

  it('creates and lists tasks through the Worker app export', async () => {
    let response = await request('/health');
    expect(response.status).toBe(200);

    response = await request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Ship D1 example tests',
        description: 'Exercise the importable Worker example',
        priority: 2,
      }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const created = await json<{ success: true; result: { id: string; title: string } }>(response);
    expect(created.result.title).toBe('Ship D1 example tests');

    response = await request('/tasks?priority[gte]=1&search=D1');
    expect(response.status).toBe(200);
    const listed = await json<{ success: true; result: Array<{ id: string }> }>(response);
    expect(listed.result.some((task) => task.id === created.result.id)).toBe(true);

    response = await request(`/tasks/${created.result.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(response.status).toBe(200);
  });

  it('serves the list from the KV cache and invalidates it on mutation', async () => {
    const seed = async (title: string) => {
      const id = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO tasks (id, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(id, title, 'todo', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
        .run();
      return id;
    };
    const listTitles = async () => {
      const response = await request('/tasks');
      expect(response.status).toBe(200);
      const body = await json<{ success: true; result: Array<{ title: string }> }>(response);
      return body.result.map((task) => task.title);
    };
    const cacheKeys = async () => (await env.CACHE_KV.list({ prefix: 'cache:' })).keys.length;

    const first = await seed('cached task');
    expect(await listTitles()).toEqual(['cached task']);
    // The middleware injected KVCacheStorage, so the list is now in KV.
    expect(await cacheKeys()).toBeGreaterThan(0);

    // A row written behind the app's back is invisible while the cache holds.
    await seed('written behind the cache');
    expect(await listTitles()).toEqual(['cached task']);

    // A mutation through the app invalidates the table's cache entries.
    const response = await request(`/tasks/${first}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(response.status).toBe(200);
    expect(await cacheKeys()).toBe(0);

    expect((await listTitles()).sort()).toEqual(['cached task', 'written behind the cache']);
  });
});
