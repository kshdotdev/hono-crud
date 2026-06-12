/**
 * Client resolution shared by every Prisma endpoint.
 *
 * Each endpoint can supply its Prisma client via:
 *   1. An active transaction (`_tx`, set when running inside `$transaction(...)`)
 *   2. A direct property on the class (`prisma = prismaClient`)
 *   3. Hono context middleware injection (`c.set(CONTEXT_KEYS.prismaClient, prismaClient)`)
 *
 * The context slot is the `CONTEXT_KEYS.prismaClient` key (string value
 * `'prismaClient'`), the single source of truth shared with the rest of the
 * framework.
 *
 * Centralised here so that all `getPrismaClient()` sites delegate to one
 * implementation and stay in sync (mirrors drizzle's `getDrizzleDb`).
 */

import { CONTEXT_KEYS, ConfigurationException } from 'hono-crud/internal';
import type { PrismaClient } from './helpers';

interface PrismaEndpointShape {
  _tx?: PrismaClient;
  prisma?: PrismaClient;
  context?: { get?: (key: never) => unknown };
}

/**
 * Resolve the Prisma client for an endpoint, checking transaction first,
 * then direct property, then context. The parameter is typed `unknown` because
 * `context` on the endpoint base class is `protected`, which is incompatible
 * with public structural-type checking; we duck-type internally instead.
 */
export function getPrismaClient(self: unknown): PrismaClient {
  const s = self as PrismaEndpointShape;
  if (s._tx) return s._tx;
  if (s.prisma) return s.prisma;
  const contextClient = s.context?.get?.(CONTEXT_KEYS.prismaClient as never);
  if (contextClient) return contextClient as PrismaClient;
  // Request-time misconfiguration — surface as 500 CONFIGURATION_ERROR.
  throw new ConfigurationException(
    'Prisma client not configured. Either:\n' +
      '1. Set prisma property: prisma = prismaClient;\n' +
      '2. Use middleware: c.set(CONTEXT_KEYS.prismaClient, prismaClient);\n' +
      '3. Use factory: createPrismaCrud(prismaClient, meta)',
  );
}
