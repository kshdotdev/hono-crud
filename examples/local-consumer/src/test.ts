import { start } from './server.js';

type HealthResponse = {
  status: string;
  package: string;
  install: string;
  features: string[];
};

type SuccessResponse<T> = {
  success: true;
  result: T;
  created?: boolean;
  result_info?: {
    total_count?: number;
  };
};

type User = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'guest';
  status: 'active' | 'inactive' | 'pending';
  age?: number;
  tenantId?: string;
  displayName?: string;
  posts?: Post[];
  deletedAt?: string | null;
};

type Post = {
  id: string;
  authorId: string;
  title: string;
  content: string;
  status: 'draft' | 'published' | 'archived';
};

type Document = {
  id: string;
  title: string;
  content: string;
  version: number;
};

type SeedResponse = {
  userId: string;
  postId: string;
};

type BatchCreateResult<T> = {
  created: T[];
  count: number;
};

type BatchUpdateResult<T> = {
  updated: T[];
  count: number;
};

type BatchDeleteResult<T> = {
  deleted: T[];
  count: number;
};

type BatchRestoreResult<T> = {
  restored: T[];
  count: number;
};

type BatchUpsertResult<T> = {
  items: Array<{
    data: T;
    created: boolean;
    index: number;
  }>;
  createdCount: number;
  updatedCount: number;
  totalCount: number;
};

type AggregateResult = {
  values?: Record<string, number | null>;
  groups?: Array<{
    key: Record<string, unknown>;
    values: Record<string, number | null>;
  }>;
  totalGroups?: number;
};

type ExportResult = {
  data: Array<Record<string, unknown>>;
  count: number;
  format: 'json' | 'csv';
  exportedAt: string;
};

type ImportResult = {
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
};

type SearchResult<T> = Array<{
  item: T;
  score: number;
  matchedFields: string[];
}>;

type BulkPatchResult<T> = {
  success: true;
  matched: number;
  updated: number;
  dryRun: boolean;
  records?: T[];
};

type VersionHistory = {
  versions: Array<{
    version: number;
    data: Record<string, unknown>;
  }>;
  totalVersions: number;
};

type CloseableServer = {
  close: (callback?: (error?: Error) => void) => void;
};

type JsonBody = Record<string, unknown> | Array<Record<string, unknown>>;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isCloseableServer(value: unknown): value is CloseableServer {
  return (
    typeof value === 'object' &&
    value !== null &&
    'close' in value &&
    typeof (value as { close?: unknown }).close === 'function'
  );
}

async function closeServer(server: unknown): Promise<void> {
  if (!isCloseableServer(server)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function expectOk(response: Response, label: string): Promise<void> {
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}: ${await response.text()}`);
  }
}

function jsonRequest(method: string, body?: JsonBody, headers: Record<string, string> = {}): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  label: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  await expectOk(response, label);
  return await json<T>(response);
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still binding the port.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Server did not become healthy at ${baseUrl}`);
}

async function exerciseCrudFeatures(baseUrl: string): Promise<void> {
  const seed = await requestJson<SeedResponse>(
    baseUrl,
    '/seed',
    'seed data',
    jsonRequest('POST')
  );

  const email = `local-${crypto.randomUUID()}@example.com`;
  const created = await requestJson<SuccessResponse<User>>(
    baseUrl,
    '/users',
    'create user',
    jsonRequest('POST', {
      email,
      name: 'Local Package User',
      role: 'admin',
      status: 'active',
      age: 37,
      tenantId: 'tenant-a',
      secretNote: 'stored encrypted by the model config',
      internalNote: 'hidden by serialization profile',
    })
  );
  assert(created.result.email === email, 'Created user email did not round-trip');

  const read = await requestJson<SuccessResponse<User>>(
    baseUrl,
    `/users/${created.result.id}`,
    'read user'
  );
  assert(read.result.id === created.result.id, 'Read endpoint returned the wrong user');
  assert(!('internalNote' in read.result), 'Serialization profile leaked internalNote');
  assert(read.result.displayName === 'Local Package User (admin)', 'Computed field was not returned');

  const related = await requestJson<SuccessResponse<User>>(
    baseUrl,
    `/users/${seed.userId}?include=posts`,
    'read user with relation include'
  );
  assert(Array.isArray(related.result.posts), 'Relation include did not return posts');
  assert(related.result.posts.some((post) => post.id === seed.postId), 'Seed post was not included on user read');

  const listed = await requestJson<SuccessResponse<User[]>>(
    baseUrl,
    '/users?role=admin&fields=id,email,name,displayName&sort=email&order=asc&page=1&per_page=20',
    'list users with filtering, sorting, pagination, and field selection'
  );
  assert(listed.result.some((user) => user.id === created.result.id), 'Created user was not returned from list endpoint');
  assert(typeof listed.result_info?.total_count === 'number', 'List endpoint did not return pagination metadata');

  const updated = await requestJson<SuccessResponse<User>>(
    baseUrl,
    `/users/${created.result.id}`,
    'update user',
    jsonRequest('PATCH', {
      name: 'Updated Local Package User',
      status: 'pending',
    })
  );
  assert(updated.result.name === 'Updated Local Package User', 'Update endpoint did not apply the patch');

  const batchCreated = await requestJson<SuccessResponse<BatchCreateResult<User>>>(
    baseUrl,
    '/users/batch',
    'batch create users',
    jsonRequest('POST', {
      items: [
        {
          email: `batch-a-${crypto.randomUUID()}@example.com`,
          name: 'Batch A',
          role: 'user',
          status: 'active',
          age: 28,
        },
        {
          email: `batch-b-${crypto.randomUUID()}@example.com`,
          name: 'Batch B',
          role: 'guest',
          status: 'inactive',
          age: 31,
        },
      ],
    })
  );
  assert(batchCreated.result.count === 2, 'Batch create did not create both records');

  const batchUpdated = await requestJson<SuccessResponse<BatchUpdateResult<User>>>(
    baseUrl,
    '/users/batch',
    'batch update users',
    jsonRequest('PATCH', {
      items: [
        {
          id: batchCreated.result.created[0].id,
          data: { status: 'pending' },
        },
      ],
    })
  );
  assert(batchUpdated.result.updated[0].status === 'pending', 'Batch update did not patch the selected user');

  const batchDeleted = await requestJson<SuccessResponse<BatchDeleteResult<User>>>(
    baseUrl,
    '/users/batch',
    'batch delete users',
    jsonRequest('DELETE', {
      ids: [batchCreated.result.created[1].id],
    })
  );
  assert(batchDeleted.result.count === 1, 'Batch delete did not delete one user');

  const batchRestored = await requestJson<SuccessResponse<BatchRestoreResult<User>>>(
    baseUrl,
    '/users/batch/restore',
    'batch restore users',
    jsonRequest('POST', {
      ids: [batchCreated.result.created[1].id],
    })
  );
  assert(batchRestored.result.count === 1, 'Batch restore did not restore one user');

  const upserted = await requestJson<SuccessResponse<User>>(
    baseUrl,
    '/users',
    'upsert user',
    jsonRequest('PUT', {
      email,
      name: 'Upserted Local Package User',
      role: 'admin',
      status: 'active',
    })
  );
  assert(upserted.created === false, 'Upsert should have updated the existing user');
  assert(upserted.result.name === 'Upserted Local Package User', 'Upsert update was not applied');

  const batchUpserted = await requestJson<SuccessResponse<BatchUpsertResult<User>>>(
    baseUrl,
    '/users/sync',
    'batch upsert users',
    jsonRequest('PUT', [
      {
        email: `sync-a-${crypto.randomUUID()}@example.com`,
        name: 'Sync A',
        role: 'user',
        status: 'active',
      },
      {
        email,
        name: 'Sync Existing',
        role: 'admin',
        status: 'active',
      },
    ])
  );
  assert(batchUpserted.result.totalCount === 2, 'Batch upsert did not process both rows');

  const searched = await requestJson<SuccessResponse<SearchResult<User>>>(
    baseUrl,
    '/users/search?q=Sync',
    'search users'
  );
  assert(searched.result.length > 0, 'Search endpoint did not return matches');

  const aggregate = await requestJson<SuccessResponse<AggregateResult>>(
    baseUrl,
    '/users/aggregate?count=*&avg=age&groupBy=role',
    'aggregate users'
  );
  assert(Array.isArray(aggregate.result.groups), 'Aggregate endpoint did not return grouped results');

  const exported = await requestJson<SuccessResponse<ExportResult>>(
    baseUrl,
    '/users/export?format=json&role=admin',
    'export users'
  );
  assert(exported.result.format === 'json', 'Export endpoint used the wrong format');
  assert(exported.result.count > 0, 'Export endpoint did not return data');

  const imported = await requestJson<SuccessResponse<ImportResult>>(
    baseUrl,
    '/users/import?mode=upsert',
    'import users',
    jsonRequest('POST', {
      items: [
        {
          email: `import-${crypto.randomUUID()}@example.com`,
          name: 'Imported User',
          role: 'guest',
          status: 'active',
        },
      ],
    })
  );
  assert(imported.result.summary.total === 1, 'Import endpoint did not process one row');

  const cloned = await requestJson<SuccessResponse<User>>(
    baseUrl,
    `/users/${created.result.id}/clone`,
    'clone user',
    jsonRequest('POST', {
      email: `clone-${crypto.randomUUID()}@example.com`,
      name: 'Cloned User',
      role: 'guest',
      status: 'active',
    })
  );
  assert(cloned.result.id !== created.result.id, 'Clone endpoint reused the source ID');

  const dryRun = await requestJson<BulkPatchResult<User>>(
    baseUrl,
    '/users/bulk?role=guest&dryRun=true',
    'bulk patch dry run',
    jsonRequest('PATCH', {
      status: 'pending',
    })
  );
  assert(dryRun.dryRun === true, 'Bulk patch dry run flag was not honored');

  const bulkPatched = await requestJson<BulkPatchResult<User>>(
    baseUrl,
    '/users/bulk?role=guest',
    'bulk patch users',
    jsonRequest('PATCH', {
      status: 'active',
    })
  );
  assert(bulkPatched.updated >= 1, 'Bulk patch did not update matching guest users');

  await requestJson<SuccessResponse<User>>(
    baseUrl,
    `/users/${created.result.id}`,
    'soft delete user',
    jsonRequest('DELETE')
  );

  const restored = await requestJson<SuccessResponse<User>>(
    baseUrl,
    `/users/${created.result.id}/restore`,
    'restore user',
    jsonRequest('POST')
  );
  assert(restored.result.deletedAt === null || restored.result.deletedAt === undefined, 'Restore endpoint did not clear deletedAt');
}

async function exerciseSupportFeatures(baseUrl: string): Promise<void> {
  const admin = await requestJson<{ ok: true; user: { roles: string[] } }>(
    baseUrl,
    '/admin/ping',
    'auth guard',
    {
      headers: {
        'X-User-Role': 'admin',
      },
    }
  );
  assert(admin.user.roles.includes('admin'), 'Auth guard did not receive admin role');

  await requestJson<{ ok: true }>(baseUrl, '/limited/ping', 'rate limit first request');
  await requestJson<{ ok: true }>(baseUrl, '/limited/ping', 'rate limit second request');
  const limited = await fetch(`${baseUrl}/limited/ping`);
  assert(limited.status === 429, `Expected rate limit status 429, got ${limited.status}`);

  const idempotencyKey = crypto.randomUUID();
  const firstOrder = await fetch(`${baseUrl}/idempotent/orders`, jsonRequest('POST', { sku: 'local-1' }, {
    'Idempotency-Key': idempotencyKey,
  }));
  await expectOk(firstOrder, 'idempotency first request');
  const firstOrderBody = await firstOrder.text();

  const replayedOrder = await fetch(`${baseUrl}/idempotent/orders`, jsonRequest('POST', { sku: 'local-1' }, {
    'Idempotency-Key': idempotencyKey,
  }));
  await expectOk(replayedOrder, 'idempotency replay request');
  assert(replayedOrder.headers.get('Idempotency-Replayed') === 'true', 'Idempotency replay header was not set');
  assert(await replayedOrder.text() === firstOrderBody, 'Idempotency replay did not return the cached body');

  const tenant = await requestJson<{ tenantId: string }>(
    baseUrl,
    '/tenant/context',
    'multi-tenant context',
    {
      headers: {
        'X-Tenant-ID': 'tenant-a',
      },
    }
  );
  assert(tenant.tenantId === 'tenant-a', 'Tenant middleware did not set tenantId');

  const versioned = await requestJson<{ version: string }>(
    baseUrl,
    '/versioned/ping',
    'api versioning',
    {
      headers: {
        'Accept-Version': '1',
      },
    }
  );
  assert(versioned.version === '1', 'API versioning middleware did not resolve version 1');

  const firstCache = await requestJson<{ hit: boolean; value: string }>(
    baseUrl,
    '/cache/demo',
    'cache miss'
  );
  const secondCache = await requestJson<{ hit: boolean; value: string }>(
    baseUrl,
    '/cache/demo',
    'cache hit'
  );
  assert(firstCache.hit === false && secondCache.hit === true, 'Cache endpoint did not miss then hit');
  assert(firstCache.value === secondCache.value, 'Cache endpoint returned inconsistent values');

  const cacheDeleted = await requestJson<{ deleted: number }>(
    baseUrl,
    '/cache/tag/local-consumer',
    'cache tag invalidation',
    jsonRequest('DELETE')
  );
  assert(cacheDeleted.deleted >= 1, 'Cache tag invalidation did not remove an entry');

  const encrypted = await requestJson<{ encrypted: unknown; decrypted: string }>(
    baseUrl,
    '/crypto/roundtrip',
    'encryption roundtrip',
    jsonRequest('POST', {
      value: 'sensitive local value',
    })
  );
  assert(encrypted.decrypted === 'sensitive local value', 'Encryption roundtrip did not decrypt to the original value');

  const serialized = await requestJson<Record<string, unknown>>(
    baseUrl,
    '/serialization/public-user',
    'serialization profile',
    jsonRequest('POST', {
      id: 'profile-user',
      email: 'profile@example.com',
      internalNote: 'hidden',
      extra: 'kept',
    })
  );
  assert(!('internalNote' in serialized), 'Serialization profile did not exclude internalNote');
  assert(serialized.email === 'profile@example.com', 'Serialization profile did not include email');

  const events = await requestJson<{ count: number; events: unknown[] }>(
    baseUrl,
    '/events',
    'events endpoint'
  );
  assert(Array.isArray(events.events), 'Events endpoint did not return an event array');

  const auditLogs = await requestJson<{ logs: unknown[] }>(
    baseUrl,
    '/audit-logs',
    'audit logs endpoint'
  );
  assert(Array.isArray(auditLogs.logs), 'Audit logs endpoint did not return a log array');

  const openApi = await requestJson<Record<string, unknown>>(
    baseUrl,
    '/openapi.json',
    'OpenAPI document'
  );
  assert(openApi.openapi === '3.1.0', 'OpenAPI document was not generated');

  const docs = await fetch(`${baseUrl}/docs`);
  await expectOk(docs, 'Swagger UI docs');
}

async function exerciseDocumentFeatures(baseUrl: string): Promise<void> {
  const created = await requestJson<SuccessResponse<Document>>(
    baseUrl,
    '/documents',
    'create document',
    jsonRequest('POST', {
      title: 'Versioned Local Document',
      content: 'Initial content',
    })
  );

  await requestJson<SuccessResponse<Document>>(
    baseUrl,
    `/documents/${created.result.id}`,
    'first document update',
    jsonRequest('PATCH', {
      content: 'Second content',
    })
  );

  await requestJson<SuccessResponse<Document>>(
    baseUrl,
    `/documents/${created.result.id}`,
    'second document update',
    jsonRequest('PATCH', {
      content: 'Third content',
    })
  );

  const history = await requestJson<SuccessResponse<VersionHistory>>(
    baseUrl,
    `/documents/${created.result.id}/versions`,
    'version history'
  );
  assert(history.result.totalVersions >= 1, 'Version history did not record updates');

  const versionOne = await requestJson<SuccessResponse<{ version: number }>>(
    baseUrl,
    `/documents/${created.result.id}/versions/1`,
    'version read'
  );
  assert(versionOne.result.version === 1, 'Version read did not return version 1');

  const compared = await requestJson<SuccessResponse<{ from: number; to: number; changes: unknown[] }>>(
    baseUrl,
    `/documents/${created.result.id}/versions/compare?from=1&to=2`,
    'version compare'
  );
  assert(compared.result.from === 1 && compared.result.to === 2, 'Version compare returned the wrong bounds');

  const rolledBack = await requestJson<SuccessResponse<Document>>(
    baseUrl,
    `/documents/${created.result.id}/versions/1/rollback`,
    'version rollback',
    jsonRequest('POST')
  );
  assert(rolledBack.result.id === created.result.id, 'Version rollback returned the wrong document');
}

async function exercisePostFeatures(baseUrl: string): Promise<void> {
  const user = await requestJson<SuccessResponse<User>>(
    baseUrl,
    '/users',
    'create post owner',
    jsonRequest('POST', {
      email: `post-owner-${crypto.randomUUID()}@example.com`,
      name: 'Post Owner',
      role: 'user',
      status: 'active',
    })
  );

  const post = await requestJson<SuccessResponse<Post>>(
    baseUrl,
    '/posts',
    'create post',
    jsonRequest('POST', {
      authorId: user.result.id,
      title: 'Local Consumer Post',
      content: 'Created through the file-installed package example',
      status: 'published',
    })
  );
  assert(post.result.authorId === user.result.id, 'Post create did not attach the owner ID');

  const listed = await requestJson<SuccessResponse<Post[]>>(
    baseUrl,
    `/posts?authorId=${user.result.id}`,
    'list posts'
  );
  assert(listed.result.some((item) => item.id === post.result.id), 'Post list did not return the created post');

  const read = await requestJson<SuccessResponse<Post>>(
    baseUrl,
    `/posts/${post.result.id}`,
    'read post'
  );
  assert(read.result.title === 'Local Consumer Post', 'Post read returned the wrong record');
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT) || 4567;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = start(port);

  try {
    await waitForHealth(baseUrl);

    const health = await requestJson<HealthResponse>(baseUrl, '/health', 'health check');
    assert(health.package === 'hono-crud', `Unexpected package name: ${health.package}`);
    assert(health.install === 'file:../..', `Unexpected install type: ${health.install}`);
    assert(health.features.includes('bulk-patch'), 'Health payload did not list the expanded feature set');

    await requestJson<Record<string, unknown>>(baseUrl, '/ready', 'readiness check');

    await exerciseCrudFeatures(baseUrl);
    await exercisePostFeatures(baseUrl);
    await exerciseDocumentFeatures(baseUrl);
    await exerciseSupportFeatures(baseUrl);

    console.log(`Local file-install feature test passed: ${baseUrl}`);
  } finally {
    await closeServer(server);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
