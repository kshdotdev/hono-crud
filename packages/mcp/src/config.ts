import type { NamingContext, OperationName, ToolAnnotations } from './types';

/** Default tool name: `` `${resource}_${operation}` `` (e.g. `users_list`). */
export function defaultNaming(ctx: NamingContext): string {
  return `${ctx.resource}_${ctx.operation}`;
}

/**
 * Default MCP annotations per operation. `readOnlyHint` and `destructiveHint`
 * let an LLM client warn before a mutating/destructive call. `destructiveHint`
 * defaults to `true` in the MCP spec when absent, so non-destructive mutating
 * operations set it to `false` explicitly. `idempotentHint` is set only where
 * honest: repeating the same call with the same arguments converges on the
 * same state (upsert, update, restore).
 */
const DEFAULT_ANNOTATIONS: Record<OperationName, ToolAnnotations> = {
  // Read-only operations
  list: { readOnlyHint: true },
  read: { readOnlyHint: true },
  search: { readOnlyHint: true },
  aggregate: { readOnlyHint: true },
  export: { readOnlyHint: true },
  versionHistory: { readOnlyHint: true },
  versionRead: { readOnlyHint: true },
  versionCompare: { readOnlyHint: true },
  // Non-destructive mutations
  create: { readOnlyHint: false, destructiveHint: false },
  update: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  upsert: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  restore: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  clone: { readOnlyHint: false, destructiveHint: false },
  batchCreate: { readOnlyHint: false, destructiveHint: false },
  batchUpdate: { readOnlyHint: false, destructiveHint: false },
  batchRestore: { readOnlyHint: false, destructiveHint: false },
  batchUpsert: { readOnlyHint: false, destructiveHint: false },
  bulkPatch: { readOnlyHint: false, destructiveHint: false },
  versionRollback: { readOnlyHint: false, destructiveHint: false },
  // Destructive mutations
  delete: { readOnlyHint: false, destructiveHint: true },
  batchDelete: { readOnlyHint: false, destructiveHint: true },
};

export function resolveAnnotations(
  operation: OperationName,
  override?: ToolAnnotations,
): ToolAnnotations {
  return { ...DEFAULT_ANNOTATIONS[operation], ...override };
}

/** Naive singularization for description text only (`users` -> `user`). */
function singular(resource: string): string {
  return resource.endsWith('s') ? resource.slice(0, -1) : resource;
}

/** Per-operation description templates. `resource` is plural, `one` is singularized. */
const DESCRIPTIONS: Record<OperationName, (resource: string, one: string) => string> = {
  list: (resource) => `List ${resource} with optional filters, search, sorting and pagination.`,
  read: (_resource, one) => `Get a single ${one} by id.`,
  create: (_resource, one) => `Create a new ${one}.`,
  update: (_resource, one) => `Update an existing ${one} by id.`,
  delete: (_resource, one) => `Delete a ${one} by id.`,
  restore: (_resource, one) => `Restore a soft-deleted ${one} by id.`,
  batchCreate: (resource) => `Create multiple ${resource} in one call.`,
  batchUpdate: (resource) => `Update multiple ${resource} by id in one call.`,
  batchDelete: (resource) => `Delete multiple ${resource} by id in one call.`,
  batchRestore: (resource) => `Restore multiple soft-deleted ${resource} by id in one call.`,
  batchUpsert: (resource) => `Insert or update multiple ${resource} in one call.`,
  search: (resource) => `Full-text search ${resource} with relevance scoring.`,
  aggregate: (resource) =>
    `Compute aggregations (count, sum, avg, min, max, group by) over ${resource}.`,
  export: (resource) => `Export ${resource} in bulk.`,
  upsert: (_resource, one) => `Insert a new ${one} or update the existing one.`,
  clone: (_resource, one) => `Duplicate an existing ${one} by id.`,
  bulkPatch: (resource) => `Apply one partial update to all ${resource} matching a filter.`,
  versionHistory: (_resource, one) => `List the version history of a ${one} by id.`,
  versionRead: (_resource, one) => `Get a specific version of a ${one}.`,
  versionCompare: (_resource, one) => `Compare two versions of a ${one}.`,
  versionRollback: (_resource, one) => `Roll a ${one} back to a previous version.`,
};

export function defaultDescription(
  resource: string,
  operation: OperationName,
  base?: string,
): string {
  const prefix = base ? `${base} ` : '';
  return `${prefix}${DESCRIPTIONS[operation](resource, singular(resource))}`;
}
