/**
 * App-scoped registry of `registerCrud(...)` calls.
 *
 * `registerCrud` records each resource on the app instance (under a symbol key)
 * so addon packages can enumerate the registered CRUD resources without core
 * having to know about them. This is **app-instance state**, not module-global
 * mutable state — each isolate has its own app, and recording happens at
 * startup (registration time), never per request. Edge-safe.
 */

import type { Env } from 'hono';
import type { CrudEndpoints } from './register';

const REGISTRY_KEY = Symbol.for('hono-crud.resource-registry');

/** A single `registerCrud(app, path, endpoints)` call, as recorded on the app. */
export interface RegisteredCrudResource<E extends Env = Env> {
  /** The normalized mount path (no trailing slash), e.g. `/users`. */
  path: string;
  /** The endpoints map passed to `registerCrud`. */
  endpoints: CrudEndpoints<E>;
}

type RegistryHost = { [REGISTRY_KEY]?: RegisteredCrudResource[] };

/** Record a `registerCrud(...)` call on the app. Called internally by `registerCrud`. */
export function recordCrudResource<E extends Env = Env>(
  app: object,
  path: string,
  endpoints: CrudEndpoints<E>,
): void {
  const host = app as RegistryHost;
  if (!host[REGISTRY_KEY]) host[REGISTRY_KEY] = [];
  host[REGISTRY_KEY].push({ path, endpoints: endpoints as unknown as CrudEndpoints });
}

/** Enumerate the CRUD resources registered on an app via `registerCrud(...)`. */
export function getRegisteredCrudResources(app: object): readonly RegisteredCrudResource[] {
  return (app as RegistryHost)[REGISTRY_KEY] ?? [];
}
