/**
 * Example: Computed Fields functionality
 *
 * Demonstrates computed fields - virtual fields calculated at runtime
 * that are not stored in the database.
 *
 * Computed fields are useful for:
 * - Combining multiple fields (e.g., fullName from firstName + lastName)
 * - Calculating derived values (e.g., age from birthDate)
 * - Status flags (e.g., isActive based on multiple conditions)
 * - Aggregations or transformations
 *
 * Run with: npx tsx examples/computed-fields.ts
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
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.email(),
  birthDate: z.string(), // ISO date string
  status: z.enum(['active', 'inactive', 'pending']),
  emailVerified: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

type User = z.infer<typeof UserSchema>;

// ============================================================================
// Computed Fields Configuration
// ============================================================================

/**
 * Define computed fields for the User model.
 * Each computed field has:
 * - compute: function that calculates the value from the record
 * - schema: optional Zod schema for OpenAPI documentation
 * - dependsOn: optional array of fields this computed field depends on
 */
const userComputedFields: ComputedFieldsConfig<User> = {
  // Combine firstName and lastName
  fullName: {
    compute: (user) => `${user.firstName} ${user.lastName}`,
    schema: z.string(),
    dependsOn: ['firstName', 'lastName'],
  },

  // Calculate age from birthDate
  age: {
    compute: (user) => {
      const birth = new Date(user.birthDate);
      const today = new Date();
      let age = today.getFullYear() - birth.getFullYear();
      const monthDiff = today.getMonth() - birth.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
      }
      return age;
    },
    schema: z.number(),
    dependsOn: ['birthDate'],
  },

  // Determine if user is fully active (status + email verification)
  isFullyActive: {
    compute: (user) => user.status === 'active' && user.emailVerified,
    schema: z.boolean(),
    dependsOn: ['status', 'emailVerified'],
  },

  // Calculate days since last login
  daysSinceLastLogin: {
    compute: (user) => {
      if (!user.lastLoginAt) return null;
      const lastLogin = new Date(user.lastLoginAt);
      const today = new Date();
      const diffTime = today.getTime() - lastLogin.getTime();
      return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    },
    schema: z.number().nullable(),
    dependsOn: ['lastLoginAt'],
  },

  // Generate initials
  initials: {
    compute: (user) => {
      return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
    },
    schema: z.string(),
    dependsOn: ['firstName', 'lastName'],
  },

  // Async computed field example (could fetch from external service)
  greeting: {
    compute: async (user) => {
      // Simulating async operation
      await new Promise((resolve) => setTimeout(resolve, 1));
      const hour = new Date().getHours();
      const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
      return `Good ${timeOfDay}, ${user.firstName}!`;
    },
    schema: z.string(),
    dependsOn: ['firstName'],
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
// Endpoint Classes
// ============================================================================

class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Create a new user',
    description: 'Creates a user. Response includes computed fields.',
  };

  async before(data: Partial<User>) {
    return {
      ...data,
      createdAt: new Date().toISOString(),
    };
  }
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Get a user by ID',
    description: 'Returns user with computed fields: fullName, age, isFullyActive, etc.',
  };
}

class UserList extends MemoryListEndpoint {
  _meta = userMeta;

  filterFields = ['status', 'emailVerified'];
  searchFields = ['firstName', 'lastName', 'email'];
  sortFields = ['firstName', 'lastName', 'createdAt'];

  schema = {
    tags: ['Users'],
    summary: 'List all users',
    description: 'Returns list of users with computed fields on each.',
  };
}

class UserUpdate extends MemoryUpdateEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Update a user',
    description: 'Updates user fields. Computed fields are recalculated in response.',
  };
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
    title: 'Computed Fields Example API',
    version: '1.0.0',
    description: `
This API demonstrates computed fields - virtual fields calculated at runtime.

## Computed Fields on User:

| Field | Description |
|-------|-------------|
| fullName | Combines firstName + lastName |
| age | Calculated from birthDate |
| isFullyActive | True if status='active' AND emailVerified=true |
| daysSinceLastLogin | Days since lastLoginAt (null if never logged in) |
| initials | First letters of first and last name |
| greeting | Time-based greeting message |

These fields appear in all responses but are not stored in the database.
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
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      birthDate: '1990-05-15',
      status: 'active',
      emailVerified: true,
      lastLoginAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
      createdAt: new Date().toISOString(),
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440002',
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      birthDate: '1985-12-20',
      status: 'active',
      emailVerified: false,
      lastLoginAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
      createdAt: new Date().toISOString(),
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440003',
      firstName: 'Bob',
      lastName: 'Wilson',
      email: 'bob@example.com',
      birthDate: '2000-01-01',
      status: 'pending',
      emailVerified: false,
      lastLoginAt: null,
      createdAt: new Date().toISOString(),
    },
  ];

  sampleUsers.forEach((user) => {
    userStore.set(user.id, user);
  });
}

addSampleData();

// Start server
const port = 3003;
console.log(`Computed Fields Example running at http://localhost:${port}`);
console.log(`Swagger UI: http://localhost:${port}/docs`);
console.log(`OpenAPI spec: http://localhost:${port}/openapi.json`);
console.log('\nSample users loaded. Try:');
console.log(`  curl http://localhost:${port}/users | jq`);
console.log(`  curl http://localhost:${port}/users/550e8400-e29b-41d4-a716-446655440001 | jq`);

serve({ fetch: app.fetch, port });
