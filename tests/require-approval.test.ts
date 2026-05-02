/**
 * Tests for `requireApproval(...)` + `MemoryApprovalStorage` + actor-aware
 * `PendingAction` (0.7.0).
 *
 * Covers:
 *   - First call → 202 with `actionId`, `expiresAt`, `reason`
 *   - Resume call (`_resume_<id>` in body) after approval → handler runs
 *     with the original input
 *   - Resume of an expired action → 403
 *   - Actor identity (userId / agentId / agentRunId / source) flows from
 *     `c.var` to the persisted PendingAction
 *   - ISO 8601 duration parser handles common shapes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';

import {
  requireApproval,
  MemoryApprovalStorage,
  parseIso8601Duration,
  ApiException,
  setContextVar,
} from '../src/index.js';

describe('requireApproval middleware', () => {
  let storage: MemoryApprovalStorage;

  beforeEach(() => {
    storage = new MemoryApprovalStorage();
  });

  function buildApp() {
    const app = new Hono();
    app.onError((err, c) => {
      if (err instanceof ApiException) {
        return c.json(err.toJSON(), err.status);
      }
      return c.json({ error: err.message }, 500);
    });
    app.post(
      '/transfers',
      requireApproval({
        reason: 'Funds transfer',
        approvalStorage: storage,
        expiresAfter: 'PT1H',
      }),
      async (c) => {
        const body = await c.req.json();
        return c.json({ ok: true, body }, 200);
      }
    );
    return app;
  }

  it('first call returns 202 with actionId and persists the action', async () => {
    const app = buildApp();
    const res = await app.request('/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1000 }),
    });
    expect(res.status).toBe(202);
    const json = await res.json() as { status: string; actionId: string; expiresAt: string };
    expect(json.status).toBe('pending');
    expect(json.actionId).toMatch(/^[0-9a-f-]{36}$/);
    const stored = await storage.get(json.actionId);
    expect(stored?.status).toBe('pending');
    expect(stored?.input).toEqual({ amount: 1000 });
    expect(stored?.toolName).toBe('POST /transfers');
    expect(stored?.reason).toBe('Funds transfer');
  });

  it('resume after approval runs the handler with the original input', async () => {
    const app = buildApp();
    // First call — get actionId
    const res1 = await app.request('/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 2000, currency: 'USD' }),
    });
    const { actionId } = await res1.json() as { actionId: string };
    // Approver signs off
    await storage.approve(actionId, 'approver-1');
    // Resume — the handler should run and see the ORIGINAL input
    const res2 = await app.request('/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _resume_: actionId }),
    });
    expect(res2.status).toBe(200);
    const json = await res2.json() as { ok: boolean; body: Record<string, unknown> };
    expect(json.ok).toBe(true);
    expect(json.body).toEqual({ amount: 2000, currency: 'USD' });
  });

  it('resume of an expired action yields 403', async () => {
    const app = buildApp();
    const res1 = await app.request('/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 50 }),
    });
    const { actionId } = await res1.json() as { actionId: string };
    // Manually fast-forward expiry: rewrite the stored action's expiresAt.
    const action = await storage.get(actionId);
    expect(action).not.toBeNull();
    await storage.create({
      ...action!,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const res2 = await app.request('/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _resume_: actionId }),
    });
    expect(res2.status).toBe(403);
  });

  it('resume of a non-approved action yields 403', async () => {
    const app = buildApp();
    const res1 = await app.request('/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 50 }),
    });
    const { actionId } = await res1.json() as { actionId: string };
    // Don't approve. Try to resume.
    const res2 = await app.request('/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _resume_: actionId }),
    });
    expect(res2.status).toBe(403);
  });

  it('captures actor identity from c.var (userId, agentId, source)', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      // Pretend an upstream auth middleware populated these.
      setContextVar(c, 'userId', 'u-42');
      setContextVar(c, 'agentId', 'agent-claude');
      setContextVar(c, 'agentRunId', 'run-123');
      setContextVar(c, 'toolCallId', 'call-7');
      await next();
    });
    app.post(
      '/transfers',
      requireApproval({
        reason: 'Funds transfer',
        approvalStorage: storage,
      }),
      (c) => c.json({ ok: true })
    );

    const res = await app.request('/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100 }),
    });
    expect(res.status).toBe(202);
    const { actionId } = await res.json() as { actionId: string };
    const action = await storage.get(actionId);
    expect(action?.actorUserId).toBe('u-42');
    expect(action?.userId).toBe('u-42');
    expect(action?.agentId).toBe('agent-claude');
    expect(action?.agentRunId).toBe('run-123');
    expect(action?.toolCallId).toBe('call-7');
    // agentId is set, so source defaults to 'agent-mcp'
    expect(action?.source).toBe('agent-mcp');
  });

  it('source defaults to "http" when no agentId is set', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      setContextVar(c, 'userId', 'u-1');
      await next();
    });
    app.post(
      '/transfers',
      requireApproval({
        reason: 'Funds transfer',
        approvalStorage: storage,
      }),
      (c) => c.json({ ok: true })
    );

    const res = await app.request('/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100 }),
    });
    const { actionId } = await res.json() as { actionId: string };
    const action = await storage.get(actionId);
    expect(action?.source).toBe('http');
    expect(action?.agentId).toBeUndefined();
  });
});

describe('requireApproval default storage', () => {
  it('falls back to a process-local in-memory store when approvalStorage is omitted', async () => {
    const app = new Hono();
    app.onError((err, c) => {
      if (err instanceof ApiException) return c.json(err.toJSON(), err.status);
      return c.json({ error: err.message }, 500);
    });
    app.post(
      '/quick',
      // No approvalStorage — POC path. Lib uses an internal singleton.
      requireApproval({ reason: 'POC' }),
      (c) => c.json({ ok: true })
    );

    // First call → 202 + actionId (handler does NOT run)
    const res1 = await app.request('/quick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: 'data' }),
    });
    expect(res1.status).toBe(202);
    const json = await res1.json() as { actionId: string };
    expect(json.actionId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('parseIso8601Duration', () => {
  it.each([
    ['P1D', 86_400_000],
    ['PT1H', 3_600_000],
    ['PT15M', 900_000],
    ['PT30S', 30_000],
    ['P1DT2H', 93_600_000],
    ['PT1H30M', 5_400_000],
  ])('parses %s → %s ms', (input, expected) => {
    expect(parseIso8601Duration(input)).toBe(expected);
  });

  it('rejects malformed duration strings', () => {
    expect(() => parseIso8601Duration('1 day')).toThrow(/Invalid ISO 8601 duration/);
    expect(() => parseIso8601Duration('P')).toThrow(); // zero ms
    expect(() => parseIso8601Duration('P1Y')).toThrow(/Invalid ISO 8601 duration/);
  });
});
