/**
 * Example: Field Selection functionality
 *
 * Demonstrates field selection - allowing clients to specify which fields
 * to return via ?fields=field1,field2 query parameter.
 *
 * Benefits:
 * - Reduce payload size by requesting only needed fields
 * - Protect sensitive fields from being exposed
 * - Optimize API responses for different use cases
 *
 * Run with: npx tsx examples/field-selection.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import {
  fromHono,
  setupSwaggerUI,
  defineModel,
  defineMeta,
  type ComputedFieldsConfig,
} from '../../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryListEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  clearStorage,
  getStorage,
} from '../../src/adapters/memory/index.js';

// Clear storage on start
clearStorage();

// ============================================================================
// Schema Definition
// ============================================================================

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  password: z.string().min(8), // Sensitive field - should be blocked
  role: z.enum(['admin', 'user', 'guest']),
  phone: z.string().optional(),
  address: z.string().optional(),
  bio: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type User = z.infer<typeof UserSchema>;

// ============================================================================
// Computed Fields
// ============================================================================

const userComputedFields: ComputedFieldsConfig<User> = {
  displayName: {
    compute: (user) => `${user.name} (${user.role})`,
    schema: z.string(),
  },
  isAdmin: {
    compute: (user) => user.role === 'admin',
    schema: z.boolean(),
  },
};

// ============================================================================
// Model Definition
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  computedFields: userComputedFields,
});

const userMeta = defineMeta({ model: UserModel });

// ============================================================================
// Endpoint Classes with Field Selection
// ============================================================================

class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Create a user',
  };

  async before(data: Partial<User>) {
    return {
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

/**
 * List endpoint with field selection enabled.
 *
 * Features:
 * - ?fields=id,name,email - Select specific fields
 * - password is always blocked (never returned)
 * - id is always included (even if not requested)
 * - Default fields returned when no fields param specified
 */
class UserList extends MemoryListEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'List users with field selection',
    description: `
List users with optional field selection.

**Query Parameters:**
- \`fields\` - Comma-separated list of fields to return

**Examples:**
- \`GET /users\` - Returns default fields (id, name, email, role)
- \`GET /users?fields=id,name\` - Returns only id and name
- \`GET /users?fields=id,name,displayName\` - Include computed field
- \`GET /users?fields=id,email,phone,address\` - Include contact info

**Notes:**
- \`password\` field is always blocked (never returned)
- \`id\` field is always included for identification
    `,
  };

  // Enable field selection
  fieldSelectionEnabled = true;

  // Block sensitive fields from being returned
  blockedSelectFields = ['password'];

  // Always include id for identification
  alwaysIncludeFields = ['id'];

  // Default fields when no ?fields parameter
  defaultSelectFields = ['id', 'name', 'email', 'role'];

  // Allow filtering and sorting
  filterFields = ['role'];
  searchFields = ['name', 'email'];
  orderByFields = ['name', 'createdAt'];
}

/**
 * Read endpoint with field selection enabled.
 */
class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Get a user by ID with field selection',
    description: `
Get a single user with optional field selection.

**Examples:**
- \`GET /users/:id\` - Returns default fields
- \`GET /users/:id?fields=id,name,email\` - Returns only selected fields
- \`GET /users/:id?fields=id,name,displayName,isAdmin\` - Include computed fields
    `,
  };

  // Enable field selection
  fieldSelectionEnabled = true;

  // Block sensitive fields
  blockedSelectFields = ['password'];

  // Always include id
  alwaysIncludeFields = ['id'];

  // Default fields
  defaultSelectFields = ['id', 'name', 'email', 'role', 'displayName'];
}

class UserUpdate extends MemoryUpdateEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Update a user',
  };

  // Prevent updating sensitive/system fields
  blockedUpdateFields = ['password', 'createdAt'];

  async before(data: Partial<User>) {
    return {
      ...data,
      updatedAt: new Date().toISOString(),
    };
  }
}

class UserDelete extends MemoryDeleteEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Delete a user',
  };
}

// ============================================================================
// App Setup
// ============================================================================

const app = fromHono(new Hono());

// User CRUD routes
app.post('/users', UserCreate);
app.get('/users', UserList);
app.get('/users/:id', UserRead);
app.patch('/users/:id', UserUpdate);
app.delete('/users/:id', UserDelete);

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Field Selection Example API',
    version: '1.0.0',
    description: `
This API demonstrates field selection - allowing clients to request only specific fields.

## Field Selection Query Parameter

Use \`?fields=field1,field2,field3\` to select specific fields.

## Available Fields

**Schema Fields:** id, email, name, role, phone, address, bio, createdAt, updatedAt
**Computed Fields:** displayName, isAdmin
**Blocked Fields:** password (never returned)

## Examples

| Request | Response Fields |
|---------|----------------|
| \`GET /users\` | id, name, email, role (defaults) |
| \`GET /users?fields=id,name\` | id, name |
| \`GET /users?fields=id,email,phone\` | id, email, phone |
| \`GET /users?fields=id,displayName\` | id, displayName (computed) |

## Benefits

- **Reduced Payload:** Only transfer needed data
- **Security:** Sensitive fields (password) are blocked
- **Flexibility:** Different views for different use cases
    `,
  },
});

// Swagger UI
setupSwaggerUI(app, '/docs');

// ============================================================================
// Add Sample Data
// ============================================================================

function addSampleData() {
  const userStore = getStorage<User>('users');

  const sampleUsers: User[] = [
    {
      id: '550e8400-e29b-41d4-a716-446655440001',
      email: 'alice@example.com',
      name: 'Alice Johnson',
      password: 'secret123456',
      role: 'admin',
      phone: '+1-555-0101',
      address: '123 Admin St, Tech City',
      bio: 'Platform administrator',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440002',
      email: 'bob@example.com',
      name: 'Bob Smith',
      password: 'password789',
      role: 'user',
      phone: '+1-555-0102',
      address: '456 User Ave, Data Town',
      bio: 'Regular user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440003',
      email: 'charlie@example.com',
      name: 'Charlie Brown',
      password: 'mypassword123',
      role: 'guest',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  sampleUsers.forEach((user) => {
    userStore.set(user.id, user);
  });
}

addSampleData();

// Start server
const port = 3004;
console.log(`Field Selection Example running at http://localhost:${port}`);
console.log(`Swagger UI: http://localhost:${port}/docs`);
console.log(`OpenAPI spec: http://localhost:${port}/openapi.json`);
console.log('\nTry these requests:');
console.log(`\n1. Default fields (id, name, email, role):`);
console.log(`   curl http://localhost:${port}/users | jq`);
console.log(`\n2. Select specific fields:`);
console.log(`   curl "http://localhost:${port}/users?fields=id,name" | jq`);
console.log(`\n3. Include contact info:`);
console.log(`   curl "http://localhost:${port}/users?fields=id,name,email,phone,address" | jq`);
console.log(`\n4. Include computed fields:`);
console.log(`   curl "http://localhost:${port}/users?fields=id,name,displayName,isAdmin" | jq`);
console.log(`\n5. Single user with field selection:`);
console.log(`   curl "http://localhost:${port}/users/550e8400-e29b-41d4-a716-446655440001?fields=id,name,bio" | jq`);
console.log(`\n6. Note: password is NEVER returned (blocked):`);
console.log(`   curl "http://localhost:${port}/users?fields=id,name,password" | jq`);

serve({ fetch: app.fetch, port });
