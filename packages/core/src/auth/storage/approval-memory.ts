/**
 * In-memory `ApprovalStorage` reference implementation.
 *
 * Stores pending actions in a `Map<actionId, PendingAction>`. Lazy expiry
 * on `get(...)` (no `setInterval` — banned in edge runtimes; see
 * `tests/edge-safety.test.ts`).
 *
 * Suitable for:
 *   - Local development / tests
 *   - Edge isolates that don't outlive a single-tenant request flight
 *
 * Not suitable for production cross-isolate state — wire a Postgres /
 * Durable Object backed `ApprovalStorage` in those scenarios.
 */
import type { Context, Env } from 'hono';
import { CONTEXT_KEYS } from '../../core/context-keys';
import { getLogger } from '../../core/logger';
import { createStorageFeature } from '../../storage/feature';
import type { ApprovalStorage, PendingAction } from '../types';

export class MemoryApprovalStorage implements ApprovalStorage {
  private readonly store = new Map<string, PendingAction>();

  async create(action: PendingAction): Promise<void> {
    this.store.set(action.id, { ...action });
  }

  async get(actionId: string): Promise<PendingAction | null> {
    const action = this.store.get(actionId);
    if (!action) return null;
    // Lazy expiry: surface the action with status 'expired' so callers
    // distinguish 'never existed' from 'too late'. Don't delete from the
    // map — historical visibility for debugging.
    if (action.status === 'pending' && Date.parse(action.expiresAt) <= Date.now()) {
      const expired = { ...action, status: 'expired' as const };
      this.store.set(actionId, expired);
      return expired;
    }
    return { ...action };
  }

  async approve(actionId: string, by: string): Promise<void> {
    const action = await this.get(actionId);
    if (!action) {
      throw new Error(`Pending action ${actionId} not found`);
    }
    if (action.status !== 'pending') {
      throw new Error(
        `Pending action ${actionId} cannot be approved from status '${action.status}'`,
      );
    }
    this.store.set(actionId, {
      ...action,
      status: 'approved',
      approvedBy: by,
      approvedAt: new Date().toISOString(),
    });
  }

  async reject(actionId: string, by: string, reason: string): Promise<void> {
    const action = await this.get(actionId);
    if (!action) {
      throw new Error(`Pending action ${actionId} not found`);
    }
    if (action.status !== 'pending') {
      throw new Error(
        `Pending action ${actionId} cannot be rejected from status '${action.status}'`,
      );
    }
    this.store.set(actionId, {
      ...action,
      status: 'rejected',
      rejectedBy: by,
      rejectedReason: reason,
    });
  }

  /** Test helper: clear all stored actions. Not part of the interface. */
  clear(): void {
    this.store.clear();
  }
}

// ============================================================================
// Global Storage Feature
// ============================================================================

/**
 * Global approval storage feature.
 *
 * `getApprovalStorageRequired()` lazy-creates a process-local
 * `MemoryApprovalStorage` default (with a one-time warning) so zero-config
 * POCs keep working; `getApprovalStorage()` and request-time resolution only
 * return explicit, context, or configured global storage (no hidden default).
 */
const approvalStorageFeature = createStorageFeature<ApprovalStorage>({
  contextKey: CONTEXT_KEYS.approvalStorage,
  defaultFactory: () => {
    // The factory runs at most once per isolate (per registry reset), so the
    // warning is naturally once-per-isolate.
    getLogger().warn(
      'requireApproval: no approval storage configured — using process-local in-memory storage. ' +
        'NOT safe for multi-instance / serverless / edge-isolate deployments where phase 1 and ' +
        'phase 2 may hit different processes. Pass an explicit storage (config.storage) or ' +
        'inject approvalStorage with createStorageMiddleware() for production.',
    );
    return new MemoryApprovalStorage();
  },
});

/**
 * Global approval storage registry (exported for advanced use / tests).
 */
export const approvalStorageRegistry = approvalStorageFeature.registry;

/**
 * Set the global approval storage.
 */
export const setApprovalStorage = approvalStorageFeature.set;

/**
 * Get the explicitly-configured global approval storage, or null. Never throws
 * and never materializes the in-memory default.
 */
export const getApprovalStorage = approvalStorageFeature.get;

/**
 * Get the global approval storage, lazily creating the warned process-local
 * `MemoryApprovalStorage` default when none was configured.
 */
export const getApprovalStorageRequired = approvalStorageFeature.getRequired;

/**
 * Resolves approval storage with priority: explicit param > context > global.
 * Never creates a default — returns null when nothing is configured.
 *
 * @param ctx - Optional Hono context
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage, or null when no storage was configured
 */
export function resolveApprovalStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: ApprovalStorage,
): ApprovalStorage | null {
  return approvalStorageFeature.resolve(ctx, explicitStorage);
}
