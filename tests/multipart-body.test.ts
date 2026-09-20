import { OpenAPIHono } from '@hono/zod-openapi';
import { OpenAPIRoute, type OpenAPIRouteSchema, fromHono } from 'hono-crud';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

type Upload = { file: File; kind?: string };

class UploadRoute extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              file: z.instanceof(File).openapi({ type: 'string', format: 'binary' }),
              kind: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Uploaded',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              result: z.object({ name: z.string(), size: z.number(), kind: z.string().nullable() }),
            }),
          },
        },
      },
    },
  } satisfies OpenAPIRouteSchema;

  async handle(): Promise<Response> {
    const { body } = await this.getValidatedData<Upload>();
    if (!body) return this.error('missing body', 'NO_BODY', 400);
    return this.success(
      { name: body.file.name, size: body.file.size, kind: body.kind ?? null },
      201,
    );
  }
}

class UrlEncodedRoute extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          'application/x-www-form-urlencoded': {
            schema: z.object({ name: z.string() }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), result: z.object({ name: z.string() }) }),
          },
        },
      },
    },
  } satisfies OpenAPIRouteSchema;

  async handle(): Promise<Response> {
    const { body } = await this.getValidatedData<{ name: string }>();
    return this.success({ name: body?.name ?? '' });
  }
}

function buildApp() {
  return fromHono(new OpenAPIHono()).post('/upload', UploadRoute).post('/form', UrlEncodedRoute);
}

describe('getValidatedData() with form bodies', () => {
  it('reads a validated multipart/form-data body (File + fields)', async () => {
    const app = buildApp();
    const form = new FormData();
    form.append('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }));
    form.append('kind', 'receipt');

    const res = await app.request('/upload', { method: 'POST', body: form });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await res.json()).toEqual({
      success: true,
      result: { name: 'hello.txt', size: 5, kind: 'receipt' },
    });
  });

  it('rejects a multipart body that fails the schema', async () => {
    const app = buildApp();
    const form = new FormData();
    form.append('kind', 'receipt'); // no file

    const res = await app.request('/upload', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reads a validated application/x-www-form-urlencoded body', async () => {
    const app = buildApp();
    const res = await app.request('/form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'ana' }).toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, result: { name: 'ana' } });
  });
});
