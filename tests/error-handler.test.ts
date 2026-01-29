import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { z, ZodError } from 'zod';
import {
  createErrorHandler,
  zodErrorMapper,
  ApiException,
  InputValidationException,
  NotFoundException,
  ConflictException,
  createLoggingMiddleware,
  setLoggingStorage,
  MemoryLoggingStorage,
  type ErrorMapper,
  type ErrorHook,
  type LoggingStorage,
} from '../src/index.js';

// ============================================================================
// Built-in Mapper Tests
// ============================================================================

describe('zodErrorMapper', () => {
  it('should map ZodError to InputValidationException', () => {
    const schema = z.object({
      name: z.string(),
      email: z.email(),
    });

    let zodError: ZodError | undefined;
    try {
      schema.parse({ name: 123, email: 'invalid' });
    } catch (err) {
      zodError = err as ZodError;
    }

    const result = zodErrorMapper(zodError!, {} as any);

    expect(result).toBeInstanceOf(InputValidationException);
    expect(result?.status).toBe(400);
    expect(result?.code).toBe('VALIDATION_ERROR');
  });

  it('should return undefined for non-ZodError', () => {
    const error = new Error('Regular error');
    const result = zodErrorMapper(error, {} as any);

    expect(result).toBeUndefined();
  });
});

// ============================================================================
// Error Handler Factory Tests
// ============================================================================

describe('createErrorHandler', () => {
  describe('basic error handling', () => {
    it('should pass through ApiException directly', async () => {
      const app = new Hono();
      app.onError(createErrorHandler());
      app.get('/test', () => {
        throw new NotFoundException('User', '123');
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data).toEqual({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: "User with id '123' not found",
        },
      });
    });

    it('should convert unknown errors to 500', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const app = new Hono();
      app.onError(createErrorHandler());
      app.get('/test', () => {
        throw new Error('Something went wrong');
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data).toEqual({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
        },
      });

      consoleSpy.mockRestore();
    });

    it('should use custom default error code and message', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const app = new Hono();
      app.onError(createErrorHandler({
        defaultErrorCode: 'SERVER_ERROR',
        defaultErrorMessage: 'Something unexpected happened',
      }));
      app.get('/test', () => {
        throw new Error('Internal failure');
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error.code).toBe('SERVER_ERROR');
      expect(data.error.message).toBe('Something unexpected happened');

      consoleSpy.mockRestore();
    });
  });

  describe('error mappers', () => {
    it('should use custom mapper to convert errors', async () => {
      // Simulate a database constraint error
      class DatabaseError extends Error {
        code: string;
        constructor(message: string, code: string) {
          super(message);
          this.code = code;
        }
      }

      const dbErrorMapper: ErrorMapper = (error) => {
        if (error instanceof DatabaseError && error.code === 'P2002') {
          return new ConflictException('Resource already exists');
        }
        return undefined;
      };

      const app = new Hono();
      app.onError(createErrorHandler({
        mappers: [dbErrorMapper],
      }));
      app.get('/test', () => {
        throw new DatabaseError('Unique constraint failed', 'P2002');
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.error.code).toBe('CONFLICT');
      expect(data.error.message).toBe('Resource already exists');
    });

    it('should try mappers in order and use first match', async () => {
      const mapper1 = vi.fn().mockReturnValue(undefined);
      const mapper2 = vi.fn().mockReturnValue(new NotFoundException('Item'));
      const mapper3 = vi.fn().mockReturnValue(new ConflictException('Duplicate'));

      const app = new Hono();
      app.onError(createErrorHandler({
        mappers: [mapper1, mapper2, mapper3],
      }));
      app.get('/test', () => {
        throw new Error('Test error');
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(mapper1).toHaveBeenCalled();
      expect(mapper2).toHaveBeenCalled();
      expect(mapper3).not.toHaveBeenCalled(); // Should stop after mapper2 returns
      expect(res.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should handle async mappers', async () => {
      const asyncMapper: ErrorMapper = async (error) => {
        // Simulate async operation (e.g., lookup)
        await new Promise((r) => setTimeout(r, 10));
        if (error.message === 'async test') {
          return new ApiException('Async mapped', 422, 'ASYNC_ERROR');
        }
        return undefined;
      };

      const app = new Hono();
      app.onError(createErrorHandler({
        mappers: [asyncMapper],
      }));
      app.get('/test', () => {
        throw new Error('async test');
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(res.status).toBe(422);
      expect(data.error.code).toBe('ASYNC_ERROR');
    });

    it('should continue to next mapper if current throws', async () => {
      const throwingMapper: ErrorMapper = () => {
        throw new Error('Mapper failed');
      };
      const workingMapper: ErrorMapper = () => {
        return new ApiException('Working', 400, 'WORKING');
      };

      const app = new Hono();
      app.onError(createErrorHandler({
        mappers: [throwingMapper, workingMapper],
      }));
      app.get('/test', () => {
        throw new Error('Test');
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.code).toBe('WORKING');
    });

    it('should use built-in zodErrorMapper', async () => {
      const schema = z.object({
        name: z.string(),
      });

      const app = new Hono();
      app.onError(createErrorHandler());
      app.post('/test', async (c) => {
        const body = await c.req.json();
        schema.parse(body);
        return c.json({ ok: true });
      });

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 123 }),
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toBe('Validation failed');
      expect(data.error.details).toBeDefined();
    });
  });

  describe('error hooks', () => {
    it('should call hooks with error and apiException', async () => {
      const hook = vi.fn();

      const app = new Hono();
      app.onError(createErrorHandler({
        hooks: [hook],
      }));
      app.get('/test', () => {
        throw new NotFoundException('Item', '456');
      });

      await app.request('/test');
      await new Promise((r) => setTimeout(r, 10));

      expect(hook).toHaveBeenCalled();
      const [error, ctx, apiException] = hook.mock.calls[0];
      expect(error).toBeInstanceOf(NotFoundException);
      expect(apiException).toBeInstanceOf(NotFoundException);
      expect(apiException.status).toBe(404);
    });

    it('should call multiple hooks', async () => {
      const hook1 = vi.fn();
      const hook2 = vi.fn();
      const hook3 = vi.fn();

      const app = new Hono();
      app.onError(createErrorHandler({
        hooks: [hook1, hook2, hook3],
      }));
      app.get('/test', () => {
        throw new Error('Test');
      });

      await app.request('/test');
      await new Promise((r) => setTimeout(r, 10));

      expect(hook1).toHaveBeenCalled();
      expect(hook2).toHaveBeenCalled();
      expect(hook3).toHaveBeenCalled();
    });

    it('should handle async hooks', async () => {
      const results: string[] = [];
      const asyncHook: ErrorHook = async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push('async done');
      };

      const app = new Hono();
      app.onError(createErrorHandler({
        hooks: [asyncHook],
      }));
      app.get('/test', () => {
        throw new Error('Test');
      });

      await app.request('/test');
      await new Promise((r) => setTimeout(r, 50));

      expect(results).toContain('async done');
    });

    it('should catch and report hook errors', async () => {
      const onHookError = vi.fn();
      const throwingHook: ErrorHook = () => {
        throw new Error('Hook exploded');
      };

      const app = new Hono();
      app.onError(createErrorHandler({
        hooks: [throwingHook],
        onHookError,
      }));
      app.get('/test', () => {
        throw new Error('Original error');
      });

      const res = await app.request('/test');
      await new Promise((r) => setTimeout(r, 10));

      // Response should still be returned
      expect(res.status).toBe(500);
      expect(onHookError).toHaveBeenCalled();
      expect(onHookError.mock.calls[0][0].message).toBe('Hook exploded');
      expect(onHookError.mock.calls[0][1].message).toBe('Original error');
    });

    it('should catch and report async hook errors', async () => {
      const onHookError = vi.fn();
      const asyncThrowingHook: ErrorHook = async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error('Async hook failed');
      };

      const app = new Hono();
      app.onError(createErrorHandler({
        hooks: [asyncThrowingHook],
        onHookError,
      }));
      app.get('/test', () => {
        throw new Error('Test');
      });

      await app.request('/test');
      await new Promise((r) => setTimeout(r, 50));

      expect(onHookError).toHaveBeenCalled();
      expect(onHookError.mock.calls[0][0].message).toBe('Async hook failed');
    });
  });

  describe('request ID inclusion', () => {
    let storage: MemoryLoggingStorage;

    beforeEach(() => {
      storage = new MemoryLoggingStorage({ maxEntries: 100, cleanupInterval: 0 });
      setLoggingStorage(storage);
    });

    afterEach(() => {
      storage.destroy();
      setLoggingStorage(null as unknown as LoggingStorage);
    });

    it('should include requestId when logging middleware is active', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.onError(createErrorHandler({ includeRequestId: true }));
      app.get('/test', () => {
        throw new NotFoundException('User');
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(data.error.requestId).toBeDefined();
      expect(data.error.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('should not include requestId when disabled', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.onError(createErrorHandler({ includeRequestId: false }));
      app.get('/test', () => {
        throw new NotFoundException('User');
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(data.error.requestId).toBeUndefined();
    });

    it('should not include requestId when logging middleware is not active', async () => {
      const app = new Hono();
      app.onError(createErrorHandler({ includeRequestId: true }));
      app.get('/test', () => {
        throw new NotFoundException('User');
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(data.error.requestId).toBeUndefined();
    });
  });

  describe('stack trace option', () => {
    it('should include stack trace when enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const app = new Hono();
      app.onError(createErrorHandler({ includeStackTrace: true }));
      app.get('/test', () => {
        throw new Error('Test error');
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(data.error.stack).toBeDefined();
      expect(data.error.stack).toContain('Error: Test error');

      consoleSpy.mockRestore();
    });

    it('should not include stack trace by default', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const app = new Hono();
      app.onError(createErrorHandler());
      app.get('/test', () => {
        throw new Error('Test error');
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(data.error.stack).toBeUndefined();

      consoleSpy.mockRestore();
    });
  });

  describe('logging behavior', () => {
    it('should log unmapped errors by default', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const app = new Hono();
      app.onError(createErrorHandler());
      app.get('/test', () => {
        throw new Error('Unknown error');
      });

      await app.request('/test');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain('[ErrorHandler]');

      consoleSpy.mockRestore();
    });

    it('should not log unmapped errors when disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const app = new Hono();
      app.onError(createErrorHandler({ logUnmappedErrors: false }));
      app.get('/test', () => {
        throw new Error('Unknown error');
      });

      await app.request('/test');

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should not log ApiException errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const app = new Hono();
      app.onError(createErrorHandler());
      app.get('/test', () => {
        throw new NotFoundException('User');
      });

      await app.request('/test');

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('ApiException with details', () => {
    it('should preserve details in error response', async () => {
      const app = new Hono();
      app.onError(createErrorHandler());
      app.get('/test', () => {
        throw new ApiException('Validation failed', 400, 'VALIDATION_ERROR', {
          fields: ['name', 'email'],
          reasons: ['required', 'invalid format'],
        });
      });

      const res = await app.request('/test');
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.details).toEqual({
        fields: ['name', 'email'],
        reasons: ['required', 'invalid format'],
      });
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Error Handler Integration', () => {
  it('should handle various error types consistently', async () => {
    class CustomDatabaseError extends Error {
      code: string;
      constraint?: string;
      constructor(message: string, code: string, constraint?: string) {
        super(message);
        this.code = code;
        this.constraint = constraint;
      }
    }

    const dbMapper: ErrorMapper = (error) => {
      if (error instanceof CustomDatabaseError) {
        if (error.code === 'P2002') {
          return new ConflictException(`Duplicate value for: ${error.constraint}`);
        }
        if (error.code === 'P2025') {
          return new NotFoundException('Record');
        }
      }
      return undefined;
    };

    const errorLog: Array<{ type: string; status: number }> = [];
    const loggingHook: ErrorHook = (error, ctx, apiException) => {
      errorLog.push({
        type: error.constructor.name,
        status: apiException.status,
      });
    };

    const app = new Hono();
    app.onError(createErrorHandler({
      mappers: [dbMapper],
      hooks: [loggingHook],
      logUnmappedErrors: false,
    }));

    // Test route for different errors
    app.get('/api-exception', () => {
      throw new ApiException('API Error', 400, 'API_ERROR');
    });
    app.get('/not-found', () => {
      throw new NotFoundException('User', '123');
    });
    app.get('/db-conflict', () => {
      throw new CustomDatabaseError('Duplicate', 'P2002', 'email');
    });
    app.get('/db-not-found', () => {
      throw new CustomDatabaseError('Not found', 'P2025');
    });
    app.get('/zod-error', async (c) => {
      const schema = z.object({ id: z.number() });
      schema.parse({ id: 'not a number' });
      return c.json({ ok: true });
    });
    app.get('/generic-error', () => {
      throw new Error('Something failed');
    });

    // Test each route
    const res1 = await app.request('/api-exception');
    expect(res1.status).toBe(400);
    expect((await res1.json()).error.code).toBe('API_ERROR');

    const res2 = await app.request('/not-found');
    expect(res2.status).toBe(404);
    expect((await res2.json()).error.code).toBe('NOT_FOUND');

    const res3 = await app.request('/db-conflict');
    expect(res3.status).toBe(409);
    expect((await res3.json()).error.message).toContain('email');

    const res4 = await app.request('/db-not-found');
    expect(res4.status).toBe(404);

    const res5 = await app.request('/zod-error');
    expect(res5.status).toBe(400);
    expect((await res5.json()).error.code).toBe('VALIDATION_ERROR');

    const res6 = await app.request('/generic-error');
    expect(res6.status).toBe(500);
    expect((await res6.json()).error.code).toBe('INTERNAL_ERROR');

    // Wait for hooks
    await new Promise((r) => setTimeout(r, 10));

    // Verify all errors were logged
    expect(errorLog).toHaveLength(6);
    expect(errorLog.map((e) => e.status)).toEqual([400, 404, 409, 404, 400, 500]);
  });

  it('should work with Sentry-like error reporting', async () => {
    const capturedErrors: Error[] = [];

    // Mock Sentry-like service
    const mockSentry = {
      captureException: (error: Error) => {
        capturedErrors.push(error);
      },
    };

    const sentryHook: ErrorHook = (error, ctx, apiException) => {
      // Only report 5xx errors to Sentry
      if (apiException.status >= 500) {
        mockSentry.captureException(error);
      }
    };

    const app = new Hono();
    app.onError(createErrorHandler({
      hooks: [sentryHook],
      logUnmappedErrors: false,
    }));

    app.get('/client-error', () => {
      throw new NotFoundException('Item');
    });
    app.get('/server-error', () => {
      throw new Error('Database connection lost');
    });

    await app.request('/client-error');
    await app.request('/server-error');
    await new Promise((r) => setTimeout(r, 10));

    // Only server error should be captured
    expect(capturedErrors).toHaveLength(1);
    expect(capturedErrors[0].message).toBe('Database connection lost');
  });
});
