import {
  ApiException,
  type AuthEndpointMethods,
  AuthenticatedEndpoint,
  type EndpointAuthConfig,
  ForbiddenException,
  InputValidationException,
  NotFoundException,
  OpenAPIRoute,
  UnauthorizedException,
  errorEnvelopeSchema,
  type errorResponseSchema,
  errorResponseZodSchema,
  structuredErrorSchema,
  successEnvelopeSchema,
  validationIssueSchema,
  withAuth,
} from 'hono-crud';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Locks the single-source error/success envelope contract: the same Zod schema
// that documents OpenAPI 4xx/5xx responses and types `ErrorResponse` also
// validates what `ApiException.toJSON()` actually emits. If the shape drifts,
// this fails.
describe('error envelope single source', () => {
  it('ApiException.toJSON() satisfies errorEnvelopeSchema', () => {
    const body = new ApiException('User not found', 404, 'NOT_FOUND').toJSON();
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('User not found');
  });

  it('a built-in exception subclass also satisfies the envelope schema', () => {
    const body = new NotFoundException('User').toJSON();
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('carries structured details when provided', () => {
    const body = new ApiException('Boom', 422, 'VALIDATION_ERROR', { field: 'email' }).toJSON();
    const parsed = errorEnvelopeSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.error.details).toEqual({ field: 'email' });
  });

  it('structuredErrorSchema requires code + message and rejects malformed errors', () => {
    expect(structuredErrorSchema.safeParse({ code: 'X', message: 'y' }).success).toBe(true);
    expect(structuredErrorSchema.safeParse({ code: 'X' }).success).toBe(false);
    expect(structuredErrorSchema.safeParse({ message: 'y' }).success).toBe(false);
  });

  it('successEnvelopeSchema builds a matching { success: true, result } schema', () => {
    const schema = successEnvelopeSchema(z.object({ id: z.string() }));
    expect(schema.safeParse({ success: true, result: { id: 'a' } }).success).toBe(true);
    expect(schema.safeParse({ success: false, result: { id: 'a' } }).success).toBe(false);
  });
});

// Doc-schema ⊆ runtime-output: the exported OpenAPI error schema
// (`errorResponseZodSchema`, the runtime `structuredErrorSchema` minus the
// handler-enrichment fields `requestId`/`stack`) must accept everything
// `ApiException.toJSON()` actually emits.
describe('doc schema accepts runtime output', () => {
  it('errorResponseZodSchema accepts every ApiException.toJSON() body', () => {
    const docSchema = errorResponseZodSchema();
    const bodies = [
      new ApiException('Internal', 500, 'INTERNAL_ERROR').toJSON(),
      new ApiException('With details', 400, 'SOME_CODE', { field: 'email' }).toJSON(),
      new ApiException('Falsy details', 400, 'SOME_CODE', 0).toJSON(),
      new NotFoundException('User', '42').toJSON(),
      new UnauthorizedException().toJSON(),
      new ForbiddenException('Forbidden by policy').toJSON(),
    ];
    for (const body of bodies) {
      expect(docSchema.safeParse(body).success).toBe(true);
    }
  });

  it('validationIssueSchema parses every InputValidationException.fromZodError details item', () => {
    const parsed = z
      .object({ name: z.string().min(1), age: z.number(), role: z.enum(['admin', 'user']) })
      .safeParse({ name: '', age: 'not-a-number', role: 'invalid' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const body = InputValidationException.fromZodError(parsed.error).toJSON();
    expect(errorResponseZodSchema().safeParse(body).success).toBe(true);

    const details = body.error.details;
    expect(Array.isArray(details)).toBe(true);
    const items = details as unknown[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(validationIssueSchema.safeParse(item).success).toBe(true);
    }
  });
});

// Pins the auth 401/403 doc-schema swap (auth/endpoint.ts): both the
// `AuthenticatedEndpoint` base class and the `withAuth` mixin declare the one
// canonical error envelope — no `z.literal('UNAUTHORIZED')`/
// `z.literal('FORBIDDEN')` code enums. The OpenAPI snapshot fixture registers
// no auth endpoints, so this unit test is the only pin.
describe('auth endpoint doc schema', () => {
  class SecureEndpointProbe extends AuthenticatedEndpoint {
    handle(): Response {
      return new Response(null, { status: 204 });
    }
  }

  class PlainRouteProbe extends OpenAPIRoute {
    handle(): Response {
      return new Response(null, { status: 204 });
    }
  }

  // `withAuth` returns an intersection of construct signatures, which tsc
  // rejects as an `extends` base (TS2510); narrow it to a single construct
  // signature over the combined instance type.
  const SecureMixinBase = withAuth(PlainRouteProbe) as unknown as new () => PlainRouteProbe &
    EndpointAuthConfig &
    AuthEndpointMethods;
  class SecureMixinProbe extends SecureMixinBase {}

  type ErrorResponseDecl = ReturnType<typeof errorResponseSchema>;

  function getAuthDeclarations(probe: SecureEndpointProbe | SecureMixinProbe) {
    const responses = (probe.getSchema().responses ?? {}) as Record<
      string,
      ErrorResponseDecl | undefined
    >;
    return { responses, decl401: responses['401'], decl403: responses['403'] };
  }

  const variants = [
    { label: 'AuthenticatedEndpoint subclass', make: () => new SecureEndpointProbe() },
    { label: 'withAuth mixin', make: () => new SecureMixinProbe() },
  ];

  for (const { label, make } of variants) {
    it(`${label}: declares canonical 401/403 envelopes when requiresAuth = true`, () => {
      const probe = make();
      const { decl401, decl403 } = getAuthDeclarations(probe);
      expect(decl401).toBeDefined();
      expect(decl403).toBeDefined();
      if (!decl401 || !decl403) return;

      const schema401 = decl401.content['application/json'].schema;
      const schema403 = decl403.content['application/json'].schema;

      // Runtime bodies parse against the declared doc schemas.
      expect(schema401.safeParse(new UnauthorizedException().toJSON()).success).toBe(true);
      expect(schema403.safeParse(new ForbiddenException('x').toJSON()).success).toBe(true);

      // Pins the z.literal code-enum removal: any stable code string is valid.
      const customCode = { success: false, error: { code: 'TOTALLY_CUSTOM', message: 'x' } };
      expect(schema401.safeParse(customCode).success).toBe(true);
      expect(schema403.safeParse(customCode).success).toBe(true);

      expect(probe.getSchema().security).toEqual([{ bearerAuth: [] }]);
    });

    it(`${label}: omits 401/403 and security when requiresAuth = false`, () => {
      const probe = make();
      probe.requiresAuth = false;
      const { responses } = getAuthDeclarations(probe);
      expect(responses['401']).toBeUndefined();
      expect(responses['403']).toBeUndefined();
      expect(probe.getSchema().security).toBeUndefined();
    });
  }
});
