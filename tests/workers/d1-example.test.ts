import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { openApiApp } from '../../examples/drizzle/d1-crud';

async function request(path: string, init?: RequestInit): Promise<Response> {
  return await openApiApp.fetch(
    new Request(`https://example.com${path}`, init),
    {
      DB: env.DB,
      CACHE_KV: env.CACHE_KV,
    }
  );
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
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
});
