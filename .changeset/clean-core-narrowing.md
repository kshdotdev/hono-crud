---
'hono-crud': patch
---

Core type-hole cleanup: `JSON.parse` results in the logging middleware are typed `unknown` instead of flowing as implicit `any`; closure-narrowing const captures remove non-null assertions in cascade collection, batch serialization, batch-upsert computed fields, and audit-log date filters; redundant `ZodObject` casts dropped in `getSchemaFields`; `successEnvelopeSchema` now returns its precise inferred type (`success: z.literal(true)`) instead of a widened cast; `createErrorHandler`'s `onHookError` first parameter is now honestly `unknown` (hooks can throw non-Errors — narrow with `instanceof Error`); new `ApiErrorCode` union gives autocomplete/typo protection on built-in error codes while `(string & {})` keeps custom codes valid (`ApiException.code`, `StructuredError.code`); `contentJson`, `createSubscribeHandler`, and `errorResponseSchema` gain explicit return types as public-boundary exports.
