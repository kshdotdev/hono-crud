import { createCrudMcp } from '@hono-crud/mcp';
import { dispatch } from '@hono-crud/mcp/dispatch';
import { registerResourceTools } from '@hono-crud/mcp/tools';
import {
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  clearStorage,
} from '@hono-crud/memory';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Hono } from 'hono';
import { type MetaInput, type Model, fromHono, registerCrud } from 'hono-crud';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user']),
});

const UserModel: Model<typeof UserSchema> = {
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
};

const userMeta: MetaInput<typeof UserSchema> = { model: UserModel };

class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;
}
class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  filterFields = ['role'];
  searchFields = ['name', 'email'];
}
class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
}
class UserUpdate extends MemoryUpdateEndpoint {
  _meta = userMeta;
  allowedUpdateFields = ['name', 'role'];
}
class UserDelete extends MemoryDeleteEndpoint {
  _meta = userMeta;
}

const endpoints = {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
};

const PostSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  body: z.string(),
});

const PostModel: Model<typeof PostSchema> = {
  tableName: 'posts',
  schema: PostSchema,
  primaryKeys: ['id'],
};

const postMeta: MetaInput<typeof PostSchema> = { model: PostModel };

class PostCreate extends MemoryCreateEndpoint {
  _meta = postMeta;
}
class PostList extends MemoryListEndpoint {
  _meta = postMeta;
}
class PostRead extends MemoryReadEndpoint {
  _meta = postMeta;
}
class PostUpdate extends MemoryUpdateEndpoint {
  _meta = postMeta;
}
class PostDelete extends MemoryDeleteEndpoint {
  _meta = postMeta;
}

const postEndpoints = {
  create: PostCreate,
  list: PostList,
  read: PostRead,
  update: PostUpdate,
  delete: PostDelete,
};

function buildApp() {
  const app = fromHono(new Hono());
  registerCrud(app, '/users', endpoints);
  return app;
}

function buildAppUsersPosts() {
  const app = fromHono(new Hono());
  registerCrud(app, '/users', endpoints);
  registerCrud(app, '/posts', postEndpoints);
  return app;
}

// Parse a streamable-HTTP response body: SSE `data:` frames or plain JSON.
function messages(text: string): Array<{ id?: number; result?: any }> {
  const data = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => JSON.parse(l.slice(5).trim()));
  if (data.length) return data;
  try {
    const json = JSON.parse(text);
    return Array.isArray(json) ? json : [json];
  } catch {
    return [];
  }
}

// Initialize an MCP session over /mcp and return the sorted tool names.
// biome-ignore lint/suspicious/noExplicitAny: app of any Env/Schema is fine to request.
async function toolNamesOverHttp(app: { request: (...args: any[]) => Promise<Response> }) {
  const headers = (sid?: string): Record<string, string> => ({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(sid ? { 'mcp-session-id': sid } : {}),
  });
  const post = (body: unknown, sid?: string) =>
    app.request('/mcp', { method: 'POST', headers: headers(sid), body: JSON.stringify(body) });

  const initRes = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } },
  });
  const sid = initRes.headers.get('mcp-session-id') ?? undefined;
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
  const listRes = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid);
  const tools = messages(await listRes.text()).find((m) => m.id === 2)?.result?.tools ?? [];
  return (tools as Array<{ name: string }>).map((t) => t.name).sort();
}

// Drive a freshly-built McpServer via an in-memory client.
async function connectClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

const serverInfo = { name: 'test-mcp', version: '1.0.0' };

beforeEach(() => {
  clearStorage();
});

// ---------------------------------------------------------------------------

describe('tool generation', () => {
  it('generates one tool per CRUD operation with default names and annotations', async () => {
    const app = buildApp();
    const server = new McpServer(serverInfo);
    registerResourceTools(server, app, '/users', endpoints, serverInfo);
    const client = await connectClient(server);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'users_create',
      'users_delete',
      'users_list',
      'users_read',
      'users_update',
    ]);

    const del = tools.find((t) => t.name === 'users_delete');
    expect(del?.annotations?.destructiveHint).toBe(true);

    const list = tools.find((t) => t.name === 'users_list');
    expect(list?.annotations?.readOnlyHint).toBe(true);
  });

  it('derives inputSchema from the endpoint Zod schema (id managed on create)', async () => {
    const app = buildApp();
    const server = new McpServer(serverInfo);
    registerResourceTools(server, app, '/users', endpoints, serverInfo);
    const client = await connectClient(server);

    const { tools } = await client.listTools();
    const create = tools.find((t) => t.name === 'users_create');
    const createProps = Object.keys(create?.inputSchema?.properties ?? {});
    expect(createProps).toEqual(expect.arrayContaining(['email', 'name', 'role']));
    expect(createProps).not.toContain('id'); // primary key is engine-managed

    const read = tools.find((t) => t.name === 'users_read');
    expect(Object.keys(read?.inputSchema?.properties ?? {})).toContain('id');
  });

  it('respects the operations allow-list, disabled tools, and name/description overrides', async () => {
    const app = buildApp();
    const server = new McpServer(serverInfo);
    registerResourceTools(server, app, '/users', endpoints, serverInfo, {
      name: 'people',
      operations: ['list', 'read', 'create'],
      tools: {
        list: { name: 'find_people', description: 'Search people.' },
        create: { enabled: false },
      },
    });
    const client = await connectClient(server);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['find_people', 'people_read']); // create disabled, update/delete not in allow-list

    expect(tools.find((t) => t.name === 'find_people')?.description).toBe('Search people.');
  });
});

describe('tool execution (re-dispatch through the mounted app)', () => {
  it('round-trips create / list / read / update / delete', async () => {
    const app = buildApp();
    const server = new McpServer(serverInfo);
    registerResourceTools(server, app, '/users', endpoints, serverInfo);
    const client = await connectClient(server);

    const created = await client.callTool({
      name: 'users_create',
      arguments: { email: 'alice@example.com', name: 'Alice', role: 'admin' },
    });
    const createdData = JSON.parse(textOf(created));
    expect(createdData.success).toBe(true);
    expect(createdData.result.email).toBe('alice@example.com');
    const id = createdData.result.id as string;
    expect(id).toBeTruthy();

    const listed = await client.callTool({ name: 'users_list', arguments: {} });
    const listData = JSON.parse(textOf(listed));
    expect(listData.result.some((u: { id: string }) => u.id === id)).toBe(true);

    const read = await client.callTool({ name: 'users_read', arguments: { id } });
    expect(JSON.parse(textOf(read)).result.id).toBe(id);

    const updated = await client.callTool({
      name: 'users_update',
      arguments: { id, name: 'Alice Updated' },
    });
    expect(JSON.parse(textOf(updated)).result.name).toBe('Alice Updated');

    const deleted = await client.callTool({ name: 'users_delete', arguments: { id } });
    expect(deleted.isError).toBeFalsy();

    const readMissing = await client.callTool({ name: 'users_read', arguments: { id } });
    expect(readMissing.isError).toBe(true); // 404 after delete
  });
});

describe('authentication', () => {
  it('forwards the Authorization header on re-dispatch', async () => {
    const app = fromHono(new Hono());
    let seen: string | undefined;
    app.use('/users', async (c, next) => {
      seen = c.req.header('authorization');
      await next();
    });
    registerCrud(app, '/users', endpoints);

    const res = await dispatch(
      app,
      { operation: 'list', basePath: '/users', plan: { paramKeys: [], queryKeys: [] } },
      {},
      { authorization: 'Bearer secret-token' },
    );

    expect(res.status).toBe(200);
    expect(seen).toBe('Bearer secret-token');
  });

  it('gates /mcp with the verifier strategy', async () => {
    const app = buildApp();
    const mcp = createCrudMcp(app, {
      ...serverInfo,
      auth: {
        strategy: 'verifier',
        verifyToken: (token) => (token === 'good' ? { sub: 'u1' } : null),
      },
    });
    mcp.resource('/users', endpoints);
    app.all('/mcp', mcp.handler());

    const noToken = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(noToken.status).toBe(401);

    const badToken = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer bad' },
      body: '{}',
    });
    expect(badToken.status).toBe(401);

    const goodToken = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer good',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'c', version: '1' },
        },
      }),
    });
    expect(goodToken.status).not.toBe(401); // gate passed; transport handled the request
  });
});

describe('HTTP streaming transport (end-to-end)', () => {
  it('serves initialize, tools/list and tools/call over /mcp', async () => {
    const app = buildApp();
    const mcp = createCrudMcp(app, serverInfo);
    mcp.resource('/users', endpoints);
    app.all('/mcp', mcp.handler());

    const headers = (sid?: string): Record<string, string> => ({
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sid ? { 'mcp-session-id': sid } : {}),
    });
    const post = (body: unknown, sid?: string) =>
      app.request('/mcp', { method: 'POST', headers: headers(sid), body: JSON.stringify(body) });

    const initRes = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'c', version: '1' },
      },
    });
    expect(initRes.status).toBe(200);
    const sid = initRes.headers.get('mcp-session-id') ?? undefined;
    expect(messages(await initRes.text()).find((m) => m.id === 1)?.result?.serverInfo?.name).toBe(
      serverInfo.name,
    );

    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid);

    const listRes = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid);
    const toolNames = (
      messages(await listRes.text()).find((m) => m.id === 2)?.result?.tools ?? []
    ).map((t: { name: string }) => t.name);
    expect(toolNames).toContain('users_create');

    const callRes = await post(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'users_create',
          arguments: { email: 'http@test.com', name: 'Http', role: 'user' },
        },
      },
      sid,
    );
    const callResult = messages(await callRes.text()).find((m) => m.id === 3)?.result;
    const payload = JSON.parse(callResult.content[0].text);
    expect(payload.result.email).toBe('http@test.com');
  });
});

describe('auto-discovery', () => {
  it('auto-registers every registerCrud resource without per-resource calls', async () => {
    const app = buildAppUsersPosts();
    const mcp = createCrudMcp(app, { ...serverInfo, auto: true });
    app.all('/mcp', mcp.handler());

    const names = await toolNamesOverHttp(app);
    expect(names.filter((n) => n.startsWith('users_'))).toHaveLength(5);
    expect(names.filter((n) => n.startsWith('posts_'))).toHaveLength(5);
    expect(names).toContain('posts_create');
  });

  it('respects include/exclude path patterns', async () => {
    const app = buildAppUsersPosts();
    const mcp = createCrudMcp(app, { ...serverInfo, auto: { exclude: ['/posts'] } });
    app.all('/mcp', mcp.handler());

    const names = await toolNamesOverHttp(app);
    expect(names.some((n) => n.startsWith('users_'))).toBe(true);
    expect(names.some((n) => n.startsWith('posts_'))).toBe(false);
  });

  it('applies default operations and per-resource overrides', async () => {
    const app = buildAppUsersPosts();
    const mcp = createCrudMcp(app, {
      ...serverInfo,
      auto: { operations: ['list', 'read'], resources: { '/users': { operations: ['list'] } } },
    });
    app.all('/mcp', mcp.handler());

    const names = await toolNamesOverHttp(app);
    expect(names.filter((n) => n.startsWith('users_'))).toEqual(['users_list']);
    expect(names.filter((n) => n.startsWith('posts_'))).toEqual(['posts_list', 'posts_read']);
  });

  it('lets a manual mcp.resource() take precedence over auto for the same path', async () => {
    const app = buildAppUsersPosts();
    const mcp = createCrudMcp(app, { ...serverInfo, auto: true });
    mcp.resource('/users', endpoints, { name: 'people', operations: ['list'] });
    app.all('/mcp', mcp.handler());

    const names = await toolNamesOverHttp(app);
    expect(names).toContain('people_list'); // manual override wins for /users
    expect(names.some((n) => n.startsWith('users_'))).toBe(false);
    expect(names.filter((n) => n.startsWith('posts_'))).toHaveLength(5); // posts still auto
  });
});
