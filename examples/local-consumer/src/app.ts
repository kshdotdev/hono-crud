import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  StaticKeyProvider,
  applyProfile,
  apiVersion,
  createHealthEndpoints,
  createRateLimitMiddleware,
  decryptValue,
  defineMeta,
  defineModel,
  encryptValue,
  fromHono,
  getApiVersion,
  idempotency,
  multiTenant,
  registerCrud,
  requireRoles,
  setAuditStorage,
  setEventEmitter,
  setIdempotencyStorage,
  setRateLimitStorage,
  setVersioningStorage,
  setupSwaggerUI,
  MemoryAuditLogStorage,
  MemoryCacheStorage,
  MemoryIdempotencyStorage,
  MemoryRateLimitStorage,
  MemoryVersioningStorage,
  CrudEventEmitter,
  type AuthEnv,
  type AuthUser,
  type CrudEventPayload,
  type SerializationProfile,
} from 'hono-crud';
import {
  clearStorage,
  getStorage,
  MemoryAggregateEndpoint,
  MemoryBatchCreateEndpoint,
  MemoryBatchDeleteEndpoint,
  MemoryBatchRestoreEndpoint,
  MemoryBatchUpdateEndpoint,
  MemoryBatchUpsertEndpoint,
  MemoryBulkPatchEndpoint,
  MemoryCloneEndpoint,
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryExportEndpoint,
  MemoryImportEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryRestoreEndpoint,
  MemorySearchEndpoint,
  MemoryUpdateEndpoint,
  MemoryUpsertEndpoint,
  MemoryVersionCompareEndpoint,
  MemoryVersionHistoryEndpoint,
  MemoryVersionReadEndpoint,
  MemoryVersionRollbackEndpoint,
} from 'hono-crud/adapters/memory';

type AppEnv = AuthEnv & {
  Variables: AuthEnv['Variables'] & {
    tenantId?: string;
  };
};

type EndpointInstance = {
  setContext(ctx: Context<AppEnv>): void;
  handle(): Promise<Response>;
};

type EndpointConstructor = new () => EndpointInstance;

function endpoint(RouteClass: EndpointConstructor): MiddlewareHandler<AppEnv> {
  return async (c) => {
    const route = new RouteClass();
    route.setContext(c);
    return await route.handle();
  };
}

const publicUserProfile: SerializationProfile = {
  name: 'public-user',
  exclude: ['internalNote'],
  alwaysInclude: ['id', 'email'],
};

const encryptionKeyProvider = new StaticKeyProvider(
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  'local-example-key'
);

const PostSchema = z.object({
  id: z.string().uuid(),
  authorId: z.string().uuid(),
  title: z.string().min(1),
  content: z.string().min(1),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user', 'guest']).default('user'),
  status: z.enum(['active', 'inactive', 'pending']).default('active'),
  age: z.number().int().min(0).max(130).optional(),
  tenantId: z.string().optional(),
  secretNote: z.union([z.string(), z.unknown()]).optional(),
  internalNote: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
});

const DocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  content: z.string().min(1),
  version: z.number().int().min(1).default(1),
  updatedAt: z.string().datetime().optional(),
});

type User = z.infer<typeof UserSchema>;
type Post = z.infer<typeof PostSchema>;
type Document = z.infer<typeof DocumentSchema>;

const PostModel = defineModel({
  tableName: 'posts',
  schema: PostSchema,
  primaryKeys: ['id'],
});

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  softDelete: true,
  relations: {
    posts: {
      type: 'hasMany',
      model: 'posts',
      foreignKey: 'authorId',
      schema: PostSchema,
      nestedWrites: {
        allowCreate: true,
      },
    },
  },
  computedFields: {
    displayName: {
      schema: z.string(),
      dependsOn: ['name', 'role'],
      compute: (user) => `${user.name} (${user.role})`,
    },
  },
  audit: {
    enabled: true,
    actions: ['create', 'update', 'delete', 'restore', 'batch_create', 'batch_update', 'batch_delete', 'batch_restore', 'upsert', 'batch_upsert'],
    excludeFields: ['secretNote'],
  },
  fieldEncryption: {
    fields: ['secretNote'],
    keyProvider: encryptionKeyProvider,
  },
  serializationProfile: publicUserProfile,
});

const DocumentModel = defineModel({
  tableName: 'documents',
  schema: DocumentSchema,
  primaryKeys: ['id'],
  versioning: {
    enabled: true,
    field: 'version',
    historyTable: 'documents_history',
  },
});

const userMeta = defineMeta({ model: UserModel });
const postMeta = defineMeta({ model: PostModel });
const documentMeta = defineMeta({ model: DocumentModel });

function timestamp(): string {
  return new Date().toISOString();
}

function withTimestamps<T extends Record<string, unknown>>(data: T): T {
  const now = timestamp();
  return {
    ...data,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : now,
  };
}

function authFromHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const role = c.req.header('X-User-Role') ?? 'guest';
    const user: AuthUser = {
      id: c.req.header('X-User-ID') ?? 'local-user',
      roles: [role],
      permissions: role === 'admin' ? ['users:read', 'users:write'] : ['users:read'],
    };
    c.set('user', user);
    c.set('userId', user.id);
    c.set('roles', user.roles);
    c.set('permissions', user.permissions);
    c.set('authType', 'api-key');
    await next();
  };
}

class UserCreate extends MemoryCreateEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Create a user' };

  override async before(data: User): Promise<User> {
    return withTimestamps(data);
  }
}

class UserList extends MemoryListEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'List users' };
  filterFields = ['role', 'status', 'tenantId'];
  filterConfig = {
    role: ['eq', 'in'] as const,
    status: ['eq', 'in'] as const,
    age: ['gt', 'gte', 'lt', 'lte', 'between'] as const,
    tenantId: ['eq'] as const,
  };
  searchFields = ['name', 'email'];
  sortFields = ['name', 'email', 'createdAt'];
  defaultSort = { field: 'createdAt', order: 'desc' as const };
  allowedIncludes = ['posts'];
  fieldSelectionEnabled = true;
  allowedSelectFields = ['id', 'email', 'name', 'role', 'status', 'age', 'tenantId', 'displayName', 'createdAt', 'updatedAt'];
  blockedSelectFields = ['secretNote', 'internalNote'];
}

class UserRead extends MemoryReadEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Read a user' };
  allowedIncludes = ['posts'];
  fieldSelectionEnabled = true;
  allowedSelectFields = ['id', 'email', 'name', 'role', 'status', 'age', 'tenantId', 'displayName', 'createdAt', 'updatedAt'];
  blockedSelectFields = ['secretNote', 'internalNote'];
}

class UserUpdate extends MemoryUpdateEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Update a user' };
  allowedUpdateFields = ['email', 'name', 'role', 'status', 'age', 'tenantId', 'secretNote', 'internalNote'];

  override async before(data: Partial<User>): Promise<Partial<User>> {
    return {
      ...data,
      updatedAt: timestamp(),
    };
  }
}

class UserDelete extends MemoryDeleteEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Soft-delete a user' };
}

class UserRestore extends MemoryRestoreEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Restore a soft-deleted user' };
}

class UserBatchCreate extends MemoryBatchCreateEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Batch create users' };
}

class UserBatchUpdate extends MemoryBatchUpdateEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Batch update users' };
}

class UserBatchDelete extends MemoryBatchDeleteEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Batch soft-delete users' };
}

class UserBatchRestore extends MemoryBatchRestoreEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Batch restore users' };
}

class UserUpsert extends MemoryUpsertEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Upsert a user by email' };
  upsertKeys = ['email'];
}

class UserBatchUpsert extends MemoryBatchUpsertEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Batch upsert users by email' };
  upsertKeys = ['email'];
}

class UserSearch extends MemorySearchEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Full-text search users' };
  searchFields = ['name', 'email'];
  fieldWeights = { name: 2, email: 1 };
  filterFields = ['role', 'status'];
}

class UserAggregate extends MemoryAggregateEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Aggregate users' };
  aggregateConfig = {
    avgFields: ['age'],
    minMaxFields: ['age'],
    countDistinctFields: ['role'],
    groupByFields: ['role', 'status'],
  };
  filterFields = ['role', 'status'];
}

class UserExport extends MemoryExportEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Export users as JSON or CSV' };
  filterFields = ['role', 'status'];
  searchFields = ['name', 'email'];
  excludedExportFields = ['secretNote', 'internalNote'];
}

class UserImport extends MemoryImportEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Import users from JSON or CSV' };
  upsertKeys = ['email'];
  optionalImportFields = ['id', 'age', 'tenantId', 'secretNote', 'internalNote', 'createdAt', 'updatedAt', 'deletedAt'];
}

class UserClone extends MemoryCloneEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Clone a user with overrides' };
  excludeFromClone = ['email', 'createdAt', 'updatedAt', 'deletedAt'];
}

class UserBulkPatch extends MemoryBulkPatchEndpoint<AppEnv, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Bulk patch users matching a filter' };
  filterFields = ['role', 'status', 'tenantId'];
  returnRecords = true;

  protected getModelSchema() {
    return UserSchema;
  }

  protected getUpdateSchema() {
    return UserSchema.partial();
  }
}

class PostCreate extends MemoryCreateEndpoint<AppEnv, typeof postMeta> {
  _meta = postMeta;
  schema = { tags: ['Posts'], summary: 'Create a post' };

  override async before(data: Post): Promise<Post> {
    return withTimestamps(data);
  }
}

class PostList extends MemoryListEndpoint<AppEnv, typeof postMeta> {
  _meta = postMeta;
  schema = { tags: ['Posts'], summary: 'List posts' };
  filterFields = ['authorId', 'status'];
  searchFields = ['title', 'content'];
}

class PostRead extends MemoryReadEndpoint<AppEnv, typeof postMeta> {
  _meta = postMeta;
  schema = { tags: ['Posts'], summary: 'Read a post' };
}

class DocumentCreate extends MemoryCreateEndpoint<AppEnv, typeof documentMeta> {
  _meta = documentMeta;
  schema = { tags: ['Documents'], summary: 'Create a versioned document' };

  override async before(data: Document): Promise<Document> {
    return {
      ...data,
      version: data.version ?? 1,
      updatedAt: timestamp(),
    };
  }
}

class DocumentRead extends MemoryReadEndpoint<AppEnv, typeof documentMeta> {
  _meta = documentMeta;
  schema = { tags: ['Documents'], summary: 'Read a document' };
}

class DocumentUpdate extends MemoryUpdateEndpoint<AppEnv, typeof documentMeta> {
  _meta = documentMeta;
  schema = { tags: ['Documents'], summary: 'Update a versioned document' };
  allowedUpdateFields = ['title', 'content'];

  override async before(data: Partial<Document>): Promise<Partial<Document>> {
    return {
      ...data,
      updatedAt: timestamp(),
    };
  }
}

class DocumentVersionHistory extends MemoryVersionHistoryEndpoint<AppEnv, typeof documentMeta> {
  _meta = documentMeta;
}

class DocumentVersionRead extends MemoryVersionReadEndpoint<AppEnv, typeof documentMeta> {
  _meta = documentMeta;
}

class DocumentVersionCompare extends MemoryVersionCompareEndpoint<AppEnv, typeof documentMeta> {
  _meta = documentMeta;
}

class DocumentVersionRollback extends MemoryVersionRollbackEndpoint<AppEnv, typeof documentMeta> {
  _meta = documentMeta;
}

export function createApp() {
  clearStorage();

  const auditStorage = new MemoryAuditLogStorage();
  const cacheStorage = new MemoryCacheStorage();
  const idempotencyStorage = new MemoryIdempotencyStorage();
  const rateLimitStorage = new MemoryRateLimitStorage();
  const versioningStorage = new MemoryVersioningStorage();
  const eventEmitter = new CrudEventEmitter();
  const observedEvents: CrudEventPayload[] = [];

  setAuditStorage(auditStorage);
  setEventEmitter(eventEmitter);
  setIdempotencyStorage(idempotencyStorage);
  setRateLimitStorage(rateLimitStorage);
  setVersioningStorage(versioningStorage);
  eventEmitter.onAny((event) => {
    observedEvents.push(event);
  });

  const hono = new Hono<AppEnv>();
  const app = fromHono(hono);

  app.use('/admin/*', authFromHeaders(), requireRoles<AppEnv>('admin'));
  app.use('/limited/*', createRateLimitMiddleware<AppEnv>({
    limit: 2,
    windowSeconds: 60,
    keyStrategy: 'ip',
    storage: rateLimitStorage,
  }));
  app.use('/idempotent/*', idempotency({ storage: idempotencyStorage }));
  app.use('/tenant/*', multiTenant<AppEnv>({ source: 'header', required: true }));
  app.use('/versioned/*', apiVersion({
    versions: [{ version: '1' }, { version: '2' }],
    defaultVersion: '2',
    strategy: 'header',
  }));

  app.patch('/users/bulk', endpoint(UserBulkPatch));
  app.put('/users', endpoint(UserUpsert));
  app.put('/users/sync', endpoint(UserBatchUpsert));
  app.post('/users/:id/clone', endpoint(UserClone));
  registerCrud(app, '/users', {
    create: UserCreate,
    list: UserList,
    read: UserRead,
    update: UserUpdate,
    delete: UserDelete,
    restore: UserRestore,
    batchCreate: UserBatchCreate,
    batchUpdate: UserBatchUpdate,
    batchDelete: UserBatchDelete,
    batchRestore: UserBatchRestore,
    search: UserSearch,
    aggregate: UserAggregate,
    export: UserExport,
    import: UserImport,
  });

  registerCrud(app, '/posts', {
    create: PostCreate,
    list: PostList,
    read: PostRead,
  });

  registerCrud(app, '/documents', {
    create: DocumentCreate,
    read: DocumentRead,
    update: DocumentUpdate,
  });
  app.get('/documents/:id/versions', endpoint(DocumentVersionHistory));
  app.get('/documents/:id/versions/compare', endpoint(DocumentVersionCompare));
  app.get('/documents/:id/versions/:version', endpoint(DocumentVersionRead));
  app.post('/documents/:id/versions/:version/rollback', endpoint(DocumentVersionRollback));

  app.get('/admin/ping', (c) => c.json({ ok: true, user: c.var.user }));
  app.get('/limited/ping', (c) => c.json({ ok: true }));
  app.post('/idempotent/orders', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    return c.json({ orderId: crypto.randomUUID(), body });
  });
  app.get('/tenant/context', (c) => c.json({ tenantId: c.var.tenantId }));
  app.get('/versioned/ping', (c) => c.json({ version: getApiVersion(c) }));
  app.get('/events', (c) => c.json({ count: observedEvents.length, events: observedEvents }));
  app.get('/audit-logs', async (c) => c.json({ logs: await auditStorage.getAll() }));
  app.get('/cache/:key', async (c) => {
    const key = c.req.param('key');
    const cached = await cacheStorage.get<{ value: string }>(key);
    if (cached) {
      return c.json({ hit: true, value: cached.data.value });
    }
    const value = `generated:${key}`;
    await cacheStorage.set(key, { value }, { tags: ['local-consumer'] });
    return c.json({ hit: false, value });
  });
  app.delete('/cache/tag/:tag', async (c) => {
    const deleted = await cacheStorage.deleteByTag(c.req.param('tag'));
    return c.json({ deleted });
  });
  app.post('/crypto/roundtrip', async (c) => {
    const body = await c.req.json() as { value?: string };
    const encrypted = await encryptValue(body.value ?? 'secret', encryptionKeyProvider);
    const decrypted = await decryptValue(encrypted, encryptionKeyProvider);
    return c.json({ encrypted, decrypted });
  });
  app.post('/serialization/public-user', async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    return c.json(applyProfile(body, publicUserProfile));
  });
  app.post('/seed', (c) => {
    const userStore = getStorage<User>('users');
    const postStore = getStorage<Post>('posts');
    const userId = '00000000-0000-4000-8000-000000000001';
    const postId = '00000000-0000-4000-8000-000000000101';
    userStore.set(userId, {
      id: userId,
      email: 'seed@example.com',
      name: 'Seed User',
      role: 'admin',
      status: 'active',
      age: 42,
      tenantId: 'tenant-a',
      internalNote: 'hidden',
      createdAt: timestamp(),
      updatedAt: timestamp(),
    });
    postStore.set(postId, {
      id: postId,
      authorId: userId,
      title: 'Seed Post',
      content: 'Post created by the local consumer example',
      status: 'published',
      createdAt: timestamp(),
      updatedAt: timestamp(),
    });
    return c.json({ userId, postId });
  });

  createHealthEndpoints(app, {
    path: '/live',
    readyPath: '/ready',
    version: 'local-consumer',
    checks: [
      { name: 'memory-users', check: async () => `${getStorage<User>('users').size} users` },
      { name: 'memory-cache', check: async () => `${cacheStorage.getStats().size} cache entries`, critical: false },
    ],
  });

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      package: 'hono-crud',
      install: 'file:../..',
      features: [
        'crud',
        'list-filter-sort-search-pagination',
        'soft-delete-restore',
        'batch',
        'upsert',
        'clone',
        'bulk-patch',
        'relations',
        'computed-fields',
        'field-selection',
        'aggregate',
        'import-export',
        'auth-guards',
        'cache',
        'rate-limit',
        'idempotency',
        'health',
        'audit',
        'versioning',
        'multi-tenant',
        'serialization',
        'encryption',
        'api-versioning',
        'events',
        'openapi-ui',
      ],
    })
  );

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'hono-crud local file install feature lab',
      version: '1.0.0',
      description: 'Consumer app that imports hono-crud via file:../.. and exposes routes for the public feature families.',
    },
  });

  setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });

  return app;
}
