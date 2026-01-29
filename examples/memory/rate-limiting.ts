/**
 * Rate Limiting Example
 *
 * This example demonstrates how to use the rate limiting middleware
 * to protect endpoints from abuse.
 *
 * Features demonstrated:
 * - Basic rate limiting by IP
 * - Rate limiting with auth context (by user)
 * - Skip paths functionality
 * - Custom tier limits (premium vs free users)
 * - Response headers
 * - Callback for exceeded limits
 */

import { Hono, type Env } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import {
  fromHono,
  registerCrud,
  setupSwaggerUI,
  defineModel,
  defineMeta,
  // Rate limiting exports
  createRateLimitMiddleware,
  setRateLimitStorage,
  MemoryRateLimitStorage,
  RateLimitExceededException,
  type RateLimitEnv,
  type AuthEnv,
} from '../../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryListEndpoint,
  clearStorage,
} from '../../src/adapters/memory/index.js';

// Clear storage on start
clearStorage();

// ============================================================================
// Setup Rate Limit Storage
// ============================================================================

// Create and set up the storage (do this once at startup)
const rateLimitStorage = new MemoryRateLimitStorage();
setRateLimitStorage(rateLimitStorage);

// Clean up on shutdown
process.on('SIGTERM', () => {
  rateLimitStorage.destroy();
  process.exit(0);
});

// ============================================================================
// Combined Environment Type
// ============================================================================

// Combine AuthEnv and RateLimitEnv for type-safe context
type AppEnv = AuthEnv & RateLimitEnv & {
  Variables: {
    userId?: string;
    user?: { id: string; tier?: 'free' | 'premium' };
  };
};

// ============================================================================
// User Model
// ============================================================================

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  tier: z.enum(['free', 'premium']).default('free'),
});

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
});

const userMeta = defineMeta({ model: UserModel });

class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Create a new user' };
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Get a user by ID' };
}

class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'List all users' };
  filterFields = ['tier'];
}

// ============================================================================
// Create the App
// ============================================================================

const app = fromHono(new Hono<AppEnv>());

// Error handler to convert exceptions to proper HTTP responses
app.onError((err, c) => {
  if (err instanceof RateLimitExceededException) {
    // Set Retry-After header for rate limit errors
    const retryAfter = (err.details as { retryAfter?: number })?.retryAfter;
    if (retryAfter) {
      c.header('Retry-After', String(retryAfter));
    }
    return c.json(err.toJSON(), 429);
  }

  // Handle other ApiException types
  if ('status' in err && typeof err.status === 'number' && 'toJSON' in err) {
    return c.json((err as RateLimitExceededException).toJSON(), err.status as 400 | 404 | 429 | 500);
  }

  // Generic error
  console.error('Unhandled error:', err);
  return c.json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: err.message },
  }, 500);
});

// ============================================================================
// Example 1: Basic IP-based Rate Limiting
// ============================================================================

// Global rate limit: 100 requests per minute per IP
// Skip health check and docs paths
app.use('*', createRateLimitMiddleware<AppEnv>({
  limit: 100,
  windowSeconds: 60,
  keyStrategy: 'ip',
  skipPaths: ['/health', '/docs', '/docs/*', '/openapi.json'],
  includeHeaders: true,
  onRateLimitExceeded: async (ctx, result, key) => {
    console.log(`Rate limit exceeded for key: ${key}`);
    console.log(`Limit: ${result.limit}, Remaining: ${result.remaining}`);
  },
}));

// ============================================================================
// Example 2: Stricter Rate Limit for Specific Endpoints
// ============================================================================

// Export endpoint: Only 5 requests per minute
app.use('/api/export/*', createRateLimitMiddleware<AppEnv>({
  limit: 5,
  windowSeconds: 60,
  keyPrefix: 'rl:export',
  algorithm: 'fixed-window', // Use fixed window for simpler quota management
  errorMessage: 'Export rate limit exceeded. Please wait before trying again.',
}));

// ============================================================================
// Example 3: Per-User Rate Limiting with Tiers
// ============================================================================

// Fake auth middleware that sets user based on header (for demo purposes)
app.use('/api/*', async (ctx, next) => {
  const userId = ctx.req.header('X-User-ID');
  const userTier = ctx.req.header('X-User-Tier') as 'free' | 'premium' | undefined;

  if (userId) {
    ctx.set('userId', userId);
    ctx.set('user', { id: userId, tier: userTier || 'free' });
  }

  await next();
});

// Per-user rate limiting with different limits based on tier
app.use('/api/*', createRateLimitMiddleware<AppEnv>({
  keyStrategy: 'user',
  keyPrefix: 'rl:api',
  getTier: async (ctx) => {
    const user = ctx.get('user');
    if (user?.tier === 'premium') {
      // Premium users get 1000 requests per minute
      return { limit: 1000, windowSeconds: 60 };
    }
    // Free users get 100 requests per minute
    return { limit: 100, windowSeconds: 60 };
  },
}));

// ============================================================================
// Example 4: Combined Key Strategy
// ============================================================================

// Sensitive endpoint: Combined IP + User ID for extra security
app.use('/api/sensitive/*', createRateLimitMiddleware<AppEnv>({
  keyStrategy: 'combined',
  limit: 10,
  windowSeconds: 60,
  keyPrefix: 'rl:sensitive',
}));

// ============================================================================
// Register Endpoints
// ============================================================================

registerCrud(app, '/api/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
});

// Export endpoint (demonstrating stricter rate limit)
app.get('/api/export/users', async (c) => {
  // Simulate expensive export operation
  return c.json({
    success: true,
    message: 'User export completed',
    timestamp: new Date().toISOString(),
  });
});

// Sensitive endpoint (demonstrating combined rate limit)
app.get('/api/sensitive/data', async (c) => {
  return c.json({
    success: true,
    data: 'This is sensitive data',
  });
});

// ============================================================================
// Utility Endpoints
// ============================================================================

// Health check (skipped by rate limiter)
app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// Check rate limit status
app.get('/api/rate-limit-status', (c) => {
  const rateLimit = c.get('rateLimit');
  const rateLimitKey = c.get('rateLimitKey');

  return c.json({
    success: true,
    rateLimit: rateLimit || null,
    key: rateLimitKey || null,
  });
});

// ============================================================================
// Documentation
// ============================================================================

app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Rate Limiting Example API',
    version: '1.0.0',
    description: `
      This API demonstrates rate limiting middleware.

      ## Rate Limits

      - **Global**: 100 requests/minute per IP
      - **Export**: 5 requests/minute per IP
      - **API (Free)**: 100 requests/minute per user
      - **API (Premium)**: 1000 requests/minute per user
      - **Sensitive**: 10 requests/minute per IP+user

      ## Headers

      The following headers are included in all responses:
      - \`X-RateLimit-Limit\`: Maximum requests allowed
      - \`X-RateLimit-Remaining\`: Remaining requests in window
      - \`X-RateLimit-Reset\`: Unix timestamp when limit resets
      - \`Retry-After\`: Seconds to wait (only on 429 responses)

      ## Testing

      To test per-user rate limiting, include these headers:
      - \`X-User-ID\`: Your user ID
      - \`X-User-Tier\`: "free" or "premium"
    `,
  },
});

setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });

// ============================================================================
// Start Server
// ============================================================================

const port = Number(process.env.PORT) || 3456;

console.log(`
Rate Limiting Example Server
============================

Server running at http://localhost:${port}
Swagger UI at http://localhost:${port}/docs

Rate Limits:
- Global: 100 req/min (IP-based)
- Export: 5 req/min (IP-based, fixed window)
- API: 100 req/min (user-based, free tier)
- API: 1000 req/min (user-based, premium tier)

Test with:
  # Basic rate limit test
  for i in {1..10}; do curl -s http://localhost:${port}/api/users | jq '.success'; done

  # Export rate limit test (hits limit after 5)
  for i in {1..10}; do curl -s http://localhost:${port}/api/export/users | jq '.success'; done

  # Per-user rate limit test
  curl -H "X-User-ID: user123" -H "X-User-Tier: premium" http://localhost:${port}/api/users

  # Check rate limit status
  curl http://localhost:${port}/api/rate-limit-status | jq
`);

serve({
  fetch: app.fetch,
  port,
});
