# Transactional hooks, approvals, and event delivery

This guide covers three orthogonal-but-composable mechanisms added in 0.6.0
+ 0.7.0:

1. **Transactional hooks** (`HookContext.db.tx`) — make `before`/`after`
   hooks participate in the same DB transaction as the parent write.
2. **Approval guard** (`requireApproval`) — gate dangerous operations on
   human approval, replay the original input on resume.
3. **Event delivery** — bridge the in-process `CrudEventEmitter` to a
   real queue (BullMQ, SQS, Cloudflare Queues, NATS, …) safely.

Read this front-to-back if you're integrating these features for the
first time. Skip to a specific section if you already have context.

---

## Mental model — two layers of "is this allowed?"

| Mechanism | When it runs | What it controls |
|---|---|---|
| `requireApproval(...)` | BEFORE the write — middleware layer | Whether the write is allowed to happen at all (and when) |
| Transactional hooks | INSIDE the write — wrapped by the DB transaction | Atomicity: whether the DB write commits or rolls back |

They are independent. A write can have one, the other, both, or neither.
The guide first walks each in isolation, then shows them composed.

---

## 1. Transactional hooks (`HookContext.db.tx`)

### The bug class this prevents

Every CRUD endpoint exposes lifecycle hooks:

```ts
class OrderCreate extends DrizzleCreateEndpoint {
  override async after(order, hookCtx) {
    // do something with the freshly-created order
  }
}
```

Common things `after()` does in production:
- Publish a domain event (`order.created`) to a message bus
- INSERT a row into an `outbox` table for reliable event delivery
- Create a related record (audit log entry, notification record)
- Call an external API (charge a card, ping a webhook)

The dangerous one is **writing a sibling row that should be atomic with
the parent INSERT**. This is the classic event-outbox pattern.

### The naïve (broken) implementation

```ts
// PSEUDO — broken
override async after(order, hookCtx) {
  await db.insert(outbox).values({
    type: 'order.created',
    payload: order,
    status: 'pending',
  });
}
```

A separate worker reads `outbox` and publishes to your queue.
Eventually-consistent, "reliable."

The bug: with no shared transaction, the parent INSERT into `orders` and
the `outbox` INSERT are independent. If anything throws between them,
you get one without the other:

| Scenario | `orders` | `outbox` | Result |
|---|---|---|---|
| All good | ✅ | ✅ | Worker publishes ✓ |
| `after()` throws BEFORE outbox insert | ✅ | ❌ | **Event lost forever — silent desync** |
| Outbox insert fails | ✅ | ❌ | Same |
| Parent commit fails after hooks ran | ❌ | ✅ | **Phantom event for an order that doesn't exist** |

Production discovers this months later when downstream systems disagree.

### What the lib provides

`HookContext` is passed to every `before`/`after` hook on Create / Update
/ Delete:

```ts
interface HookContext {
  db: { tx: unknown };       // adapter-specific tx handle
  request?: Request;
  tenantId?: string;
  organizationId?: string;
  userId?: string;
  agentId?: string;
  agentRunId?: string;
}
```

When the Drizzle adapter has `useTransaction = true`, `handle()` wraps
the entire flow in `db.transaction(async (tx) => { ... })` and threads
`tx` into `HookContext.db.tx`. Use it like this:

```ts
import { drizzle } from 'drizzle-orm/<dialect>';
import type { HookContext } from 'hono-crud';

class OrderCreate extends DrizzleCreateEndpoint {
  protected useTransaction = true;

  override async after(order, hookCtx: HookContext) {
    // Same transaction as the parent INSERT — atomic
    await drizzle(hookCtx.db.tx).insert(outbox).values({
      type: 'order.created',
      payload: order,
      status: 'pending',
    });
  }
}
```

Now the matrix collapses:

| Scenario | `orders` | `outbox` | Result |
|---|---|---|---|
| All good | ✅ | ✅ | Both committed atomically |
| Anything throws | ❌ rolled back | ❌ rolled back | **Atomic** — caller gets 500, neither row written |

The system is **either fully done or fully reverted**. No half-states.

### When rollback actually fires

Three conditions, all required:

1. The adapter wraps in a real transaction. **Drizzle adapter** does this
   when `useTransaction = true`. **Memory adapter** does NOT (no real
   transactions — see sentinel below). **Prisma adapter** does not auto-
   wrap as of 0.7.0; if you need this for Prisma, override `handle()` to
   wrap with `prisma.$transaction(...)`.
2. `afterHookMode === 'sequential'` (the default). The `after()` hook
   runs INSIDE the transaction.
3. The hook throws.

If `afterHookMode === 'fire-and-forget'`, the response is sent before
the hook runs — you cannot retroactively roll back. This mode is for
non-blocking work like email sends.

### Adapter-specific behavior

| Adapter | `HookContext.db.tx` value | Throwing in `after()` rolls back? |
|---|---|---|
| **Drizzle** + `useTransaction = true` | The actual Drizzle tx handle | **Yes** (when sequential mode) |
| **Drizzle** + `useTransaction = false` | `undefined` | No — write already committed |
| **Memory** | `MEMORY_NOOP_TX` sentinel | No — no real tx |
| **Prisma** (default) | `undefined` | No — needs `handle()` override |

The `MEMORY_NOOP_TX` sentinel exists so production code can feature-detect
"I'm running against a backend that doesn't support rollback":

```ts
import { MEMORY_NOOP_TX } from 'hono-crud/adapters/memory';

override async after(order, hookCtx) {
  if (hookCtx.db.tx === MEMORY_NOOP_TX) {
    // running against memory adapter — skip outbox writes or fail loudly
    throw new Error('event-outbox pattern requires a real DB adapter');
  }
  await drizzle(hookCtx.db.tx).insert(outbox).values({...});
}
```

### Override signature

Hooks accept the `HookContext` as a **required** second parameter:

```ts
override async after(data: User, hookCtx: HookContext): Promise<User> {
  await drizzle(hookCtx.db.tx).insert(audit).values({...});
  return data;
}
```

There's no optional / "legacy without ctx" form — the lib is pre-1.0
and the API was designed with the context in place rather than added as
an afterthought. Override authors should always declare the parameter,
even if they only use it in some branches.

---

## 2. Approval guard (`requireApproval`)

### The problem

Some operations are dangerous and should require human approval:

- An AI agent says "transfer $50,000 to account X" — review before the
  bank wire fires.
- An admin tool offers "delete all users matching this filter" — second
  pair of eyes required.
- An LLM-driven bot wants to "merge this PR" — needs author signoff.

Without a primitive, every developer reinvents the same broken pattern:
a status field on the table, a manual approve button, ad-hoc bookkeeping,
no expiry, no audit trail of who-approved-what.

### The two-phase flow

`requireApproval(...)` formalizes a deferred-execution dance.

#### Phase 1 — caller submits the request

```http
POST /transfers
Content-Type: application/json

{ "amount": 50000, "to": "account-x" }
```

The middleware intercepts BEFORE the handler runs:

1. Reads the body.
2. Detects no `_resume_` field → fresh request.
3. Pulls actor identity from `c.var.*` (`userId`, `agentId`,
   `agentRunId`, `toolCallId`, optional `actionSource`).
4. Persists a `PendingAction` to the configured `ApprovalStorage`. If
   `approvalStorage` is omitted, the lib uses a process-local
   `MemoryApprovalStorage` singleton — convenient for single-server
   POCs and tutorials. **First use of the default emits a one-time
   warning** via `getLogger()` so multi-instance / serverless / edge
   deployments can't silently end up with process-local state. Pass an
   explicit storage (Postgres / Durable Objects / etc.) for production:

   ```ts
   {
     id: 'a3f-...',
     toolName: 'POST /transfers',
     input: { amount: 50000, to: 'account-x' },
     status: 'pending',
     actorUserId: 'human-7',
     agentId: 'agent-claude',
     agentRunId: 'run-9001',
     source: 'agent-mcp',
     reason: 'Funds transfer',
     createdAt: '...',
     expiresAt: '...'   // ISO 8601 P1D default
   }
   ```

5. Returns `202 Accepted` with `{ status: 'pending', actionId, expiresAt, reason }`.

The handler **does not run**. No money moves.

#### Phase 1.5 — approver decides (in your inbox UI)

Your downstream UI lists pending actions for the relevant approver:

```ts
await approvalStorage.approve('a3f-...', 'reviewer-1');
// status flips to 'approved', records approvedBy + approvedAt
```

Or:

```ts
await approvalStorage.reject('a3f-...', 'reviewer-1', 'amount too high');
```

#### Phase 2 — caller resumes

```http
POST /transfers
Content-Type: application/json

{ "_resume_": "a3f-..." }
```

The middleware intercepts again:

1. Reads the body, sees `_resume_` → resume call.
2. Looks up the action: `status === 'approved'`, not expired ✓.
3. **Replays the original input** by overwriting `req.bodyCache.text`
   with `JSON.stringify({ amount: 50000, to: 'account-x' })` (Hono's
   canonical body cache slot).
4. `await next()` — the handler runs, sees the original body, completes
   the transfer.

The handler is unchanged. It does:

```ts
const body = await c.req.json();
// receives: { amount: 50000, to: 'account-x' } — never sees the resume marker
```

### The body-replay mechanism

The middleware has to make the handler see the original body even though
the actual incoming body is `{ _resume_: "<id>" }`.

Hono's `c.req.json()` is implemented as
`cachedBody('text').then(JSON.parse)`. The canonical cache slot is
`bodyCache.text` (a Promise resolving to the raw text). On resume, the
middleware:

1. JSON.stringifies the original input.
2. Wraps in `Promise.resolve(...)` to match Hono's expected cache shape.
3. Overwrites `req.bodyCache.text`.
4. Deletes `req.bodyCache.parsedBody` and `req.bodyCache.json` (form-
   parser and zod-openapi caches that might hold stale data).

When the handler then calls `c.req.json()`, Hono returns the cached
value — the original body.

> **⚠️ Maintainer note: Hono-internal coupling.** The body-replay
> mechanism reads and writes Hono's internal `req.bodyCache.text` slot
> (a `Promise<string>`). This is intentional — Hono 4.x has no public
> API for "set the request body" — but it means the implementation is
> coupled to Hono's request internals. The lib pins
> `peerDependencies.hono` to `>=4.11.7 <5` to bound the surface; any
> Hono 5.x bump must re-verify that `bodyCache.text` is still the
> canonical slot driving `req.json()`. If it changes, update
> `replayRequestBody` in `src/auth/guards.ts` to match the new shape.

### Actor identity matrix

`PendingAction` carries enough fields to distinguish every realistic
caller. The middleware reads from `c.var`:

| Scenario | `actorUserId` | `agentId` | `onBehalfOfUserId` | `source` |
|---|---|---|---|---|
| Human via web UI | `'u-7'` | undefined | undefined | `'http'` |
| AI agent acting on its own | undefined | `'agent-7'` | undefined | `'agent-mcp'` |
| AI agent on behalf of a human | `'u-9'` | `'agent-7'` | `'u-9'` | `'agent-mcp'` |
| Agent in code-mode | undefined | `'agent-7'` | undefined | `'agent-code-mode'` |
| Workflow step | `'system'` | undefined | undefined | `'workflow'` |
| Cron job | `'system'` | undefined | undefined | `'job'` |
| System trigger | undefined | undefined | undefined | `'system'` |

Without these fields you can't answer "did a human or an AI initiate
this $50k transfer?" — which becomes a regulatory problem in finance,
healthcare, and anything AI-assisted.

To populate them, set the relevant vars in upstream middleware:

```ts
app.use('*', async (c, next) => {
  const auth = await verifyJWT(c);
  setContextVar(c, 'userId', auth.sub);
  if (auth.agentId) setContextVar(c, 'agentId', auth.agentId);
  if (auth.agentRunId) setContextVar(c, 'agentRunId', auth.agentRunId);
  if (auth.toolCallId) setContextVar(c, 'toolCallId', auth.toolCallId);
  if (auth.onBehalfOfUserId) setContextVar(c, 'onBehalfOfUserId', auth.onBehalfOfUserId);
  await next();
});
```

`source` defaults to `'agent-mcp'` if `agentId` is set, else `'http'`.
Override by setting `c.var.actionSource` explicitly.

### ISO 8601 duration parsing

`expiresAfter: 'P1D'` is the public API. The lib ships `parseIso8601Duration`
for the subset that matters (`P[nD][T[nH][nM][nS]]`):

| Input | Milliseconds |
|---|---|
| `P1D` | 86_400_000 |
| `PT1H` | 3_600_000 |
| `PT15M` | 900_000 |
| `P1DT2H` | 93_600_000 |

Years and months (`P1Y`, `P3M`) are rejected — variable length, not
meaningful for approval expiry windows.

The parser is tiny (~30 lines), no dependencies, no `node:*` imports.

---

## 3. Composing them — full transfer flow

The two mechanisms stack naturally:

```ts
app.post(
  '/transfers',
  requireApproval({ reason: 'Funds transfer over $1k' }),  // gate the request
  TransferCreate,                                            // runs after approval
);

class TransferCreate extends DrizzleCreateEndpoint {
  protected useTransaction = true;

  override async after(transfer, hookCtx) {
    // INSIDE the same tx as the INSERT — atomic
    await drizzle(hookCtx.db.tx).insert(outbox).values({
      type: 'transfer.created',
      payload: transfer,
    });
  }
}
```

Walkthrough:

1. Agent POSTs `{ amount: 50000, ... }` → `requireApproval` writes a
   pending action, returns 202. **Nothing else happens.**
2. Human approves in the inbox UI.
3. Agent POSTs `{ _resume_: '<id>' }` → `requireApproval` replays the
   original body and calls `next()`.
4. `TransferCreate.handle()` opens a Drizzle transaction.
5. INSERT into `transfers`.
6. `after(transfer, hookCtx)` runs — INSERT into `outbox` using
   `hookCtx.db.tx` (same transaction).
7. Transaction commits — both rows land atomically.
8. A separate worker eventually polls the outbox and publishes the
   `transfer.created` event to your queue.

If anything throws at any step, the parent INSERT rolls back AND the
outbox INSERT rolls back. No phantom events, no orphan outbox rows.

---

## 4. Storage — durable backends for `ApprovalStorage`

### Why memory storage isn't enough for production

The lib ships `MemoryApprovalStorage` for tests, prototyping, and a
single-process dev loop. It is **not** for production.

| Deployment | What breaks with in-memory |
|---|---|
| Multi-instance Node behind a load balancer | Phase 1 hits instance A, phase 2 hits instance B → "action not found" → 403 |
| Cloudflare Workers | Each isolate has its own RAM; isolates spin up/down freely; no guarantee of identity between phases |
| AWS Lambda / serverless | Cold starts wipe everything; 24h TTL meaningless when the runtime dies between requests |
| Pod restart during deployment | All pending actions evaporate |
| Auditor asks "show every approval from last quarter" | No history |

### Five properties of safe storage

A durable approval store needs:

1. **Durability across process restart** — Postgres / D1 / DynamoDB /
   Durable Objects / Redis-with-AOF. Anything that survives process death.
2. **Cross-instance visibility** — Phase 1 and phase 2 may hit different
   processes/regions/edges. Storage must be globally consistent (or at
   least strongly consistent within the action's tenancy boundary).
3. **Idempotent state transitions** — `approve(id, by)` must be safe to
   call twice; double-clicks and retries shouldn't corrupt state.
4. **Audit trail / immutability of decisions** — once approved or
   rejected, decision fields should be set ONCE, enforceable by check
   constraint or trigger.
5. **Encryption-at-rest for `input`** — the `input` field captures the
   original request body verbatim. May be PII, financial data, etc.
   Use TDE, column-level encryption, or app-layer encryption.

### Reference implementation: Postgres

```sql
CREATE TABLE pending_actions (
  id UUID PRIMARY KEY,
  tenant_id UUID,
  organization_id UUID,
  actor_user_id TEXT,
  on_behalf_of_user_id TEXT,
  agent_id TEXT,
  agent_run_id TEXT,
  tool_call_id TEXT,
  source TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  rejected_by TEXT,
  rejected_reason TEXT,
  CONSTRAINT terminal_immutable CHECK (
    (status = 'pending') OR
    (status = 'approved' AND approved_by IS NOT NULL AND rejected_by IS NULL) OR
    (status = 'rejected' AND rejected_by IS NOT NULL AND approved_by IS NULL) OR
    (status = 'expired')
  )
);

CREATE INDEX idx_pending_by_tenant ON pending_actions(tenant_id, status, created_at DESC);
CREATE INDEX idx_pending_by_actor  ON pending_actions(actor_user_id, status);
CREATE INDEX idx_pending_expiring  ON pending_actions(expires_at) WHERE status = 'pending';
```

```ts
import type { ApprovalStorage, PendingAction } from 'hono-crud';
import type { PgClient } from 'pg';

export class PostgresApprovalStorage implements ApprovalStorage {
  constructor(private db: PgClient) {}

  async create(a: PendingAction) {
    await this.db.query(
      `INSERT INTO pending_actions
        (id, tenant_id, organization_id, actor_user_id, on_behalf_of_user_id,
         agent_id, agent_run_id, tool_call_id, source, tool_name, input,
         status, reason, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [a.id, a.tenantId, a.organizationId, a.actorUserId, a.onBehalfOfUserId,
       a.agentId, a.agentRunId, a.toolCallId, a.source, a.toolName, a.input,
       a.status, a.reason, a.createdAt, a.expiresAt]
    );
  }

  async get(id: string): Promise<PendingAction | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM pending_actions WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return null;
    const action = rowToPendingAction(rows[0]);
    // Lazy expiry — surface 'expired' status without a background sweeper.
    if (action.status === 'pending' && Date.parse(action.expiresAt) <= Date.now()) {
      this.db.query(
        `UPDATE pending_actions SET status='expired'
         WHERE id=$1 AND status='pending'`,
        [id]
      ).catch(() => {});  // best-effort write-back
      return { ...action, status: 'expired' };
    }
    return action;
  }

  async approve(id: string, by: string) {
    const result = await this.db.query(
      `UPDATE pending_actions
       SET status='approved', approved_by=$1, approved_at=now()
       WHERE id=$2 AND status='pending'`,
      [by, id]
    );
    if (result.rowCount === 0) {
      const action = await this.get(id);
      if (!action) throw new Error(`Action ${id} not found`);
      throw new Error(`Action ${id} cannot be approved from status '${action.status}'`);
    }
  }

  async reject(id: string, by: string, reason: string) {
    const result = await this.db.query(
      `UPDATE pending_actions
       SET status='rejected', rejected_by=$1, rejected_reason=$2
       WHERE id=$3 AND status='pending'`,
      [by, reason, id]
    );
    if (result.rowCount === 0) {
      const action = await this.get(id);
      if (!action) throw new Error(`Action ${id} not found`);
      throw new Error(`Action ${id} cannot be rejected from status '${action.status}'`);
    }
  }
}
```

The `WHERE status='pending'` clause makes both `approve` and `reject`
idempotent at the SQL level — a second call is a no-op (rowCount=0)
that you can detect and handle.

### Edge-native: Cloudflare Durable Objects

Each pending action becomes its own Durable Object instance — no
contention, single-writer guarantees, and built-in alarms for expiry:

```ts
export class ApprovalActionDO {
  constructor(private state: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/create' && req.method === 'POST') {
      const action = await req.json() as PendingAction;
      await this.state.storage.put('action', action);
      // Schedule expiry alarm — fires even after the DO sleeps
      await this.state.storage.setAlarm(Date.parse(action.expiresAt));
      return new Response(null, { status: 201 });
    }

    if (url.pathname === '/get') {
      const action = await this.state.storage.get<PendingAction>('action');
      return Response.json(action ?? null);
    }

    if (url.pathname === '/approve' && req.method === 'POST') {
      const { by } = await req.json() as { by: string };
      const action = await this.state.storage.get<PendingAction>('action');
      if (!action) return new Response('Not found', { status: 404 });
      if (action.status !== 'pending') return new Response('Terminal', { status: 409 });
      Object.assign(action, {
        status: 'approved',
        approvedBy: by,
        approvedAt: new Date().toISOString(),
      });
      await this.state.storage.put('action', action);
      return new Response(null, { status: 200 });
    }
    // ... reject likewise

    return new Response('Not found', { status: 404 });
  }

  // Fires deterministically at the action's expiresAt
  async alarm() {
    const action = await this.state.storage.get<PendingAction>('action');
    if (action && action.status === 'pending') {
      action.status = 'expired';
      await this.state.storage.put('action', action);
    }
  }
}

export class DurableObjectApprovalStorage implements ApprovalStorage {
  constructor(private namespace: DurableObjectNamespace) {}

  private stub(actionId: string) {
    const id = this.namespace.idFromName(actionId);
    return this.namespace.get(id);
  }

  async create(action: PendingAction) {
    await this.stub(action.id).fetch('http://do/create', {
      method: 'POST',
      body: JSON.stringify(action),
    });
  }

  async get(actionId: string) {
    const res = await this.stub(actionId).fetch('http://do/get');
    return await res.json() as PendingAction | null;
  }

  async approve(actionId: string, by: string) {
    const res = await this.stub(actionId).fetch('http://do/approve', {
      method: 'POST',
      body: JSON.stringify({ by }),
    });
    if (!res.ok) throw new Error(`Approve failed: ${res.status}`);
  }

  async reject(actionId: string, by: string, reason: string) {
    const res = await this.stub(actionId).fetch('http://do/reject', {
      method: 'POST',
      body: JSON.stringify({ by, reason }),
    });
    if (!res.ok) throw new Error(`Reject failed: ${res.status}`);
  }
}
```

Trade-offs vs Postgres:
- ✅ Built-in alarm replaces lazy-expiry — actions expire deterministically
- ✅ Each action is single-writer → race conditions physically impossible
- ✅ Strongly consistent globally
- ✅ Costs scale with distinct actions, not with traffic
- ❌ Harder to query ("show all pending for tenant X") — add a sibling KV
  index or a Postgres mirror just for queries

### Hybrid: Postgres + Redis cache

For high-traffic deployments where many `get()` calls would hit Postgres
unnecessarily:

```ts
class CachedPgApprovalStorage implements ApprovalStorage {
  constructor(
    private pg: PostgresApprovalStorage,
    private redis: Redis
  ) {}

  async create(a: PendingAction) {
    await this.pg.create(a);
    await this.redis.set(`pa:${a.id}`, JSON.stringify(a), 'EX', 3600);
  }

  async get(id: string) {
    const cached = await this.redis.get(`pa:${id}`);
    if (cached) {
      const action: PendingAction = JSON.parse(cached);
      if (Date.parse(action.expiresAt) > Date.now()) return action;
    }
    const action = await this.pg.get(id);
    if (action) await this.redis.set(`pa:${id}`, JSON.stringify(action), 'EX', 3600);
    return action;
  }

  async approve(id: string, by: string) {
    await this.pg.approve(id, by);
    await this.redis.del(`pa:${id}`);  // invalidate; next get() refetches
  }

  async reject(id: string, by: string, reason: string) {
    await this.pg.reject(id, by, reason);
    await this.redis.del(`pa:${id}`);
  }
}
```

Postgres is the source of truth, Redis is a write-through cache. Reads
hit Redis (sub-ms); writes go to both. Cache invalidation via `del` on
terminal transitions keeps stale `'pending'` from being read after
approval.

---

## 5. Event delivery — bridging `CrudEventEmitter` to a queue

`CrudEventEmitter` is in-process pub/sub. Listeners are functions —
nothing forces them to handle events in-process. **Listeners are the
integration boundary.**

### Pattern 1 — listener publishes to an external queue (at-most-once)

The simple, immediate case. Write a one-line listener that pushes the
event onto your queue.

**Cloudflare Queues:**

```ts
emitter.onAny(async (event) => {
  await env.MY_QUEUE.send(event);
});
```

**BullMQ (Redis):**

```ts
import { Queue } from 'bullmq';
const eventQueue = new Queue('crud-events', { connection: redis });

emitter.onAny(async (event) => {
  await eventQueue.add(event.type, event);
});
```

**SQS:**

```ts
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
const sqs = new SQSClient({});

emitter.onAny(async (event) => {
  await sqs.send(new SendMessageCommand({
    QueueUrl: process.env.SQS_URL!,
    MessageBody: JSON.stringify(event),
    MessageAttributes: {
      type:     { DataType: 'String', StringValue: event.type },
      tenantId: { DataType: 'String', StringValue: event.tenantId ?? '' },
    },
  }));
});
```

**NATS / Kafka / RabbitMQ / Redis Streams** — same shape every time.

#### When to use Pattern 1

- Lossy events are tolerable (analytics, recommendation training data,
  non-critical notifications).
- Failure of the queue publish doesn't need to block the response.
- You're OK with the publish happening AFTER the parent write commits
  (no atomicity).

#### The trap

If the queue is down when the listener runs, the event is **lost** —
your CRUD write committed, but no event went out. Same exact problem as
the outbox bug class from §1. Use Pattern 2 below for events that must
not be lost.

### Pattern 2 — outbox table + worker (at-least-once with atomicity)

This is where the **transactional hooks** become load-bearing.

1. Override `after()` on your write endpoint.
2. INSERT into an `outbox` table using `hookCtx.db.tx` — same
   transaction as the parent write.
3. A separate worker polls the outbox and publishes to the real queue.

```ts
class OrderCreate extends DrizzleCreateEndpoint {
  protected useTransaction = true;

  override async after(order, hookCtx) {
    // Same tx as the parent INSERT — atomic
    await drizzle(hookCtx.db.tx).insert(outbox).values({
      id: crypto.randomUUID(),
      type: 'order.created',
      payload: order,
      tenantId: hookCtx.tenantId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  }
}
```

```ts
// Separate worker (cron / consumer / Durable Object alarm)
async function publishOutbox() {
  const pending = await db
    .select()
    .from(outbox)
    .where(eq(outbox.status, 'pending'))
    .limit(100);

  for (const row of pending) {
    try {
      await myQueue.send(row);
      await db.update(outbox)
        .set({ status: 'published' })
        .where(eq(outbox.id, row.id));
    } catch {
      // Leave row in 'pending' — next poll retries
    }
  }
}
```

Why this works:
- Parent write rolls back → outbox row rolls back → no phantom events.
- Parent write commits → outbox row commits → worker eventually publishes
  (possibly multiple times if retries happen).
- Result: **at-least-once delivery** with **transactional consistency**
  between the data change and the event.

#### When to use Pattern 2

- Critical events that must not be lost (payments, billing, compliance
  triggers).
- Cross-system synchronization (warehouse, search index, data lake).
- When consumers can deduplicate (idempotent event handlers, or you
  include an `event.id` for dedup at the consumer side).

### Picking between the two

| Requirement | Pattern 1 (listener) | Pattern 2 (outbox) |
|---|---|---|
| Latency to queue | Microseconds | Polling interval (often seconds) |
| Atomic with parent write | ❌ | ✅ |
| Survives queue downtime | ❌ | ✅ (rows queued in DB) |
| Survives parent rollback | ✅ wrong way (publishes anyway) | ✅ (correctly rolls back) |
| Implementation cost | One function | Schema + worker + dedup |
| Best for | Telemetry, analytics, fan-out | Money, audit, cross-system sync |

You can mix: use Pattern 1 for `view.recorded` events, Pattern 2 for
`payment.completed`. Same emitter, different listeners.

---

## 6. Notifying on `pending_action.created`

Combining storage + event delivery: when a pending action is created,
notify the approver (Slack, email, push). Two patterns again.

### Decorator over `ApprovalStorage` (composable)

Wrap any `ApprovalStorage` implementation with a notifier:

```ts
import type { ApprovalStorage, PendingAction, CrudEventEmitter } from 'hono-crud';

export class NotifyingApprovalStorage implements ApprovalStorage {
  constructor(
    private inner: ApprovalStorage,
    private emitter: CrudEventEmitter
  ) {}

  async create(a: PendingAction) {
    await this.inner.create(a);
    // Reuse the existing event emitter — listeners decide delivery
    await this.emitter.emit({
      type: 'created' as const,
      table: '__pending_actions__',
      recordId: a.id,
      data: a,
      timestamp: new Date().toISOString(),
      tenantId: a.tenantId,
      organizationId: a.organizationId,
      userId: a.actorUserId,
    });
  }

  async get(id: string) { return this.inner.get(id); }
  async approve(id: string, by: string) { return this.inner.approve(id, by); }
  async reject(id: string, by: string, reason: string) {
    return this.inner.reject(id, by, reason);
  }
}

// Wire it up:
const storage = new NotifyingApprovalStorage(
  new PostgresApprovalStorage(db),
  emitter
);

emitter.on('__pending_actions__', 'created', async (event) => {
  // Push to Slack, send email, fan out to your approver inbox queue
  await env.APPROVAL_NOTIFY_QUEUE.send(event);
});
```

The decorator pattern composes cleanly. Keep your durable storage
backend, layer the notification channel on top, listeners decide how to
deliver.

### Atomic-with-storage notify

If "notify on creation" must be reliable (no Slack message lost), put
the notify into the same transaction as the storage write:

```ts
class TxNotifyingPostgresApprovalStorage implements ApprovalStorage {
  constructor(private db: PgPool) {}

  async create(a: PendingAction) {
    await this.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO pending_actions (...) VALUES (...)`, [...]);
      await tx.query(
        `INSERT INTO outbox (type, payload) VALUES ($1, $2)`,
        ['pending_action.created', JSON.stringify(a)]
      );
    });
    // Worker polls outbox separately and publishes
  }
  // ...
}
```

Pending action and notification event are written atomically. If the
INSERT fails, no notification fires. If the notification's INSERT fails,
no pending action gets created.

---

## 7. The full stack — diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Hono app                                                    │
│                                                              │
│  POST /transfers                                             │
│   ├─► requireApproval(config)                                │
│   │      ├─ writes to PostgresApprovalStorage                │
│   │      └─ returns 202 (handler does NOT run)               │
│   │                                                          │
│   └─► [resume] requireApproval                               │
│          ├─ replays original input via bodyCache.text        │
│          └─► TransferCreate (useTransaction = true)          │
│                ├─ opens Drizzle tx                           │
│                ├─ INSERT into transfers                      │
│                ├─ after(record, hookCtx) writes outbox row   │
│                │   using hookCtx.db.tx (same tx)             │
│                └─ commits or rolls back atomically           │
│                                                              │
└─────────────────┬────────────────────────────────────────────┘
                  │
                  ▼ polled by worker (cron / alarm / consumer)
          ┌──────────────┐
          │  Real queue  │ ◄── Slack, email, analytics,
          │  (BullMQ /   │     fan-out to approver inbox UI,
          │   SQS / NATS │     downstream services
          │   / Kafka)   │
          └──────────────┘
```

Three independent layers, each pluggable:

1. **`ApprovalStorage`** — your choice of durable backend (Postgres, D1,
   DynamoDB, Durable Objects).
2. **`HookContext.db.tx`** — provided by the lib, lets you write outbox
   rows atomically with parent writes.
3. **External queue** — your choice (BullMQ, SQS, Kafka, NATS,
   Cloudflare Queues, RabbitMQ).

The lib doesn't impose any of (1) or (3). It gives you the seams (`ApprovalStorage`
interface, `HookContext.db.tx`, `CrudEventEmitter`) and the atomicity
primitive. You wire your stack to your infra.

---

## 8. Operational concerns the lib doesn't impose

Things `requireApproval` and the hook system deliberately don't dictate
so production teams can pick policies:

### Background sweeper for `expired` rows

Long-lived storage benefits from normalizing expired-but-still-pending
rows on a schedule:

```sql
UPDATE pending_actions
SET status = 'expired'
WHERE status = 'pending' AND expires_at < now();
```

Run on a cron / k8s job / DO alarm. Keeps query metrics honest. The
lib's `get()` does lazy expiry (returns `'expired'` status without
needing the sweeper); the sweeper just normalizes the at-rest state for
queries that bypass `get()`.

### Inbox UI for approvers

Not in the lib — downstream consumers build their own:

```sql
SELECT *
FROM pending_actions
WHERE tenant_id = $1
  AND status = 'pending'
  AND (
    -- approvers in this role can see actions for these tools
    tool_name = ANY($2::text[])
  )
ORDER BY created_at DESC
LIMIT 50;
```

### Replay attack prevention (idempotency on resume)

An approved action could in principle be resumed multiple times if the
resume call is idempotent at the HTTP layer. If your handler is non-
idempotent (transfer money), wrap with the lib's existing `idempotency`
middleware OR mark the action `consumed` after first resume. The minimal
addition would be a 5th method on `ApprovalStorage`:

```ts
markConsumed(id: string): Promise<void>;
```

Not in 0.7.0 — left as a deliberate extension point for v0.8 once
consumption semantics are exercised in practice.

### Multi-approver flows ("requires 2 of 3 senior managers")

The current `approve(id, by)` is single-approver. Multi-party would
need a new method (`recordApproval(id, by)` that aggregates) and a
configurable quorum on `ApprovalConfig`. Out of scope for 0.7.0;
achievable as an additive interface evolution because consumers
implement the storage themselves.

### Encryption-at-rest for `input`

The `input` field captures sensitive request bodies. Pick one:

- App-layer encryption with a tenant-scoped key (encrypt `input` before
  passing to `storage.create(...)`, decrypt in `get(...)`).
- Whole-DB at-rest encryption (Postgres TDE, RDS encryption).
- Column-level encryption (`pgcrypto`, native column encryption).

Not in the lib — the choice is policy and trust-boundary specific.

---

## 9. TL;DR

- **Transactional hooks** make `after()` participate in the parent DB tx
  so things like outbox-row writes are atomic with the parent INSERT.
  Required for reliable event delivery. Drizzle adapter wires the real
  tx; memory adapter exposes a `MEMORY_NOOP_TX` sentinel.
- **`requireApproval`** intercepts requests, persists a `PendingAction`
  carrying full actor identity, returns 202, and replays the original
  body on resume after approval.
- **`MemoryApprovalStorage`** is reference-only. Production needs a
  durable backend that satisfies the five properties (durability,
  cross-instance, idempotent transitions, audit immutability,
  encryption-at-rest). Postgres, Durable Objects, and Pg + Redis hybrid
  are all viable.
- **Event delivery** plugs into any queue via `emitter.onAny(...)`. Use
  Pattern 1 (direct publish) for telemetry; use Pattern 2 (outbox + worker)
  for events that must not be lost.
- **Notification on `pending_action.created`** is a decorator over
  `ApprovalStorage` that emits an event for listeners to forward to
  Slack/email/queue. For reliability, write the notification as an
  outbox row in the same DB transaction as the pending action.

The library stops at the seams. You ship the bridge to your infrastructure.
