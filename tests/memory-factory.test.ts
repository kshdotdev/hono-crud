import { MemoryCreateEndpoint, createMemoryCrud } from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import { type HonoOpenAPIApp, defineMeta, defineModel, fromHono } from 'hono-crud';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const WidgetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: z.enum(['active', 'inactive']).default('active'),
});

// Lowercase tableName, NO explicit `tag` — registration should derive the tag
// from `tableName`.
const WidgetModel = defineModel({
  tableName: 'widgets',
  schema: WidgetSchema,
  primaryKeys: ['id'],
});
const widgetMeta = defineMeta({ model: WidgetModel });

// Same shape but WITH a capitalized display `tag` — registration should derive
// the tag from `tag`, not `tableName`.
const AccountModel = defineModel({
  tableName: 'accounts',
  tag: 'Accounts',
  schema: WidgetSchema,
  primaryKeys: ['id'],
});
const accountMeta = defineMeta({ model: AccountModel });

// ---------------------------------------------------------------------------
// Tag defaulting is now a registration-time choke point (core/openapi.ts), not
// a per-class `getSchema()` override on the factory output. So these assertions
// go through the real OpenAPI emission path: build an app, register the
// endpoint via `fromHono`, and read the generated `/openapi.json`. This is a
// stronger guard than reading `new X().getSchema()` in isolation — it asserts
// what a consumer's documentation actually contains.
// ---------------------------------------------------------------------------

type Operation = { tags?: string[]; summary?: string; requestBody?: unknown };
type OpenApiDoc = { paths?: Record<string, Record<string, Operation>> };

async function openapiFor(register: (app: HonoOpenAPIApp) => void): Promise<OpenApiDoc> {
  const app = fromHono(new OpenAPIHono());
  register(app);
  app.doc('/openapi.json', { info: { title: 'Test', version: '1.0.0' } });
  const res = await app.request('/openapi.json');
  return (await res.json()) as OpenApiDoc;
}

describe('createMemoryCrud tag defaulting (via registration)', () => {
  const Widget = createMemoryCrud(widgetMeta);

  it('defaults tags from the model tableName when no tag is set on the endpoint', async () => {
    class WidgetCreate extends Widget.Create {}

    const doc = await openapiFor((app) => app.post('/widgets', WidgetCreate));
    expect(doc.paths?.['/widgets']?.post?.tags).toEqual(['widgets']);
  });

  it('keeps the merged request body when defaulting the tag (regression)', async () => {
    // A past bug resolved tags over raw `this.schema`, dropping the merged
    // `request.body` and 500'ing create. The choke point resolves over the
    // endpoint's already-merged `getSchema()`, so the request body survives
    // into the emitted document.
    class WidgetCreate extends Widget.Create {}

    const doc = await openapiFor((app) => app.post('/widgets', WidgetCreate));
    expect(doc.paths?.['/widgets']?.post?.requestBody).toBeDefined();
  });

  it('defaults tags from the model `tag` when the model provides one', async () => {
    const Account = createMemoryCrud(accountMeta);
    class AccountCreate extends Account.Create {}

    const doc = await openapiFor((app) => app.post('/accounts', AccountCreate));
    expect(doc.paths?.['/accounts']?.post?.tags).toEqual(['Accounts']);
  });

  it('preserves non-tag schema fields while filling the default tag', async () => {
    class WidgetList extends Widget.List {
      schema = { summary: 'List widgets' };
      filterFields = ['status'];
    }

    const doc = await openapiFor((app) => app.get('/widgets', WidgetList));
    expect(doc.paths?.['/widgets']?.get?.tags).toEqual(['widgets']);
    expect(doc.paths?.['/widgets']?.get?.summary).toBe('List widgets');
  });

  it('lets an explicit non-empty schema.tags win over the model-derived default', async () => {
    class WidgetRead extends Widget.Read {
      schema = { tags: ['Custom Widgets'], summary: 'Read a widget' };
    }

    const doc = await openapiFor((app) => app.get('/widgets/:id', WidgetRead));
    expect(doc.paths?.['/widgets/{id}']?.get?.tags).toEqual(['Custom Widgets']);
    expect(doc.paths?.['/widgets/{id}']?.get?.summary).toBe('Read a widget');
  });

  it('stamps _meta on the configured base classes so subclasses need not restate it', () => {
    class WidgetCreate extends Widget.Create {}

    expect(new WidgetCreate()._meta).toBe(widgetMeta);
  });
});

// ---------------------------------------------------------------------------
// The choke point is model-driven, not factory-driven: a plain hand-written
// class (no factory, no sugar) that only stamps `_meta` inherits the model
// group too. This is the owner-approved semantic — declare `tag` once, every
// endpoint style honors it.
// ---------------------------------------------------------------------------
describe('model tag defaulting for hand-written class endpoints', () => {
  const TaskModel = defineModel({
    tableName: 'tasks',
    tag: 'Tasks',
    schema: WidgetSchema,
    primaryKeys: ['id'],
  });
  const taskMeta = defineMeta({ model: TaskModel });

  it('applies the model-derived tag to a plain class with no schema.tags', async () => {
    class TaskCreate extends MemoryCreateEndpoint {
      _meta = taskMeta;
    }

    const doc = await openapiFor((app) => app.post('/tasks', TaskCreate));
    expect(doc.paths?.['/tasks']?.post?.tags).toEqual(['Tasks']);
  });

  it('keeps an explicit schema.tags on a plain class', async () => {
    class TaskCreate extends MemoryCreateEndpoint {
      _meta = taskMeta;
      schema = { tags: ['Explicit'] };
    }

    const doc = await openapiFor((app) => app.post('/tasks', TaskCreate));
    expect(doc.paths?.['/tasks']?.post?.tags).toEqual(['Explicit']);
  });
});
