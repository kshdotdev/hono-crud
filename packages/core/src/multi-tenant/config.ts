/**
 * Multi-tenant configuration normalization + tenant-id extraction.
 */

import type { Context } from 'hono';
import type { MultiTenantConfig, NormalizedMultiTenantConfig } from '../core/types';
import { getContextVar } from '../utils/context';

/**
 * Get normalized multi-tenant configuration from a model.
 * Returns a consistent config object with all defaults applied.
 */
export function getMultiTenantConfig(
  multiTenant: boolean | MultiTenantConfig | undefined,
): NormalizedMultiTenantConfig {
  const defaults: NormalizedMultiTenantConfig = {
    enabled: false,
    field: 'tenantId',
    source: 'context',
    headerName: 'X-Tenant-ID',
    contextKey: 'tenantId',
    pathParam: 'tenantId',
    required: true,
    errorMessage: 'Tenant ID is required',
  };

  if (!multiTenant) {
    return defaults;
  }

  if (multiTenant === true) {
    return {
      ...defaults,
      enabled: true,
    };
  }

  return {
    enabled: true,
    field: multiTenant.field ?? defaults.field,
    source: multiTenant.source ?? defaults.source,
    headerName: multiTenant.headerName ?? defaults.headerName,
    contextKey: multiTenant.contextKey ?? defaults.contextKey,
    pathParam: multiTenant.pathParam ?? defaults.pathParam,
    getTenantId: multiTenant.getTenantId,
    required: multiTenant.required ?? defaults.required,
    errorMessage: multiTenant.errorMessage ?? defaults.errorMessage,
  };
}

/**
 * Extract tenant ID from context based on configuration.
 * Returns undefined if tenant ID is not found.
 */
export function extractTenantId(
  ctx: Context,
  config: NormalizedMultiTenantConfig,
): string | undefined {
  if (!config.enabled) {
    return undefined;
  }

  // source → extractor lookup map
  const extractors: Record<NormalizedMultiTenantConfig['source'], () => string | undefined> = {
    header: () => ctx.req.header(config.headerName),
    context: () => getContextVar<string>(ctx, config.contextKey),
    path: () => ctx.req.param(config.pathParam),
    custom: () => config.getTenantId?.(ctx),
  };

  return extractors[config.source]?.();
}
