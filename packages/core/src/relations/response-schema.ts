import { type ZodObject, type ZodRawShape, z } from 'zod';

import type { MetaInput, RelationConfig } from '../core/types';

/**
 * Extend a List/Read response **item** schema with the model's includable
 * relations, so the OpenAPI response documents what `?include=<relation>`
 * returns — and generated typed clients auto-type the embedded related data
 * instead of consumers having to hand-type it.
 *
 * A relation is added only when it is listed in `allowedIncludes` AND declares a
 * `schema` (the related model's shape). The field is always OPTIONAL, since the
 * relation is present only when explicitly requested via `?include=`:
 *   - `hasMany`            → `z.array(relationSchema).optional()`
 *   - `belongsTo` / `hasOne` → `relationSchema.nullable().optional()`
 *
 * No-op (returns `itemSchema` unchanged) when there are no allowed includes or no
 * included relation declares a `schema`.
 */
export function withIncludableRelations(
  itemSchema: ZodObject<ZodRawShape>,
  meta: MetaInput,
  allowedIncludes: readonly string[],
): ZodObject<ZodRawShape> {
  const relations = meta.model.relations;
  if (!relations || allowedIncludes.length === 0) return itemSchema;

  const extension: ZodRawShape = {};
  for (const name of allowedIncludes) {
    const relation = relations[name] as RelationConfig | undefined;
    const relationSchema = relation?.schema;
    if (!relationSchema) continue;
    extension[name] =
      relation.type === 'hasMany'
        ? z.array(relationSchema).optional()
        : relationSchema.nullable().optional();
  }

  return Object.keys(extension).length > 0 ? itemSchema.extend(extension) : itemSchema;
}
