/**
 * Compile-time assertions for typed RPC client (`hc<typeof app>`) support.
 *
 * Checked by `pnpm run typecheck:types` (tsc only — this file is never
 * executed). Every `@ts-expect-error` line is a negative assertion: if the
 * rejection it documents stops firing, the typecheck fails.
 */
import { createMemoryCrud } from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import { Hono } from 'hono';
import {
  OpenAPIRoute,
  type OpenAPIRouteSchema,
  defineMeta,
  defineModel,
  defineRouteSchema,
  errorResponses,
  fromHono,
  registerCrud,
  registerCrudResources,
} from 'hono-crud';
import { type InferRequestType, type InferResponseType, hc } from 'hono/client';
import { z } from 'zod';

// ============================================================================
// Fixtures
// ============================================================================

const WidgetSchema = z.object({
  id: z.string(),
  name: z.string(),
  qty: z.number(),
  createdAt: z.date().optional(),
});

const WidgetModel = defineModel({
  tableName: 'widgets',
  schema: WidgetSchema,
  primaryKeys: ['id'],
});

// `fields` narrows the create body seen by the client.
const widgetMeta = defineMeta({
  model: WidgetModel,
  fields: z.object({ name: z.string(), qty: z.number() }),
});
const Widgets = createMemoryCrud(widgetMeta);

// Meta without `fields`: the create body degrades to a partial row.
const looseMeta = defineMeta({ model: WidgetModel });
const LooseWidgets = createMemoryCrud(looseMeta);

class WidgetStats extends OpenAPIRoute {
  schema = {
    tags: ['Widgets'],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ month: z.string().optional() }),
    },
    responses: {
      200: {
        description: 'Stats',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), result: z.object({ total: z.number() }) }),
          },
        },
      },
      404: {
        description: 'Not found',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(false),
              error: z.object({ code: z.string(), message: z.string() }),
            }),
          },
        },
      },
    },
  } satisfies OpenAPIRouteSchema;

  async handle(): Promise<Response> {
    return this.success({ total: 1 });
  }
}

const uploadSchema = defineRouteSchema({
  request: {
    body: {
      content: { 'multipart/form-data': { schema: z.object({ file: z.instanceof(File) }) } },
    },
  },
  responses: {
    201: {
      description: 'Uploaded',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), result: z.object({ key: z.string() }) }),
        },
      },
    },
  },
});

class WidgetUpload extends OpenAPIRoute {
  schema = uploadSchema;

  async handle(): Promise<Response> {
    return this.success({ key: 'k' }, 201);
  }
}

class Ping extends OpenAPIRoute {
  async handle(): Promise<Response> {
    return this.success({ pong: true });
  }
}

// ============================================================================
// Class routes + CRUD accumulate on the app type
// ============================================================================

const base = fromHono(new OpenAPIHono())
  .get('/widgets/:id/stats', WidgetStats)
  .post('/widgets/:id/upload', WidgetUpload)
  .get('/ping', Ping);

const routes = registerCrud(base, '/widgets', {
  list: Widgets.List,
  create: Widgets.Create,
  read: Widgets.Read,
  update: Widgets.Update,
  delete: Widgets.Delete,
});

const client = hc<typeof routes>('http://localhost');

// ---- list -------------------------------------------------------------------

type ListResponse = InferResponseType<typeof client.widgets.$get, 200>;
const listOk: ListResponse = {
  success: true,
  result: [{ id: 'a', name: 'n', qty: 1 }],
  result_info: { page: 1, per_page: 10, has_next_page: false, has_prev_page: false },
};

// Rows are JSON-parsed: a `Date` field arrives as a string.
type ListRow = ListResponse['result'][number];
const rowWithIso: ListRow = { id: 'a', name: 'n', qty: 1, createdAt: '2026-01-01T00:00:00Z' };
// @ts-expect-error - Date does not survive JSON serialisation
const rowWithDate: ListRow = { id: 'a', name: 'n', qty: 1, createdAt: new Date() };

// The list query is optional as a whole (`client.widgets.$get()` is valid).
type ListRequest = InferRequestType<typeof client.widgets.$get>;
const noQuery: ListRequest = {};
const withQuery: ListRequest = { query: { page: '2', per_page: '5', order: 'desc', name: 'x' } };
// @ts-expect-error - order is a closed enum
const badOrder: ListRequest = { query: { order: 'sideways' } };

// ---- create -----------------------------------------------------------------

type CreateBody = InferRequestType<typeof client.widgets.$post>['json'];
const createBody: CreateBody = { name: 'x', qty: 2 };
// @ts-expect-error - name is required by meta.fields
const createMissingName: CreateBody = { qty: 2 };
// @ts-expect-error - qty must be a number
const createWrongType: CreateBody = { name: 'x', qty: 'two' };

type CreateResponse = InferResponseType<typeof client.widgets.$post, 201>;
const created: CreateResponse = { success: true, result: { id: '1', name: 'x', qty: 2 } };

type CreateError = InferResponseType<typeof client.widgets.$post, 400>;
const createError: CreateError = {
  success: false,
  error: { code: 'VALIDATION_ERROR', message: 'x' },
};

// ---- read / update / delete -------------------------------------------------

type ReadRequest = InferRequestType<(typeof client.widgets)[':id']['$get']>;
const readArgs: ReadRequest = { param: { id: 'x' } };
// @ts-expect-error - param.id is required
const readMissingParam: ReadRequest = {};

type ReadNotFound = InferResponseType<(typeof client.widgets)[':id']['$get'], 404>;
const notFound: ReadNotFound = { success: false, error: { code: 'NOT_FOUND', message: 'x' } };

type UpdateBody = InferRequestType<(typeof client.widgets)[':id']['$patch']>['json'];
const updateBody: UpdateBody = { qty: 3 };
// @ts-expect-error - unknown field
const updateUnknown: UpdateBody = { colour: 'red' };

type DeleteResponse = InferResponseType<(typeof client.widgets)[':id']['$delete'], 200>;
const deleted: DeleteResponse = { success: true, result: { deleted: true } };

// ---- class route with params + query ----------------------------------------

type StatsRequest = InferRequestType<(typeof client.widgets)[':id']['stats']['$get']>;
const statsArgs: StatsRequest = { param: { id: 'x' }, query: { month: '2026-01' } };
// @ts-expect-error - the route declares a query object
const statsMissingQuery: StatsRequest = { param: { id: 'x' } };

type StatsResponse = InferResponseType<(typeof client.widgets)[':id']['stats']['$get'], 200>;
const stats: StatsResponse = { success: true, result: { total: 1 } };
// @ts-expect-error - result.total is a number
const statsWrong: StatsResponse = { success: true, result: { total: 'one' } };

type StatsNotFound = InferResponseType<(typeof client.widgets)[':id']['stats']['$get'], 404>;
const statsNotFound: StatsNotFound = { success: false, error: { code: 'NOT_FOUND', message: 'x' } };

// ---- class route with multipart body ----------------------------------------

type UploadRequest = InferRequestType<(typeof client.widgets)[':id']['upload']['$post']>;
const uploadArgs: UploadRequest = { param: { id: 'x' }, form: { file: new File([], 'a.txt') } };
type UploadResponse = InferResponseType<(typeof client.widgets)[':id']['upload']['$post'], 201>;
const uploaded: UploadResponse = { success: true, result: { key: 'k' } };

// ---- untyped class route stays reachable ------------------------------------

type PingResponse = InferResponseType<typeof client.ping.$get>;
const ping: PingResponse = {};

// ============================================================================
// Meta without `fields`: partial row body
// ============================================================================

const loose = registerCrud(fromHono(new OpenAPIHono()), '/loose', { create: LooseWidgets.Create });
const looseClient = hc<typeof loose>('http://localhost');
type LooseCreateBody = InferRequestType<typeof looseClient.loose.$post>['json'];
const looseBody: LooseCreateBody = { name: 'only-name' };
// @ts-expect-error - still checked against the row's field types
const looseWrong: LooseCreateBody = { qty: 'two' };

// ============================================================================
// registerCrudResources folds several resources into one type
// ============================================================================

const multi = registerCrudResources(fromHono(new OpenAPIHono()), {
  '/a': { list: Widgets.List },
  '/b': { read: Widgets.Read },
});
const multiClient = hc<typeof multi>('http://localhost');
type AList = InferResponseType<typeof multiClient.a.$get, 200>;
const aList: AList = {
  success: true,
  result: [],
  result_info: { page: 1, per_page: 1, has_next_page: false, has_prev_page: false },
};
type BRead = InferResponseType<(typeof multiClient.b)[':id']['$get'], 200>;
const bRead: BRead = { success: true, result: { id: '1', name: 'n', qty: 1 } };

// ============================================================================
// A custom responseEnvelope degrades outputs to unknown (inputs stay typed)
// ============================================================================

const custom = registerCrud(
  fromHono(new OpenAPIHono()),
  '/custom',
  { create: Widgets.Create },
  {
    responseEnvelope: {
      success: (result) => ({ data: result }),
      error: (err) => ({ error: err }),
    },
  },
);
const customClient = hc<typeof custom>('http://localhost');
type CustomBody = InferRequestType<typeof customClient.custom.$post>['json'];
const customBody: CustomBody = { name: 'x', qty: 1 };
type CustomResponse = InferResponseType<typeof customClient.custom.$post>;
const customResponse: CustomResponse = {};

// ============================================================================
// Non-regression: native OpenAPIHono / Hono usage still compiles
// ============================================================================

const withBase = fromHono(new OpenAPIHono<{ Bindings: { X: string } }>());
withBase.use('*', async (_c, next) => {
  await next();
});
const sub = new Hono().get('/health', (c) => c.json({ ok: true }));
withBase.route('/', sub);
withBase.doc('/openapi.json', { info: { title: 't', version: '1' } });

// Deprecated but still accepted: a plain Hono.
const legacy = fromHono(new Hono());
legacy.get('/ping', Ping);

// Endpoints are typed with the app's Env; the return value may be ignored.
const BoundWidgets = createMemoryCrud<typeof widgetMeta, { Bindings: { X: string } }>(widgetMeta);
registerCrud(withBase, '/widgets', { list: BoundWidgets.List });

// A class route written against a custom Env registers on the matching app,
// and `errorResponses` keeps its literal statuses in the client type.
class BoundPing extends OpenAPIRoute<{ Bindings: { X: string } }> {
  schema = {
    responses: {
      200: {
        description: 'ok',
        content: { 'application/json': { schema: z.object({ x: z.string() }) } },
      },
      ...errorResponses({ 404: 'nope' }),
    },
  } satisfies OpenAPIRouteSchema;

  async handle(): Promise<Response> {
    return this.success({ x: this.getContext().env.X });
  }
}
const bound = withBase.get('/bound', BoundPing);
const boundClient = hc<typeof bound>('http://localhost');
type BoundOk = InferResponseType<typeof boundClient.bound.$get, 200>;
const boundOk: BoundOk = { x: '1' };
type BoundMissing = InferResponseType<typeof boundClient.bound.$get, 404>;
const boundMissing: BoundMissing = { success: false, error: { code: 'NOT_FOUND', message: 'nope' } };

export {
  boundOk,
  boundMissing,
  listOk,
  rowWithIso,
  rowWithDate,
  noQuery,
  withQuery,
  badOrder,
  createBody,
  createMissingName,
  createWrongType,
  created,
  createError,
  readArgs,
  readMissingParam,
  notFound,
  updateBody,
  updateUnknown,
  deleted,
  statsArgs,
  statsMissingQuery,
  stats,
  statsWrong,
  statsNotFound,
  uploadArgs,
  uploaded,
  ping,
  looseBody,
  looseWrong,
  aList,
  bRead,
  customBody,
  customResponse,
};
