---
"hono-crud": patch
---

Add `setAuthContext(ctx, user, authType)` to the auth subpath. This is the
write-side counterpart to the existing auth context accessors (`getUser`,
`getUserRoles`, `getAuthType`, …): it publishes the authenticated user id,
user object, roles/permissions (each defaulting to `[]`), and auth type to the
Hono context. The JWT and API-key middleware now share it instead of each
duplicating the five `ctx.set` calls; behavior is unchanged.
