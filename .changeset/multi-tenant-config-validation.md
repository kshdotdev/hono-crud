---
"hono-crud": patch
---

`multiTenant()` now fails fast on an inconsistent configuration. Previously, `source: 'custom'` without an `extractor` silently extracted `undefined` on every request and surfaced as a misleading `400 "Tenant ID is required"` (a misconfiguration masquerading as a client error). It now throws a clear setup-time error pointing at the missing `extractor`.
