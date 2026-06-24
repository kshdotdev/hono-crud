// Type-level regression guard for the cache mixins' explicit-instance overload.
// Not an entry point (tsup bundles only `index.ts`) and never executed — it exists
// purely so `tsc --noEmit` fails if the overload stops preserving a generic base's
// non-default env through `withCache` / `withCacheInvalidation`.
//
// Why it matters: `withCache(GenericEndpoint)` collapses the endpoint to its DEFAULT
// type params (`InstanceType<TBase>`), widening a `Hono<AuthEnv>` endpoint back to
// `Env` — which then fails a typed `CrudEndpoints<AuthEnv>` registration downstream.
// The explicit form `withCache<Endpoint<AuthEnv, Meta>>(Endpoint)` preserves it.
import type { Env } from 'hono';
import type { AbstractConstructor, OpenAPIRoute } from 'hono-crud/internal';
import { withCache, withCacheInvalidation } from './mixin';

interface AppEnv extends Env {
  Variables: { userId?: string };
}
// A generic endpoint base parametrized on the env (mirrors `Drizzle*Endpoint<E, M>`).
declare abstract class AppRoute<E extends Env = Env> extends OpenAPIRoute<E> {}

// A registrar slot typed for AppEnv — mirrors `CrudEndpoints<AppEnv>`. If the mixin
// widened the env back to `Env`, `OpenAPIRoute<Env>` would NOT be assignable to
// `OpenAPIRoute<AppEnv>` (Context variance) and these assignments would fail.
type EndpointSlot = AbstractConstructor<OpenAPIRoute<AppEnv>>;

// Explicit instance type → env preserved + mixin methods present.
const CachedBase = withCache<AppRoute<AppEnv>>(AppRoute);
const _cachedKeepsEnv: EndpointSlot = CachedBase;
const _cachedHasMethods: (i: InstanceType<typeof CachedBase>) => Promise<unknown> = (i) =>
  i.getCachedResponse();

const InvalidatingBase = withCacheInvalidation<AppRoute<AppEnv>>(AppRoute);
const _invKeepsEnv: EndpointSlot = InvalidatingBase;
const _invHasMethods: (i: InstanceType<typeof InvalidatingBase>) => Promise<void> = (i) =>
  i.performCacheInvalidation();

// Backward-compat: no explicit type arg still infers the base instance + methods.
const CompatBase = withCache(AppRoute);
const _compatHasMethods: (i: InstanceType<typeof CompatBase>) => Promise<unknown> = (i) =>
  i.getCachedResponse();

export { _cachedKeepsEnv, _cachedHasMethods, _invKeepsEnv, _invHasMethods, _compatHasMethods };
