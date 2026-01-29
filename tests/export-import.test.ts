import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, registerCrud } from '../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryListEndpoint,
  MemoryExportEndpoint,
  MemoryImportEndpoint,
  clearStorage,
} from '../src/adapters/memory/index.js';
import {
  generateCsv,
  parseCsv,
  escapeCsvValue,
  createCsvStream,
  validateCsvHeaders,
  csvToJson,
  jsonToCsv,
} from '../src/utils/csv.js';
import type { MetaInput, Model } from '../src/index.js';

// Define test schema
const UserSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  email: z.email(),
  role: z.enum(['admin', 'user', 'moderator']),
  age: z.number().optional(),
  active: z.boolean().default(true),
});

type User = z.infer<typeof UserSchema>;

const UserModel: Model<typeof UserSchema> = {
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
};

type UserMeta = MetaInput<typeof UserSchema>;
const userMeta: UserMeta = { model: UserModel };

// Create endpoint classes
class UserCreate extends MemoryCreateEndpoint<any, UserMeta> {
  _meta = userMeta;
}

class UserList extends MemoryListEndpoint<any, UserMeta> {
  _meta = userMeta;
  filterFields = ['role', 'active'];
  searchFields = ['name', 'email'];
}

class UserExport extends MemoryExportEndpoint<any, UserMeta> {
  _meta = userMeta;
  filterFields = ['role', 'active'];
  searchFields = ['name', 'email'];
  protected excludedExportFields = ['age']; // Exclude age from exports
}

class UserImport extends MemoryImportEndpoint<any, UserMeta> {
  _meta = userMeta;
  protected upsertKeys = ['email']; // Match by email for upsert
  protected immutableFields = ['id']; // Don't allow changing id on upsert
  protected optionalImportFields = ['id', 'age', 'active']; // These are optional on import
}

// ============================================================================
// CSV Utilities Tests
// ============================================================================

describe('CSV Utilities', () => {
  describe('escapeCsvValue', () => {
    it('should return simple values unchanged', () => {
      expect(escapeCsvValue('hello')).toBe('hello');
      expect(escapeCsvValue(123)).toBe('123');
      expect(escapeCsvValue(true)).toBe('true');
    });

    it('should handle null and undefined', () => {
      expect(escapeCsvValue(null)).toBe('');
      expect(escapeCsvValue(undefined)).toBe('');
      expect(escapeCsvValue(null, { nullValue: 'NULL' })).toBe('NULL');
    });

    it('should quote values containing commas', () => {
      expect(escapeCsvValue('hello, world')).toBe('"hello, world"');
    });

    it('should quote values containing quotes and escape them', () => {
      expect(escapeCsvValue('say "hello"')).toBe('"say ""hello"""');
    });

    it('should quote values containing newlines', () => {
      expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
    });

    it('should format dates in ISO format by default', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      expect(escapeCsvValue(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should format dates as timestamp when specified', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      expect(escapeCsvValue(date, { dateFormat: 'timestamp' })).toBe(String(date.getTime()));
    });

    it('should serialize objects as JSON', () => {
      expect(escapeCsvValue({ foo: 'bar' })).toBe('"{""foo"":""bar""}"');
    });

    it('should serialize arrays as JSON', () => {
      expect(escapeCsvValue([1, 2, 3])).toBe('"[1,2,3]"');
    });
  });

  describe('generateCsv', () => {
    it('should generate CSV from records', () => {
      const records = [
        { id: '1', name: 'Alice', email: 'alice@example.com' },
        { id: '2', name: 'Bob', email: 'bob@example.com' },
      ];
      const csv = generateCsv(records);
      expect(csv).toBe('id,name,email\r\n1,Alice,alice@example.com\r\n2,Bob,bob@example.com');
    });

    it('should handle empty records array', () => {
      expect(generateCsv([])).toBe('');
    });

    it('should use custom headers', () => {
      const records = [{ id: '1', name: 'Alice', email: 'alice@example.com' }];
      const csv = generateCsv(records, { headers: ['name', 'email'] });
      expect(csv).toBe('name,email\r\nAlice,alice@example.com');
    });

    it('should use header labels', () => {
      const records = [{ id: '1', name: 'Alice' }];
      const csv = generateCsv(records, { headerLabels: { id: 'ID', name: 'Full Name' } });
      expect(csv).toBe('ID,Full Name\r\n1,Alice');
    });

    it('should exclude specified fields', () => {
      const records = [{ id: '1', name: 'Alice', password: 'secret' }];
      const csv = generateCsv(records, { excludeFields: ['password'] });
      expect(csv).toBe('id,name\r\n1,Alice');
    });

    it('should skip header when includeHeader is false', () => {
      const records = [{ id: '1', name: 'Alice' }];
      const csv = generateCsv(records, { includeHeader: false });
      expect(csv).toBe('1,Alice');
    });

    it('should use custom delimiter', () => {
      const records = [{ id: '1', name: 'Alice' }];
      const csv = generateCsv(records, { delimiter: ';' });
      expect(csv).toBe('id;name\r\n1;Alice');
    });

    it('should apply custom formatters', () => {
      const records = [{ id: '1', active: true }];
      const csv = generateCsv(records, {
        formatters: { active: (v) => (v ? 'Yes' : 'No') },
      });
      expect(csv).toBe('id,active\r\n1,Yes');
    });
  });

  describe('createCsvStream', () => {
    it('should create a readable stream', async () => {
      const records = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ];
      const stream = createCsvStream(records);
      expect(stream).toBeInstanceOf(ReadableStream);

      // Read the stream
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let result = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value);
      }
      expect(result).toContain('id,name');
      expect(result).toContain('Alice');
      expect(result).toContain('Bob');
    });
  });

  describe('parseCsv', () => {
    it('should parse simple CSV', () => {
      const csv = 'id,name,email\n1,Alice,alice@example.com\n2,Bob,bob@example.com';
      const result = parseCsv(csv);

      expect(result.headers).toEqual(['id', 'name', 'email']);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' });
      expect(result.data[1]).toEqual({ id: '2', name: 'Bob', email: 'bob@example.com' });
      expect(result.errors).toHaveLength(0);
    });

    it('should handle quoted values', () => {
      const csv = 'name,description\nAlice,"Hello, World"\nBob,"Say ""Hi"""';
      const result = parseCsv(csv);

      expect(result.data[0].description).toBe('Hello, World');
      expect(result.data[1].description).toBe('Say "Hi"');
    });

    it('should handle newlines in quoted values', () => {
      const csv = 'name,bio\nAlice,"Line1\nLine2"';
      const result = parseCsv(csv);

      expect(result.data[0].bio).toBe('Line1\nLine2');
    });

    it('should handle CRLF line endings', () => {
      const csv = 'id,name\r\n1,Alice\r\n2,Bob';
      const result = parseCsv(csv);

      expect(result.data).toHaveLength(2);
    });

    it('should skip empty rows', () => {
      const csv = 'id,name\n1,Alice\n\n2,Bob\n';
      const result = parseCsv(csv);

      expect(result.data).toHaveLength(2);
    });

    it('should trim values by default', () => {
      const csv = 'id,name\n 1 , Alice ';
      const result = parseCsv(csv);

      expect(result.data[0]).toEqual({ id: '1', name: 'Alice' });
    });

    it('should use custom headers', () => {
      const csv = 'id,name\n1,Alice';
      const result = parseCsv(csv, { headers: ['userId', 'userName'] });

      expect(result.data[0]).toEqual({ userId: '1', userName: 'Alice' });
    });

    it('should apply custom parsers', () => {
      const csv = 'id,age,active\n1,25,true';
      const result = parseCsv(csv, {
        parsers: {
          age: (v) => parseInt(v, 10),
          active: (v) => v === 'true',
        },
      });

      expect(result.data[0]).toEqual({ id: '1', age: 25, active: true });
    });

    it('should handle empty value options', () => {
      const csv = 'id,name\n1,';
      const result = parseCsv(csv, { emptyValue: 'null' });

      expect(result.data[0].name).toBeNull();
    });
  });

  describe('validateCsvHeaders', () => {
    const TestSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      age: z.number().optional(),
    });

    it('should validate when all required fields present', () => {
      const result = validateCsvHeaders(['id', 'name', 'email'], TestSchema);

      expect(result.valid).toBe(true);
      expect(result.missingFields).toEqual([]);
      expect(result.unknownFields).toEqual([]);
      expect(result.validFields).toEqual(['id', 'name', 'email']);
    });

    it('should report missing required fields', () => {
      const result = validateCsvHeaders(['name'], TestSchema);

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('id');
      expect(result.missingFields).toContain('email');
    });

    it('should report unknown fields', () => {
      const result = validateCsvHeaders(['id', 'name', 'email', 'unknown'], TestSchema);

      expect(result.valid).toBe(false);
      expect(result.unknownFields).toEqual(['unknown']);
    });

    it('should allow unknown fields when configured', () => {
      const result = validateCsvHeaders(['id', 'name', 'email', 'unknown'], TestSchema, {
        allowUnknownFields: true,
      });

      expect(result.valid).toBe(true);
      expect(result.unknownFields).toEqual(['unknown']);
    });

    it('should treat optional fields as not required', () => {
      const result = validateCsvHeaders(['id', 'name', 'email'], TestSchema);

      expect(result.valid).toBe(true);
      expect(result.missingFields).not.toContain('age');
    });
  });

  describe('csvToJson / jsonToCsv', () => {
    it('should convert CSV to JSON', () => {
      const csv = 'id,name\n1,Alice\n2,Bob';
      const json = csvToJson(csv);

      expect(json).toHaveLength(2);
      expect(json[0]).toEqual({ id: '1', name: 'Alice' });
    });

    it('should convert JSON to CSV', () => {
      const json = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ];
      const csv = jsonToCsv(json);

      expect(csv).toContain('id,name');
      expect(csv).toContain('1,Alice');
      expect(csv).toContain('2,Bob');
    });
  });
});

// ============================================================================
// Export Endpoint Tests
// ============================================================================

describe('Export Endpoint', () => {
  let app: ReturnType<typeof fromHono>;

  beforeEach(async () => {
    clearStorage();
    app = fromHono(new Hono());
    registerCrud(app, '/users', {
      create: UserCreate as any,
      list: UserList as any,
      export: UserExport as any,
      import: UserImport as any,
    });

    // Seed test data
    for (const user of [
      { name: 'Alice', email: 'alice@example.com', role: 'admin', age: 30 },
      { name: 'Bob', email: 'bob@example.com', role: 'user', age: 25 },
      { name: 'Charlie', email: 'charlie@example.com', role: 'user', age: 35 },
      { name: 'Diana', email: 'diana@example.com', role: 'moderator', age: 28 },
    ]) {
      await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });
    }
  });

  describe('JSON Export', () => {
    it('should export all records as JSON by default', async () => {
      const res = await app.request('/users/export');

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('application/json');

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.result.format).toBe('json');
      expect(data.result.data).toHaveLength(4);
      expect(data.result.count).toBe(4);
      expect(data.result.exportedAt).toBeDefined();
    });

    it('should export with format=json parameter', async () => {
      const res = await app.request('/users/export?format=json');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.format).toBe('json');
    });

    it('should apply filters to export', async () => {
      const res = await app.request('/users/export?role=admin');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.data).toHaveLength(1);
      expect(data.result.data[0].name).toBe('Alice');
    });

    it('should exclude configured fields from export', async () => {
      const res = await app.request('/users/export');

      expect(res.status).toBe(200);
      const data = await res.json();

      // 'age' should be excluded based on excludedExportFields
      for (const record of data.result.data) {
        expect(record).not.toHaveProperty('age');
      }
    });
  });

  describe('CSV Export', () => {
    it('should export as CSV', async () => {
      const res = await app.request('/users/export?format=csv');

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/csv');

      const csv = await res.text();
      // Check that all headers are present (order may vary)
      const headers = csv.split('\r\n')[0].split(',');
      expect(headers).toContain('id');
      expect(headers).toContain('name');
      expect(headers).toContain('email');
      expect(headers).toContain('role');
      expect(headers).toContain('active');
      expect(csv).toContain('Alice');
      expect(csv).toContain('alice@example.com');
    });

    it('should include Content-Disposition header', async () => {
      const res = await app.request('/users/export?format=csv');

      expect(res.headers.get('Content-Disposition')).toContain('attachment');
      expect(res.headers.get('Content-Disposition')).toContain('.csv');
    });

    it('should apply filters to CSV export', async () => {
      const res = await app.request('/users/export?format=csv&role=user');

      expect(res.status).toBe(200);
      const csv = await res.text();

      // Should only contain Bob and Charlie (users)
      expect(csv).toContain('Bob');
      expect(csv).toContain('Charlie');
      expect(csv).not.toContain('Alice');
      expect(csv).not.toContain('Diana');
    });

    it('should exclude configured fields from CSV', async () => {
      const res = await app.request('/users/export?format=csv');

      expect(res.status).toBe(200);
      const csv = await res.text();

      // Header should not contain 'age'
      const lines = csv.split('\r\n');
      expect(lines[0]).not.toContain('age');
    });
  });

  describe('Search and Sort in Export', () => {
    it('should apply search to export', async () => {
      const res = await app.request('/users/export?search=alice');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.data).toHaveLength(1);
      expect(data.result.data[0].name).toBe('Alice');
    });

    it('should apply sorting to export', async () => {
      const res = await app.request('/users/export?order_by=name&order_by_direction=asc');

      expect(res.status).toBe(200);
      const data = await res.json();
      const names = data.result.data.map((r: any) => r.name);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Diana']);
    });
  });
});

// ============================================================================
// Import Endpoint Tests
// ============================================================================

describe('Import Endpoint', () => {
  let app: ReturnType<typeof fromHono>;

  beforeEach(() => {
    clearStorage();
    app = fromHono(new Hono());
    registerCrud(app, '/users', {
      create: UserCreate as any,
      list: UserList as any,
      export: UserExport as any,
      import: UserImport as any,
    });
  });

  describe('JSON Import', () => {
    it('should import records from JSON', async () => {
      const res = await app.request('/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { name: 'Alice', email: 'alice@example.com', role: 'admin' },
            { name: 'Bob', email: 'bob@example.com', role: 'user' },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.result.summary.total).toBe(2);
      expect(data.result.summary.created).toBe(2);
      expect(data.result.summary.failed).toBe(0);
      expect(data.result.results).toHaveLength(2);
      expect(data.result.results[0].status).toBe('created');
      expect(data.result.results[1].status).toBe('created');
    });

    it('should generate IDs for records without them', async () => {
      const res = await app.request('/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ name: 'Alice', email: 'alice@example.com', role: 'admin' }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.results[0].data.id).toBeDefined();
    });

    it('should validate records and report errors', async () => {
      const res = await app.request('/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { name: 'Alice', email: 'alice@example.com', role: 'admin' },
            { name: 'Bob', email: 'invalid-email', role: 'user' }, // Invalid email
            { name: 'Charlie', email: 'charlie@example.com', role: 'invalid' }, // Invalid role
          ],
        }),
      });

      // With skipInvalidRows=true (default), invalid rows are skipped (200), not failed (207)
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.result.summary.total).toBe(3);
      expect(data.result.summary.created).toBe(1);
      expect(data.result.summary.skipped).toBe(2);
      expect(data.result.results[1].status).toBe('skipped');
      expect(data.result.results[1].validationErrors).toBeDefined();
    });

    it('should require items array in request body', async () => {
      const res = await app.request('/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notItems: [] }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('CSV Import', () => {
    it('should import records from CSV', async () => {
      const csv = `name,email,role
Alice,alice@example.com,admin
Bob,bob@example.com,user`;

      const res = await app.request('/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: csv,
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.result.summary.total).toBe(2);
      expect(data.result.summary.created).toBe(2);
    });

    it('should handle CSV with quoted values', async () => {
      const csv = `name,email,role
"Alice, The Admin",alice@example.com,admin
"Bob ""The User""",bob@example.com,user`;

      const res = await app.request('/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: csv,
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.result.summary.created).toBe(2);
      expect(data.result.results[0].data.name).toBe('Alice, The Admin');
      expect(data.result.results[1].data.name).toBe('Bob "The User"');
    });
  });

  describe('Upsert Mode', () => {
    it('should create records in upsert mode when they do not exist', async () => {
      const res = await app.request('/users/import?mode=upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { name: 'Alice', email: 'alice@example.com', role: 'admin' },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.summary.created).toBe(1);
      expect(data.result.summary.updated).toBe(0);
    });

    it('should update existing records in upsert mode', async () => {
      // First, create a user
      await app.request('/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ name: 'Alice', email: 'alice@example.com', role: 'admin' }],
        }),
      });

      // Now upsert with updated data (matched by email)
      const res = await app.request('/users/import?mode=upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ name: 'Alice Updated', email: 'alice@example.com', role: 'moderator' }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.summary.updated).toBe(1);
      expect(data.result.summary.created).toBe(0);
      expect(data.result.results[0].data.name).toBe('Alice Updated');
      expect(data.result.results[0].data.role).toBe('moderator');
    });

    it('should preserve immutable fields on upsert', async () => {
      // First, create a user
      const createRes = await app.request('/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ name: 'Alice', email: 'alice@example.com', role: 'admin' }],
        }),
      });
      const originalId = (await createRes.json()).result.results[0].data.id;

      // Now upsert with different id (should be ignored because id is immutable)
      // Note: We use a valid UUID v4 since validation runs before immutable filtering
      const differentValidUuid = crypto.randomUUID();
      const res = await app.request('/users/import?mode=upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              id: differentValidUuid,
              name: 'Alice Updated',
              email: 'alice@example.com',
              role: 'user',
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      // ID should remain unchanged because id is in immutableFields
      expect(data.result.summary.updated).toBe(1);
      expect(data.result.results[0].status).toBe('updated');
      expect(data.result.results[0].data.id).toBe(originalId);
    });
  });

  describe('Create Mode (Duplicate Handling)', () => {
    it('should skip duplicates in create mode by default', async () => {
      // First import
      await app.request('/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ name: 'Alice', email: 'alice@example.com', role: 'admin' }],
        }),
      });

      // Second import with same email (should skip by default)
      const res = await app.request('/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ name: 'Alice Duplicate', email: 'alice@example.com', role: 'user' }],
        }),
      });

      // With skipInvalidRows=true (default), duplicates are skipped (200), not failed (207)
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.summary.skipped).toBe(1);
      expect(data.result.results[0].status).toBe('skipped');
      expect(data.result.results[0].error).toContain('already exists');
    });
  });

  describe('Multipart Form Data', () => {
    it('should import from uploaded JSON file', async () => {
      const jsonContent = JSON.stringify({
        items: [
          { name: 'Alice', email: 'alice@example.com', role: 'admin' },
        ],
      });

      const formData = new FormData();
      formData.append('file', new Blob([jsonContent], { type: 'application/json' }), 'users.json');

      const res = await app.request('/users/import', {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.summary.created).toBe(1);
    });

    it('should import from uploaded CSV file', async () => {
      const csvContent = `name,email,role
Alice,alice@example.com,admin
Bob,bob@example.com,user`;

      const formData = new FormData();
      formData.append('file', new Blob([csvContent], { type: 'text/csv' }), 'users.csv');

      const res = await app.request('/users/import', {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.summary.created).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should return 400 for unsupported content type', async () => {
      const res = await app.request('/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: '<users></users>',
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for empty CSV', async () => {
      const res = await app.request('/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: '',
      });

      expect(res.status).toBe(400);
    });
  });
});

// ============================================================================
// Round-Trip Test (Export then Import)
// ============================================================================

describe('Export/Import Round-Trip', () => {
  let app: ReturnType<typeof fromHono>;

  beforeEach(async () => {
    clearStorage();
    app = fromHono(new Hono());
    registerCrud(app, '/users', {
      create: UserCreate as any,
      list: UserList as any,
      export: UserExport as any,
      import: UserImport as any,
    });

    // Seed initial data
    for (const user of [
      { name: 'Alice', email: 'alice@example.com', role: 'admin' },
      { name: 'Bob', email: 'bob@example.com', role: 'user' },
    ]) {
      await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });
    }
  });

  it('should export and re-import JSON data successfully', async () => {
    // Export
    const exportRes = await app.request('/users/export?format=json');
    const exportData = await exportRes.json();
    const exportedUsers = exportData.result.data;

    // Clear storage
    clearStorage();

    // Re-import
    const importRes = await app.request('/users/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: exportedUsers }),
    });

    expect(importRes.status).toBe(200);
    const importData = await importRes.json();
    expect(importData.result.summary.created).toBe(2);

    // Verify data
    const listRes = await app.request('/users');
    const listData = await listRes.json();
    expect(listData.result).toHaveLength(2);
  });
});
