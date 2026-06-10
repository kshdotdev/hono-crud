---
"hono-crud": patch
---

Error-shape unification (breaking, patch): every failure the library emits now uses the one canonical envelope `{ success: false, error: { code, message, details? } }` with a stable machine-readable code, and the OpenAPI docs tell the same story as the wire.

- Validation is one shape on one status: `openApiValidationHook` now throws `InputValidationException` instead of returning a 422 ZodError-style body, so the hook path and the thrown path produce the identical 400 `VALIDATION_ERROR` envelope with `details: [{path, message, code}]`. `createValidationHook`'s default status flips 422 → 400 (explicit 422 still accepted). `fromHono` installs the canonical hook as `defaultHook` when none is set, so bare apps stop leaking `@hono/zod-validator`'s raw ZodError body.
- Library throw-sites get real codes instead of generic `HTTP_ERROR`: write-policy denial → 403 `FORBIDDEN` (as its docblock always claimed), missing tenant → 400 `TENANT_REQUIRED` (endpoint and middleware paths), failed tenant validation → 400 `INVALID_TENANT`. Aggregate allow-list/limit denials change from 500 `INTERNAL_ERROR` to 400 `AGGREGATION_ERROR`; search min-query and subscribe failures now throw typed exceptions (same codes/statuses) so custom response envelopes apply.
- Doc truthfulness: list and export endpoints now declare the 400 response their failable query schemas can produce; bulk-patch's hand-written 400 body is replaced with the canonical schema; new `validationIssueSchema` describes the `details` items.
- Hardening: `ApiException.getResponse()` returns the canonical JSON envelope, so apps without `createErrorHandler` no longer get Hono's plain-text fallback; falsy `details` values (0, '', false) are no longer dropped.
- Removed orphan exports (never emitted by anything): `successResponse`, `errorResponse`, `HttpErrorSchema`, `ZodErrorSchema`, `ZodIssueSchema`, `createErrorSchema`, `createOneOfErrorSchema`, `httpErrorContent`, `commonResponses`, `ValidationHookResult` — use `errorResponseSchema` / `errorResponses` / `validationIssueSchema` / the canonical envelope schemas instead.
