/**
 * Tests for Multi-Tenancy functionality.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { fromHono, defineModel, defineMeta, multiTenant } from '../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  clearStorage,
  getStorage,
} from '../src/adapters/memory/index.js';

// ============================================================================
// Schema Definitions
// ============================================================================

const DocumentSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  title: z.string(),
  content: z.string().optional(),
  createdAt: z.string().optional(),
});

type Document = z.infer<typeof DocumentSchema>;

// ============================================================================
// Model with Multi-Tenancy
// ============================================================================

const DocumentModel = defineModel({
  tableName: 'documents',
  schema: DocumentSchema,
  primaryKeys: ['id'],
  multiTenant: {
    field: 'tenantId',
    source: 'context',
    contextKey: 'tenantId',
  },
});

const documentMeta = defineMeta({ model: DocumentModel });

// ============================================================================
// Endpoint Classes
// ============================================================================

class DocumentCreate extends MemoryCreateEndpoint {
  _meta = documentMeta;
}

class DocumentList extends MemoryListEndpoint {
  _meta = documentMeta;
  searchFields = ['title'];
}

class DocumentRead extends MemoryReadEndpoint {
  _meta = documentMeta;
}

class DocumentUpdate extends MemoryUpdateEndpoint {
  _meta = documentMeta;
}

class DocumentDelete extends MemoryDeleteEndpoint {
  _meta = documentMeta;
}

// ============================================================================
// Tests
// ============================================================================

describe('Multi-Tenancy', () => {
  let app: ReturnType<typeof fromHono>;
  let documentStore: Map<string, Document>;

  const TENANT_A = 'tenant-a-uuid-1234';
  const TENANT_B = 'tenant-b-uuid-5678';

  beforeEach(() => {
    clearStorage();
    documentStore = getStorage<Document>('documents');

    // Use OpenAPIHono directly for proper middleware support
    const honoApp = new OpenAPIHono();

    // Apply multi-tenant middleware
    honoApp.use('/*', multiTenant({ contextKey: 'tenantId' }));

    app = fromHono(honoApp);
    app.post('/documents', DocumentCreate);
    app.get('/documents', DocumentList);
    app.get('/documents/:id', DocumentRead);
    app.patch('/documents/:id', DocumentUpdate);
    app.delete('/documents/:id', DocumentDelete);
  });

  describe('tenant isolation', () => {
    it('should inject tenant ID on create', async () => {
      const response = await app.request('/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_A,
        },
        body: JSON.stringify({
          title: 'Tenant A Document',
          content: 'Content for Tenant A',
        }),
      });

      expect(response.status).toBe(201);
      const result = await response.json() as { result: Document };
      expect(result.result.tenantId).toBe(TENANT_A);
      expect(result.result.title).toBe('Tenant A Document');
    });

    it('should filter list by tenant ID', async () => {
      // Create documents for both tenants
      await app.request('/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_A,
        },
        body: JSON.stringify({ title: 'Doc A1' }),
      });

      await app.request('/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_A,
        },
        body: JSON.stringify({ title: 'Doc A2' }),
      });

      await app.request('/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_B,
        },
        body: JSON.stringify({ title: 'Doc B1' }),
      });

      // List documents for Tenant A
      const responseA = await app.request('/documents', {
        method: 'GET',
        headers: { 'X-Tenant-ID': TENANT_A },
      });

      expect(responseA.status).toBe(200);
      const resultA = await responseA.json() as { result: Document[] };
      expect(resultA.result).toHaveLength(2);
      expect(resultA.result.every((d) => d.tenantId === TENANT_A)).toBe(true);

      // List documents for Tenant B
      const responseB = await app.request('/documents', {
        method: 'GET',
        headers: { 'X-Tenant-ID': TENANT_B },
      });

      expect(responseB.status).toBe(200);
      const resultB = await responseB.json() as { result: Document[] };
      expect(resultB.result).toHaveLength(1);
      expect(resultB.result[0].tenantId).toBe(TENANT_B);
    });

    it('should prevent reading documents from other tenants', async () => {
      // Create document for Tenant A
      const createRes = await app.request('/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_A,
        },
        body: JSON.stringify({ title: 'Secret Doc' }),
      });

      const created = (await createRes.json() as { result: Document }).result;

      // Try to read with Tenant B
      const response = await app.request(`/documents/${created.id}`, {
        method: 'GET',
        headers: { 'X-Tenant-ID': TENANT_B },
      });

      expect(response.status).toBe(404);
    });

    it('should prevent updating documents from other tenants', async () => {
      // Create document for Tenant A
      const createRes = await app.request('/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_A,
        },
        body: JSON.stringify({ title: 'Original Title' }),
      });

      const created = (await createRes.json() as { result: Document }).result;

      // Try to update with Tenant B
      const response = await app.request(`/documents/${created.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_B,
        },
        body: JSON.stringify({ title: 'Hacked Title' }),
      });

      expect(response.status).toBe(404);

      // Verify document wasn't changed
      const doc = documentStore.get(created.id);
      expect(doc?.title).toBe('Original Title');
    });

    it('should prevent deleting documents from other tenants', async () => {
      // Create document for Tenant A
      const createRes = await app.request('/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_A,
        },
        body: JSON.stringify({ title: 'Protected Doc' }),
      });

      const created = (await createRes.json() as { result: Document }).result;

      // Try to delete with Tenant B
      const response = await app.request(`/documents/${created.id}`, {
        method: 'DELETE',
        headers: { 'X-Tenant-ID': TENANT_B },
      });

      expect(response.status).toBe(404);

      // Verify document still exists
      expect(documentStore.has(created.id)).toBe(true);
    });
  });

  describe('tenant validation', () => {
    it('should reject requests without tenant ID when required', async () => {
      const response = await app.request('/documents', {
        method: 'GET',
        // No X-Tenant-ID header
      });

      expect(response.status).toBe(400);
    });

    it('should allow same tenant to update their own documents', async () => {
      // Create document
      const createRes = await app.request('/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_A,
        },
        body: JSON.stringify({ title: 'My Doc' }),
      });

      const created = (await createRes.json() as { result: Document }).result;

      // Update with same tenant
      const response = await app.request(`/documents/${created.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_A,
        },
        body: JSON.stringify({ title: 'Updated Title' }),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { result: Document };
      expect(result.result.title).toBe('Updated Title');
      expect(result.result.tenantId).toBe(TENANT_A);
    });
  });
});
