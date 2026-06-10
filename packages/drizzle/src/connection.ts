/**
 * Connection resolution shared by every Drizzle endpoint.
 *
 * Each endpoint can supply its database via:
 *   1. An active transaction (`_tx`, set when running inside `db.transaction(...)`)
 *   2. A direct property on the class (`db = myDb`)
 *   3. Hono context middleware injection (`c.set(CONTEXT_KEYS.db, myDb)`)
 *
 * The context slot is the `CONTEXT_KEYS.db` key (string value `'db'`), the
 * single source of truth shared with the rest of the framework.
 *
 * Centralised here so that all 18+ `getDb()` sites delegate to one
 * implementation and stay in sync.
 */

import { CONTEXT_KEYS } from 'hono-crud/internal';
import type { DrizzleDatabaseConstraint } from './helpers';

interface DrizzleEndpointShape {
  _tx?: DrizzleDatabaseConstraint;
  db?: DrizzleDatabaseConstraint;
  context?: { get?: (key: never) => unknown };
}

/**
 * Resolve the Drizzle database for an endpoint, checking transaction first,
 * then direct property, then context. The parameter is typed `unknown` because
 * `context` on the endpoint base class is `protected`, which is incompatible
 * with public structural-type checking; we duck-type internally instead.
 */
export function getDrizzleDb(self: unknown): DrizzleDatabaseConstraint {
  const s = self as DrizzleEndpointShape;
  if (s._tx) return s._tx;
  if (s.db) return s.db;
  const contextDb = s.context?.get?.(CONTEXT_KEYS.db as never);
  if (contextDb) return contextDb as DrizzleDatabaseConstraint;
  throw new Error(
    'Database not configured. Either:\n' +
      '1. Set db property: db = myDb;\n' +
      '2. Use middleware: c.set(CONTEXT_KEYS.db, myDb);\n' +
      '3. Use factory: createDrizzleCrud(db, meta)',
  );
}
