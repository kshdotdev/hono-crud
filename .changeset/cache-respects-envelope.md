---
"@hono-crud/cache": patch
---

Cache HITs now honor the configured `ResponseEnvelope`. The cache mixin previously hardcoded the default `{success, result}` envelope when serving from cache, so endpoints with a custom envelope returned different body shapes on HIT vs MISS. Raw result data is now cached and the envelope is applied at response time through the same path as uncached responses; `X-Cache` headers are unchanged.
