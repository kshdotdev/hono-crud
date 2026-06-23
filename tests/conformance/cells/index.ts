/**
 * Registers every conformance cell against one adapter descriptor.
 *
 * Lifecycle: `setup()` once per adapter describe block (beforeAll), `reset()`
 * before every test, optional `teardown()` afterAll. Cells receive a lazy
 * context getter because the context only exists after beforeAll runs.
 */
import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { AdapterContext, AdapterDescriptor, CtxGetter } from '../contract';
import { registerBatchTenantScopingCells } from './batch-tenant-scoping';
import { registerBulkPatchCells } from './bulk-patch';
import { registerCursorPaginationCells } from './cursor-pagination';
import { registerEtagConcurrencyCells } from './etag-concurrency';
import { registerExtendedVerbTenantScopingCells } from './extended-verb-tenant-scoping';
import { registerFilterOperatorCells } from './filter-operators';
import { registerFinalizePipelineCells } from './finalize-pipeline';
import { registerManagedFieldCells } from './managed-fields';
import { registerPaginationCells } from './pagination';
import { registerRelationScopingCells } from './relation-scoping';
import { registerSoftDeleteLifecycleCells } from './soft-delete-lifecycle';
import { registerTenantScopingCells } from './tenant-scoping';
import { registerTransactionalHookCells } from './transactional-hooks';
import { registerUniqueConflictCells } from './unique-conflict';
import { registerUpsertRestoreCells } from './upsert-restore';

export function registerConformanceCells(descriptor: AdapterDescriptor): void {
  let context: AdapterContext | undefined;

  const ctx: CtxGetter = () => {
    if (!context) {
      throw new Error(`conformance context for '${descriptor.name}' is not initialised`);
    }
    return context;
  };

  beforeAll(async () => {
    context = await descriptor.setup();
  });

  afterAll(async () => {
    await context?.teardown?.();
  });

  beforeEach(async () => {
    await ctx().reset();
  });

  registerSoftDeleteLifecycleCells(descriptor, ctx);
  registerFilterOperatorCells(descriptor, ctx);
  registerPaginationCells(descriptor, ctx);
  registerEtagConcurrencyCells(descriptor, ctx);
  registerManagedFieldCells(descriptor, ctx);
  registerUniqueConflictCells(descriptor, ctx);
  registerTenantScopingCells(descriptor, ctx);
  registerRelationScopingCells(descriptor, ctx);
  registerBatchTenantScopingCells(descriptor, ctx);
  registerExtendedVerbTenantScopingCells(descriptor, ctx);
  registerFinalizePipelineCells(descriptor, ctx);
  registerUpsertRestoreCells(descriptor, ctx);
  registerTransactionalHookCells(descriptor, ctx);
  registerCursorPaginationCells(descriptor, ctx);
  registerBulkPatchCells(descriptor, ctx);
}
