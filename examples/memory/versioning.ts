/**
 * Example: Record Versioning
 *
 * This example demonstrates how to enable and use record versioning
 * to track the history of changes to your data.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  defineModel,
  defineMeta,
  fromHono,
  MemoryVersioningStorage,
  setVersioningStorage,
  getVersioningStorage,
  type VersioningStorage,
  type VersionHistoryEntry,
} from '../../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryListEndpoint,
  MemoryVersionHistoryEndpoint,
  MemoryVersionReadEndpoint,
  MemoryVersionCompareEndpoint,
  MemoryVersionRollbackEndpoint,
} from '../../src/adapters/memory/index.js';

// ============================================================
// 1. Define your schema with a version field
// ============================================================

const DocumentSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  content: z.string(),
  author: z.string(),
  version: z.number().default(1), // Version counter
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// ============================================================
// 2. Define model with versioning configuration
// ============================================================

const DocumentModel = defineModel({
  tableName: 'documents',
  schema: DocumentSchema,
  primaryKeys: ['id'],
  versioning: {
    // Enable versioning
    enabled: true,

    // Field that stores the version number (default: 'version')
    field: 'version',

    // Table name for history (default: '{tableName}_history')
    historyTable: 'documents_history',

    // Maximum versions to keep (default: unlimited)
    maxVersions: 50,

    // Track who made each change
    trackChangedBy: true,

    // Fields to exclude from version history
    excludeFields: ['createdAt', 'updatedAt'],

    // Custom function to get user ID from request context
    getUserId: (ctx: unknown) => {
      const honoCtx = ctx as { var?: { userId?: string } };
      return honoCtx?.var?.userId;
    },
  },
});

// ============================================================
// 3. Custom Version History Storage (optional)
// ============================================================

/**
 * Example: Custom storage that logs to console
 * In production, you'd store to a database like PostgreSQL, MongoDB, etc.
 */
class ConsoleVersioningStorage implements VersioningStorage {
  private storage = new Map<string, VersionHistoryEntry[]>();

  private getKey(tableName: string, recordId: string | number): string {
    return `${tableName}:${recordId}`;
  }

  async save(entry: VersionHistoryEntry): Promise<void> {
    console.log('\n=== VERSION SAVED ===');
    console.log(`Record ID: ${entry.recordId}`);
    console.log(`Version: ${entry.version}`);
    console.log(`Changed by: ${entry.changedBy || 'anonymous'}`);
    console.log(`Timestamp: ${entry.createdAt.toISOString()}`);
    console.log('=====================\n');
  }

  async getByRecordId(
    tableName: string,
    recordId: string | number,
    options?: { limit?: number; offset?: number }
  ): Promise<VersionHistoryEntry[]> {
    const key = this.getKey(tableName, recordId);
    const versions = this.storage.get(key) || [];
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    const offset = options?.offset || 0;
    const limit = options?.limit || sorted.length;
    return sorted.slice(offset, offset + limit);
  }

  async getVersion(
    tableName: string,
    recordId: string | number,
    version: number
  ): Promise<VersionHistoryEntry | null> {
    const key = this.getKey(tableName, recordId);
    const versions = this.storage.get(key) || [];
    return versions.find(v => v.version === version) || null;
  }

  async getLatestVersion(
    tableName: string,
    recordId: string | number
  ): Promise<number> {
    const key = this.getKey(tableName, recordId);
    const versions = this.storage.get(key) || [];
    if (versions.length === 0) return 0;
    return Math.max(...versions.map(v => v.version));
  }

  async pruneVersions(
    tableName: string,
    recordId: string | number,
    keepCount: number
  ): Promise<number> {
    const key = this.getKey(tableName, recordId);
    const versions = this.storage.get(key) || [];
    if (versions.length <= keepCount) return 0;
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    const toKeep = sorted.slice(0, keepCount);
    this.storage.set(key, toKeep);
    return sorted.length - toKeep.length;
  }

  async deleteAllVersions(
    tableName: string,
    recordId: string | number
  ): Promise<number> {
    const key = this.getKey(tableName, recordId);
    const versions = this.storage.get(key) || [];
    this.storage.delete(key);
    return versions.length;
  }
}

// ============================================================
// 4. Create endpoints
// ============================================================

class DocumentCreate extends MemoryCreateEndpoint {
  _meta = defineMeta({ model: DocumentModel });
}

class DocumentRead extends MemoryReadEndpoint {
  _meta = defineMeta({ model: DocumentModel });
}

class DocumentUpdate extends MemoryUpdateEndpoint {
  _meta = defineMeta({ model: DocumentModel });
}

class DocumentList extends MemoryListEndpoint {
  _meta = defineMeta({ model: DocumentModel });
}

// Version history endpoints
class DocumentVersionHistory extends MemoryVersionHistoryEndpoint {
  _meta = defineMeta({ model: DocumentModel });
}

class DocumentVersionRead extends MemoryVersionReadEndpoint {
  _meta = defineMeta({ model: DocumentModel });
}

class DocumentVersionCompare extends MemoryVersionCompareEndpoint {
  _meta = defineMeta({ model: DocumentModel });
}

class DocumentVersionRollback extends MemoryVersionRollbackEndpoint {
  _meta = defineMeta({ model: DocumentModel });
}

// ============================================================
// 5. Set up the application
// ============================================================

async function main() {
  // Use the built-in memory storage (or set up custom storage)
  // const customStorage = new ConsoleVersioningStorage();
  // setVersioningStorage(customStorage);

  // Create Hono app
  const app = new Hono();

  // Middleware to set user ID (simulated authentication)
  app.use('*', async (c, next) => {
    c.set('userId', 'user-123');
    await next();
  });

  // Error handler
  app.onError((err, c) => {
    if ('status' in err && typeof err.status === 'number') {
      return c.json({
        success: false,
        error: { message: err.message }
      }, err.status as 400 | 404 | 500);
    }
    return c.json({ success: false, error: { message: err.message } }, 500);
  });

  // Register CRUD routes
  app.post('/documents', async (c) => {
    const endpoint = new DocumentCreate();
    return endpoint.handle(c);
  });

  app.get('/documents', async (c) => {
    const endpoint = new DocumentList();
    return endpoint.handle(c);
  });

  app.get('/documents/:id', async (c) => {
    const endpoint = new DocumentRead();
    return endpoint.handle(c);
  });

  app.patch('/documents/:id', async (c) => {
    const endpoint = new DocumentUpdate();
    return endpoint.handle(c);
  });

  // Version history routes (order matters - more specific first)
  app.get('/documents/:id/versions/compare', async (c) => {
    const endpoint = new DocumentVersionCompare();
    return endpoint.handle(c);
  });

  app.get('/documents/:id/versions', async (c) => {
    const endpoint = new DocumentVersionHistory();
    return endpoint.handle(c);
  });

  app.get('/documents/:id/versions/:version', async (c) => {
    const endpoint = new DocumentVersionRead();
    return endpoint.handle(c);
  });

  app.post('/documents/:id/versions/:version/rollback', async (c) => {
    const endpoint = new DocumentVersionRollback();
    return endpoint.handle(c);
  });

  // ============================================================
  // Demo: Simulate CRUD operations with versioning
  // ============================================================

  console.log('=== Record Versioning Demo ===\n');

  // 1. Create a document
  console.log('1. Creating document...');
  let response = await app.request('/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'My First Document',
      content: 'This is the initial content.',
      author: 'Alice',
    }),
  });
  const createResult = await response.json() as { result: { id: string; version: number } };
  const docId = createResult.result.id;
  console.log(`  Created document ${docId} (v${createResult.result.version})\n`);

  // 2. Update the document (creates v2)
  console.log('2. Updating document (change title)...');
  response = await app.request(`/documents/${docId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'My Updated Document',
    }),
  });
  const update1Result = await response.json() as { result: { version: number } };
  console.log(`  Updated to v${update1Result.result.version}\n`);

  // 3. Update again (creates v3)
  console.log('3. Updating document (change content)...');
  response = await app.request(`/documents/${docId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: 'This is the updated content with more details.',
    }),
  });
  const update2Result = await response.json() as { result: { version: number } };
  console.log(`  Updated to v${update2Result.result.version}\n`);

  // 4. View version history
  console.log('4. Viewing version history...');
  response = await app.request(`/documents/${docId}/versions`);
  const historyResult = await response.json() as { result: { versions: VersionHistoryEntry[]; totalVersions: number } };
  console.log(`  Total versions: ${historyResult.result.totalVersions}`);
  console.log('  History:');
  for (const v of historyResult.result.versions) {
    console.log(`    - v${v.version}: "${v.data.title}"`);
  }
  console.log();

  // 5. Get a specific version
  console.log('5. Getting version 1...');
  response = await app.request(`/documents/${docId}/versions/1`);
  const v1Result = await response.json() as { result: VersionHistoryEntry };
  console.log(`  Version 1 title: "${v1Result.result.data.title}"`);
  console.log(`  Version 1 content: "${v1Result.result.data.content}"\n`);

  // 6. Compare versions
  console.log('6. Comparing v1 and v2...');
  response = await app.request(`/documents/${docId}/versions/compare?from=1&to=2`);
  const compareResult = await response.json() as { result: { changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> } };
  console.log('  Changes:');
  for (const change of compareResult.result.changes) {
    console.log(`    - ${change.field}: "${change.oldValue}" -> "${change.newValue}"`);
  }
  console.log();

  // 7. Rollback to version 1
  console.log('7. Rolling back to version 1...');
  response = await app.request(`/documents/${docId}/versions/1/rollback`, {
    method: 'POST',
  });
  const rollbackResult = await response.json() as { result: { title: string; version: number } };
  console.log(`  Rolled back to: "${rollbackResult.result.title}" (now v${rollbackResult.result.version})\n`);

  // 8. Verify current state
  console.log('8. Current document state:');
  response = await app.request(`/documents/${docId}`);
  const finalResult = await response.json() as { result: { title: string; content: string; version: number } };
  console.log(`  Title: "${finalResult.result.title}"`);
  console.log(`  Content: "${finalResult.result.content}"`);
  console.log(`  Version: ${finalResult.result.version}\n`);

  console.log('=== Demo Complete ===');
}

main().catch(console.error);
