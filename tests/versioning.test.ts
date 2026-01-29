/**
 * Tests for record versioning functionality.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { Hono } from 'hono';
import {
  defineModel,
  VersionManager,
  MemoryVersioningStorage,
  createVersionManager,
  setVersioningStorage,
  getVersioningStorage,
  getVersioningConfig,
} from '../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryUpdateEndpoint,
  MemoryVersionHistoryEndpoint,
  MemoryVersionReadEndpoint,
  MemoryVersionCompareEndpoint,
  MemoryVersionRollbackEndpoint,
  clearStorage,
  getStorage,
} from '../src/adapters/memory/index.js';

// Define test schema with versioning
const DocumentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  content: z.string(),
  version: z.number().default(1),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// Define model with versioning enabled
const DocumentModel = defineModel({
  tableName: 'documents',
  schema: DocumentSchema,
  primaryKeys: ['id'],
  versioning: {
    enabled: true,
    field: 'version',
    maxVersions: 10,
    trackChangedBy: true,
    excludeFields: ['updatedAt'],
  },
});

// Define model without versioning
const NonVersionedModel = defineModel({
  tableName: 'non_versioned',
  schema: DocumentSchema,
  primaryKeys: ['id'],
});

// Test endpoints
class DocumentCreate extends MemoryCreateEndpoint {
  _meta = { model: DocumentModel };
}

class DocumentUpdate extends MemoryUpdateEndpoint {
  _meta = { model: DocumentModel };
}

class DocumentVersionHistory extends MemoryVersionHistoryEndpoint {
  _meta = { model: DocumentModel };
}

class DocumentVersionRead extends MemoryVersionReadEndpoint {
  _meta = { model: DocumentModel };
}

class DocumentVersionCompare extends MemoryVersionCompareEndpoint {
  _meta = { model: DocumentModel };
}

class DocumentVersionRollback extends MemoryVersionRollbackEndpoint {
  _meta = { model: DocumentModel };
}

describe('Record Versioning', () => {
  let versioningStorage: MemoryVersioningStorage;

  beforeEach(() => {
    clearStorage();
    versioningStorage = new MemoryVersioningStorage();
    setVersioningStorage(versioningStorage);
  });

  describe('getVersioningConfig', () => {
    it('should return disabled config for undefined', () => {
      const config = getVersioningConfig(undefined, 'test');
      expect(config.enabled).toBe(false);
      expect(config.field).toBe('version');
      expect(config.historyTable).toBe('test_history');
    });

    it('should normalize config with defaults', () => {
      const config = getVersioningConfig(
        { enabled: true },
        'documents'
      );
      expect(config.enabled).toBe(true);
      expect(config.field).toBe('version');
      expect(config.historyTable).toBe('documents_history');
      expect(config.maxVersions).toBeNull();
      expect(config.trackChangedBy).toBe(false);
      expect(config.excludeFields).toEqual([]);
    });

    it('should use provided values', () => {
      const config = getVersioningConfig(
        {
          enabled: true,
          field: 'rev',
          historyTable: 'doc_versions',
          maxVersions: 50,
          trackChangedBy: true,
          excludeFields: ['password'],
        },
        'documents'
      );
      expect(config.field).toBe('rev');
      expect(config.historyTable).toBe('doc_versions');
      expect(config.maxVersions).toBe(50);
      expect(config.trackChangedBy).toBe(true);
      expect(config.excludeFields).toEqual(['password']);
    });
  });

  describe('VersionManager', () => {
    it('should create version manager with config', () => {
      const manager = createVersionManager(DocumentModel.versioning, 'documents');
      expect(manager).toBeInstanceOf(VersionManager);
      expect(manager.isEnabled()).toBe(true);
    });

    it('should return disabled for undefined config', () => {
      const manager = createVersionManager(undefined, 'test');
      expect(manager.isEnabled()).toBe(false);
    });

    it('should save version and return new version number', async () => {
      const manager = createVersionManager(DocumentModel.versioning, 'documents', versioningStorage);

      const newVersion = await manager.saveVersion(
        'doc-123',
        { id: 'doc-123', title: 'Test', content: 'Hello', version: 1 },
        undefined,
        'user-1'
      );

      expect(newVersion).toBe(2);

      const versions = await manager.getVersions('doc-123');
      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe(1);
      expect(versions[0].changedBy).toBe('user-1');
    });

    it('should track multiple versions', async () => {
      const manager = createVersionManager(DocumentModel.versioning, 'documents', versioningStorage);

      // Save version 1
      await manager.saveVersion(
        'doc-123',
        { id: 'doc-123', title: 'Version 1', content: 'First', version: 1 }
      );

      // Save version 2
      await manager.saveVersion(
        'doc-123',
        { id: 'doc-123', title: 'Version 2', content: 'Second', version: 2 }
      );

      // Save version 3
      await manager.saveVersion(
        'doc-123',
        { id: 'doc-123', title: 'Version 3', content: 'Third', version: 3 }
      );

      const versions = await manager.getVersions('doc-123');
      expect(versions).toHaveLength(3);
      // Should be in descending order (newest first)
      expect(versions[0].version).toBe(3);
      expect(versions[1].version).toBe(2);
      expect(versions[2].version).toBe(1);
    });

    it('should get specific version', async () => {
      const manager = createVersionManager(DocumentModel.versioning, 'documents', versioningStorage);

      await manager.saveVersion(
        'doc-123',
        { id: 'doc-123', title: 'Version 1', content: 'First', version: 1 }
      );
      await manager.saveVersion(
        'doc-123',
        { id: 'doc-123', title: 'Version 2', content: 'Second', version: 2 }
      );

      const version1 = await manager.getVersion('doc-123', 1);
      expect(version1).not.toBeNull();
      expect(version1!.data.title).toBe('Version 1');

      const version2 = await manager.getVersion('doc-123', 2);
      expect(version2).not.toBeNull();
      expect(version2!.data.title).toBe('Version 2');
    });

    it('should compare versions', async () => {
      const manager = createVersionManager(DocumentModel.versioning, 'documents', versioningStorage);

      await manager.saveVersion(
        'doc-123',
        { id: 'doc-123', title: 'Original Title', content: 'Original', version: 1 }
      );
      await manager.saveVersion(
        'doc-123',
        { id: 'doc-123', title: 'Changed Title', content: 'Original', version: 2 }
      );

      const changes = await manager.compareVersions('doc-123', 1, 2);
      expect(changes).toHaveLength(2); // title and version changed
      expect(changes.some(c => c.field === 'title' && c.oldValue === 'Original Title' && c.newValue === 'Changed Title')).toBe(true);
    });

    it('should get latest version number', async () => {
      const manager = createVersionManager(DocumentModel.versioning, 'documents', versioningStorage);

      expect(await manager.getLatestVersion('doc-123')).toBe(0);

      await manager.saveVersion(
        'doc-123',
        { id: 'doc-123', title: 'V1', version: 1 }
      );
      expect(await manager.getLatestVersion('doc-123')).toBe(1);

      await manager.saveVersion(
        'doc-123',
        { id: 'doc-123', title: 'V2', version: 2 }
      );
      expect(await manager.getLatestVersion('doc-123')).toBe(2);
    });

    it('should exclude fields from version history', async () => {
      const manager = createVersionManager(DocumentModel.versioning, 'documents', versioningStorage);

      await manager.saveVersion(
        'doc-123',
        { id: 'doc-123', title: 'Test', content: 'Hello', version: 1, updatedAt: new Date() }
      );

      const versions = await manager.getVersions('doc-123');
      expect(versions[0].data).not.toHaveProperty('updatedAt');
      expect(versions[0].data).toHaveProperty('title');
    });
  });

  describe('MemoryVersioningStorage', () => {
    it('should store and retrieve versions', async () => {
      await versioningStorage.store('documents', {
        id: 'entry-1',
        recordId: 'doc-123',
        version: 1,
        data: { title: 'Test' },
        createdAt: new Date(),
      });

      const versions = await versioningStorage.getByRecordId('documents', 'doc-123');
      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe(1);
    });

    it('should prune old versions', async () => {
      // Add 5 versions
      for (let i = 1; i <= 5; i++) {
        await versioningStorage.store('documents', {
          id: `entry-${i}`,
          recordId: 'doc-123',
          version: i,
          data: { title: `Version ${i}` },
          createdAt: new Date(),
        });
      }

      // Prune to keep only 3
      const deleted = await versioningStorage.pruneVersions('documents', 'doc-123', 3);
      expect(deleted).toBe(2);

      const remaining = await versioningStorage.getByRecordId('documents', 'doc-123');
      expect(remaining).toHaveLength(3);
      // Should keep the newest (3, 4, 5)
      expect(remaining.map(v => v.version).sort()).toEqual([3, 4, 5]);
    });

    it('should delete all versions', async () => {
      for (let i = 1; i <= 3; i++) {
        await versioningStorage.store('documents', {
          id: `entry-${i}`,
          recordId: 'doc-123',
          version: i,
          data: { title: `Version ${i}` },
          createdAt: new Date(),
        });
      }

      const deleted = await versioningStorage.deleteAllVersions('documents', 'doc-123');
      expect(deleted).toBe(3);

      const remaining = await versioningStorage.getByRecordId('documents', 'doc-123');
      expect(remaining).toHaveLength(0);
    });

    it('should support pagination', async () => {
      for (let i = 1; i <= 10; i++) {
        await versioningStorage.store('documents', {
          id: `entry-${i}`,
          recordId: 'doc-123',
          version: i,
          data: { title: `Version ${i}` },
          createdAt: new Date(),
        });
      }

      const page1 = await versioningStorage.getByRecordId('documents', 'doc-123', { limit: 3, offset: 0 });
      expect(page1).toHaveLength(3);
      // Newest first (10, 9, 8)
      expect(page1[0].version).toBe(10);

      const page2 = await versioningStorage.getByRecordId('documents', 'doc-123', { limit: 3, offset: 3 });
      expect(page2).toHaveLength(3);
      expect(page2[0].version).toBe(7);
    });
  });

  describe('UpdateEndpoint with Versioning', () => {
    it('should save version before update', async () => {
      // First create a document
      const store = getStorage<Record<string, unknown>>('documents');
      const docId = crypto.randomUUID();
      store.set(docId, {
        id: docId,
        title: 'Original Title',
        content: 'Original Content',
        version: 1,
      });

      const app = new Hono();
      app.patch('/documents/:id', async (c) => {
        const endpoint = new DocumentUpdate();
        endpoint.setContext(c);
        return endpoint.handle();
      });

      // Update the document
      const response = await app.request(`/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Updated Title',
        }),
      });

      expect(response.status).toBe(200);

      const result = await response.json() as { result: { version: number } };
      expect(result.result.version).toBe(2); // Version incremented

      // Wait for fire-and-forget version save
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check version history was saved
      const versions = await versioningStorage.getByRecordId('documents', docId);
      expect(versions.length).toBeGreaterThanOrEqual(1);
      // The saved version should be the state BEFORE the update
      expect(versions[0].data.title).toBe('Original Title');
    });
  });

  describe('Version History Endpoints', () => {
    let docId: string;
    let app: Hono;

    beforeEach(async () => {
      // Create a document
      docId = crypto.randomUUID();
      const store = getStorage<Record<string, unknown>>('documents');
      store.set(docId, {
        id: docId,
        title: 'Current Title',
        content: 'Current Content',
        version: 3,
      });

      // Add some version history
      for (let i = 1; i <= 3; i++) {
        await versioningStorage.store('documents', {
          id: `entry-${i}`,
          recordId: docId,
          version: i,
          data: { id: docId, title: `Title v${i}`, content: `Content v${i}`, version: i },
          createdAt: new Date(Date.now() - (3 - i) * 1000),
        });
      }

      app = new Hono();

      // Error handler to convert exceptions to proper responses
      app.onError((err, c) => {
        if ('status' in err && typeof err.status === 'number') {
          return c.json({
            success: false,
            error: { code: (err as { code?: string }).code || 'ERROR', message: err.message }
          }, err.status as 400 | 404 | 500);
        }
        return c.json({ success: false, error: { code: 'ERROR', message: err.message } }, 500);
      });

      // Order matters: more specific routes first
      app.get('/documents/:id/versions/compare', async (c) => {
        const endpoint = new DocumentVersionCompare();
        endpoint.setContext(c);
        return endpoint.handle();
      });
      app.get('/documents/:id/versions', async (c) => {
        const endpoint = new DocumentVersionHistory();
        endpoint.setContext(c);
        return endpoint.handle();
      });
      app.get('/documents/:id/versions/:version', async (c) => {
        const endpoint = new DocumentVersionRead();
        endpoint.setContext(c);
        return endpoint.handle();
      });
      app.post('/documents/:id/versions/:version/rollback', async (c) => {
        const endpoint = new DocumentVersionRollback();
        endpoint.setContext(c);
        return endpoint.handle();
      });
    });

    it('should list version history', async () => {
      const response = await app.request(`/documents/${docId}/versions`);

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { versions: unknown[], totalVersions: number } };
      expect(result.result.versions).toHaveLength(3);
      expect(result.result.totalVersions).toBe(3);
    });

    it('should get specific version', async () => {
      const response = await app.request(`/documents/${docId}/versions/2`);

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { version: number, data: { title: string } } };
      expect(result.result.version).toBe(2);
      expect(result.result.data.title).toBe('Title v2');
    });

    it('should return 404 for non-existent version', async () => {
      const response = await app.request(`/documents/${docId}/versions/99`);
      expect(response.status).toBe(404);
    });

    it('should compare versions', async () => {
      const response = await app.request(`/documents/${docId}/versions/compare?from=1&to=2`);

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { from: number, to: number, changes: unknown[] } };
      expect(result.result.from).toBe(1);
      expect(result.result.to).toBe(2);
      expect(result.result.changes.length).toBeGreaterThan(0);
    });

    it('should rollback to previous version', async () => {
      const response = await app.request(`/documents/${docId}/versions/1/rollback`, {
        method: 'POST',
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { title: string, version: number } };
      expect(result.result.title).toBe('Title v1');
      expect(result.result.version).toBe(4); // Incremented to 4 after rollback

      // Verify the document was updated
      const store = getStorage<Record<string, unknown>>('documents');
      const doc = store.get(docId);
      expect(doc?.title).toBe('Title v1');
      expect(doc?.version).toBe(4);
    });
  });
});
