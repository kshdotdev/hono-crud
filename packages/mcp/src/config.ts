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

export function defaultDescription(
  resource: string,
  operation: OperationName,
  base?: string,
): string {
  const prefix = base ? `${base} ` : '';
  const one = singular(resource);
  switch (operation) {
    case 'list':
      return `${prefix}List ${resource} with optional filters, search, sorting and pagination.`;
    case 'read':
      return `${prefix}Get a single ${one} by id.`;
    case 'create':
      return `${prefix}Create a new ${one}.`;
    case 'update':
      return `${prefix}Update an existing ${one} by id.`;
    case 'delete':
      return `${prefix}Delete a ${one} by id.`;
  }
}
