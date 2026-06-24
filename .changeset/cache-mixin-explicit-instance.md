---
"@hono-crud/cache": patch
---

feat(cache): let `withCache`/`withCacheInvalidation` preserve a generic endpoint's `<Env, Meta>`

The cache mixins typed their result as `AbstractConstructor<InstanceType<TBase> & …>`,
which collapses a generic base class to its DEFAULT type params — so wrapping a
`Hono<AuthEnv>` endpoint widened its env back to `Env`. Downstream that breaks a
typed `CrudEndpoints<AuthEnv>` registration (`Context<Env>` is not assignable to
`Context<AuthEnv>`), forcing consumers to hand-cast the wrapped class.

Both mixins now accept an OPTIONAL explicit instance type (defaulting to `never`,
so existing `withCache(Base)` calls are unchanged). Pass it to preserve the generics
with no cast:

```ts
class UserRead extends withCache<MemoryReadEndpoint<AuthEnv, typeof meta>>(MemoryReadEndpoint) {
  _meta = meta;
  // …
}
```

Covered by a type-level regression assertion (`src/mixin.type-assertions.ts`) that
fails `tsc` if the env is ever widened again.
