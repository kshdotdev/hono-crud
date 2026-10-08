---
'hono-crud': patch
---

`registerCrud` throws at setup when the app was not created by `fromHono()`. It used to register each endpoint class as a plain Hono handler, so every request failed with a 500 and the OpenAPI doc stayed empty. Wrap the app with `fromHono(new OpenAPIHono())` first.
