/**
 * Example: Audit Logging
 *
 * This example demonstrates how to enable and use audit logging
 * to track changes to your data.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  defineModel,
  defineMeta,
  fromHono,
  MemoryAuditLogStorage,
  setAuditStorage,
  getAuditStorage,
  type AuditLogStorage,
  type AuditLogEntry,
} from '../../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
} from '../../src/adapters/memory/index.js';

// ============================================================
// 1. Define your schema
// ============================================================

const UserSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  email: z.email(),
  role: z.enum(['admin', 'user', 'moderator']),
  status: z.enum(['active', 'inactive', 'suspended']),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// ============================================================
// 2. Define model with audit configuration
// ============================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  audit: {
    // Enable audit logging
    enabled: true,

    // Actions to audit (default: all)
    actions: ['create', 'update', 'delete', 'restore'],

    // Track field-level changes on update
    trackChanges: true,

    // Store the current state of the record
    storeRecord: true,

    // Store the previous state before changes
    storePreviousRecord: true,

    // Fields to exclude from audit logs (e.g., timestamps, passwords)
    excludeFields: ['createdAt', 'updatedAt'],

    // Custom function to get user ID from request context
    getUserId: (ctx: unknown) => {
      // In a real app, extract from JWT, session, etc.
      const honoCtx = ctx as { var?: { userId?: string } };
      return honoCtx?.var?.userId;
    },
  },
});

// ============================================================
// 3. Custom Audit Log Storage (optional)
// ============================================================

/**
 * Example: Custom storage that logs to console
 * In production, you'd store to a database like PostgreSQL, MongoDB, etc.
 */
class ConsoleAuditLogStorage implements AuditLogStorage {
  private logs: AuditLogEntry[] = [];

  async store(entry: AuditLogEntry): Promise<void> {
    this.logs.push(entry);

    // Log to console for demo purposes
    console.log('\n=== AUDIT LOG ===');
    console.log(`Action: ${entry.action}`);
    console.log(`Table: ${entry.tableName}`);
    console.log(`Record ID: ${entry.recordId}`);
    console.log(`User ID: ${entry.userId || 'anonymous'}`);
    console.log(`Timestamp: ${entry.timestamp.toISOString()}`);

    if (entry.changes?.length) {
      console.log('Changes:');
      for (const change of entry.changes) {
        console.log(`  - ${change.field}: "${change.oldValue}" -> "${change.newValue}"`);
      }
    }
    console.log('================\n');
  }

  async getByRecordId(
    tableName: string,
    recordId: string | number,
    options?: { limit?: number; offset?: number }
  ): Promise<AuditLogEntry[]> {
    return this.logs.filter(
      (log) => log.tableName === tableName && log.recordId === recordId
    );
  }

  async getAll(options?: {
    tableName?: string;
    action?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogEntry[]> {
    let filtered = [...this.logs];

    if (options?.tableName) {
      filtered = filtered.filter((log) => log.tableName === options.tableName);
    }
    if (options?.action) {
      filtered = filtered.filter((log) => log.action === options.action);
    }
    if (options?.userId) {
      filtered = filtered.filter((log) => log.userId === options.userId);
    }

    const offset = options?.offset || 0;
    const limit = options?.limit || filtered.length;
    return filtered.slice(offset, offset + limit);
  }

  // For demo: get all logs
  getAllLogs(): AuditLogEntry[] {
    return [...this.logs];
  }
}

// ============================================================
// 4. Create endpoints
// ============================================================

class UserCreate extends MemoryCreateEndpoint {
  _meta = defineMeta({ model: UserModel });
}

class UserRead extends MemoryReadEndpoint {
  _meta = defineMeta({ model: UserModel });
}

class UserUpdate extends MemoryUpdateEndpoint {
  _meta = defineMeta({ model: UserModel });
}

class UserDelete extends MemoryDeleteEndpoint {
  _meta = defineMeta({ model: UserModel });
}

class UserList extends MemoryListEndpoint {
  _meta = defineMeta({ model: UserModel });
}

// ============================================================
// 5. Set up the application
// ============================================================

async function main() {
  // Set up custom audit storage
  const auditStorage = new ConsoleAuditLogStorage();
  setAuditStorage(auditStorage);

  // Create Hono app
  const app = new Hono();

  // Middleware to set user ID (simulated authentication)
  app.use('*', async (c, next) => {
    // In a real app, extract from JWT, session, etc.
    c.set('userId', 'user-123');
    await next();
  });

  // Register routes
  app.post('/users', async (c) => {
    const endpoint = new UserCreate();
    return endpoint.handle(c);
  });

  app.get('/users', async (c) => {
    const endpoint = new UserList();
    return endpoint.handle(c);
  });

  app.get('/users/:id', async (c) => {
    const endpoint = new UserRead();
    return endpoint.handle(c);
  });

  app.patch('/users/:id', async (c) => {
    const endpoint = new UserUpdate();
    return endpoint.handle(c);
  });

  app.delete('/users/:id', async (c) => {
    const endpoint = new UserDelete();
    return endpoint.handle(c);
  });

  // Audit log viewer endpoint
  app.get('/audit-logs', async (c) => {
    const logs = auditStorage.getAllLogs();
    return c.json({ success: true, result: logs });
  });

  // ============================================================
  // Demo: Simulate CRUD operations
  // ============================================================

  console.log('=== Audit Logging Demo ===\n');

  // 1. Create a user
  console.log('1. Creating user...');
  let response = await app.request('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'John Doe',
      email: 'john@example.com',
      role: 'user',
      status: 'active',
    }),
  });
  const createResult = await response.json() as { result: { id: string } };
  const userId = createResult.result.id;

  // Wait for fire-and-forget audit
  await new Promise((resolve) => setTimeout(resolve, 100));

  // 2. Update the user
  console.log('2. Updating user role...');
  response = await app.request(`/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'admin',
      status: 'active',
    }),
  });

  // Wait for fire-and-forget audit
  await new Promise((resolve) => setTimeout(resolve, 100));

  // 3. Update again
  console.log('3. Updating user status...');
  response = await app.request(`/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'inactive',
    }),
  });

  // Wait for fire-and-forget audit
  await new Promise((resolve) => setTimeout(resolve, 100));

  // 4. Delete the user
  console.log('4. Deleting user...');
  response = await app.request(`/users/${userId}`, {
    method: 'DELETE',
  });

  // Wait for fire-and-forget audit
  await new Promise((resolve) => setTimeout(resolve, 100));

  // ============================================================
  // View all audit logs
  // ============================================================

  console.log('\n=== All Audit Logs ===');
  response = await app.request('/audit-logs');
  const auditResult = await response.json() as { result: AuditLogEntry[] };

  console.log(`Total audit log entries: ${auditResult.result.length}`);
  console.log('\nAudit log summary:');
  for (const log of auditResult.result) {
    console.log(
      `  - ${log.action.toUpperCase()} on ${log.tableName}#${log.recordId} at ${log.timestamp}`
    );
  }
}

main().catch(console.error);
