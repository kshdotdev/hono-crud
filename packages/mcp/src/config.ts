import type { NamingContext, OperationName, ToolAnnotations } from './types';

/** Default tool name: `` `${resource}_${operation}` `` (e.g. `users_list`). */
export function defaultNaming(ctx: NamingContext): string {
  return `${ctx.resource}_${ctx.operation}`;
}

/**
 * Default MCP annotations per operation. `readOnlyHint` and `destructiveHint`
 * let an LLM client warn before a mutating/destructive call.
 */
const DEFAULT_ANNOTATIONS: Record<OperationName, ToolAnnotations> = {
  list: { readOnlyHint: true },
  read: { readOnlyHint: true },
  create: { readOnlyHint: false, destructiveHint: false },
  update: { readOnlyHint: false, destructiveHint: false },
  delete: { readOnlyHint: false, destructiveHint: true },
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
};

export function defaultDescription(
  resource: string,
  operation: OperationName,
  base?: string,
): string {
  const prefix = base ? `${base} ` : '';
  return `${prefix}${DESCRIPTIONS[operation](resource, singular(resource))}`;
}
