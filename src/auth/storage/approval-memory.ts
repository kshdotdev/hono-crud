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
        `Pending action ${actionId} cannot be approved from status '${action.status}'`
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
        `Pending action ${actionId} cannot be rejected from status '${action.status}'`
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
