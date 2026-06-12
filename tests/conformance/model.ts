/**
 * The shared conformance model: one field contract used by every adapter leg.
 *
 * Canonical fields (identical names + semantics on every adapter):
 *   id        — uuid primary key, library-generated (`crypto.randomUUID()`)
 *   name      — non-empty string
 *   email     — unique (enforced by the SQL backends; the memory adapter has
 *               no constraint surface — see the `uniqueConstraints` capability)
 *   role      — 'admin' | 'user' | 'guest', defaults to 'user'
 *   age       — nullable int
 *   deletedAt — nullable soft-delete marker (`softDelete: { field: 'deletedAt' }`)
 *   createdAt / updatedAt — managed timestamps; epoch-ms numbers when
 *               library-managed (memory/drizzle), ISO strings when DB-managed
 *               (prisma examples schema)
 *   tenant discriminator — `tenantId` nullable column on memory/drizzle; the
 *               prisma leg reuses the examples schema's `status` column
 *               (see TenantWiring in contract.ts)
 *
 * Adapter legs derive their Zod schema from `buildConformanceSchema` and
 * `.extend()` the leg-specific column, so the contract lives in one place.
 */
import type { FilterConfig } from 'hono-crud';
import { z } from 'zod';
import { type ConformanceApp, type ConformanceRecord, createRecord } from './contract';

export const CONFORMANCE_ROLES = ['admin', 'user', 'guest'] as const;

export type ConformanceTimestampKind = 'epoch-ms' | 'iso-datetime';

export function buildConformanceSchema(timestampKind: ConformanceTimestampKind) {
  const timestamp = timestampKind === 'epoch-ms' ? z.number() : z.string();
  return z.object({
    id: z.uuid(),
    name: z.string().min(1),
    email: z.email(),
    role: z.enum(CONFORMANCE_ROLES).default('user'),
    age: z.number().int().nullable().optional(),
    deletedAt: z.string().nullable().optional(),
    createdAt: timestamp.optional(),
    updatedAt: timestamp.optional(),
  });
}

/**
 * Operators every adapter must accept on the list endpoint. The filter cells
 * exercise exactly these.
 */
export const CONFORMANCE_FILTER_CONFIG: FilterConfig = {
  role: ['eq', 'ne', 'in'],
  age: ['eq', 'gt', 'gte', 'lt', 'lte'],
  name: ['like', 'ilike'],
};

export interface ConformanceSeedRow {
  name: string;
  email: string;
  role: (typeof CONFORMANCE_ROLES)[number];
  age: number;
}

/**
 * Fixed dataset for the filter matrix and pagination cells.
 *
 * Deliberate properties:
 * - 'Alice Anderson' vs 'alice cooper': pins `like` case-sensitivity and
 *   `ilike` case-insensitivity.
 * - 'Carol 100% Pure' vs 'Dave 100 Wool': pins that user-supplied `%` is
 *   inert (stripped, never a wildcard) and `_` is literal.
 * - Emails sort deterministically: alice < bob < carol < cooper < dave.
 */
export const FILTER_SEED: readonly ConformanceSeedRow[] = [
  { name: 'Alice Anderson', email: 'alice@conformance.test', role: 'admin', age: 35 },
  { name: 'alice cooper', email: 'cooper@conformance.test', role: 'user', age: 28 },
  { name: 'Bob Brown', email: 'bob@conformance.test', role: 'user', age: 22 },
  { name: 'Carol 100% Pure', email: 'carol@conformance.test', role: 'guest', age: 40 },
  { name: 'Dave 100 Wool', email: 'dave@conformance.test', role: 'guest', age: 50 },
];

/** Emails of FILTER_SEED in ascending order (pagination walk expectation). */
export const SEED_EMAILS_SORTED: readonly string[] = [...FILTER_SEED]
  .map((row) => row.email)
  .sort();

/** Creates all FILTER_SEED rows through the real create endpoint. */
export async function seedFilterRows(
  app: ConformanceApp,
  basePath: string,
): Promise<Map<string, ConformanceRecord>> {
  const byEmail = new Map<string, ConformanceRecord>();
  for (const row of FILTER_SEED) {
    const created = await createRecord(app, basePath, { ...row });
    byEmail.set(row.email, created);
  }
  return byEmail;
}
