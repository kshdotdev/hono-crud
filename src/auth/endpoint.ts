import { z } from 'zod';
import type { Context } from 'hono';
import type { AuthEnv, AuthUser, EndpointAuthConfig } from './types';
import type { OpenAPIRouteSchema, MetaInput, Constructor } from '../core/types';
import { OpenAPIRoute } from '../core/route';
import { UnauthorizedException, ForbiddenException } from '../core/exceptions';

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Interface for auth endpoint methods added by withAuth mixin.
 */
export interface AuthEndpointMethods {
  getUser(): AuthUser;
  getUserOrNull(): AuthUser | undefined;
  getUserId(): string;
  getUserIdOrNull(): string | undefined;
  getUserRoles(): string[];
  getUserPermissions(): string[];
  hasRole(role: string): boolean;
  hasAnyRole(...roles: string[]): boolean;
  hasAllRoles(...roles: string[]): boolean;
  hasPermission(permission: string): boolean;
  hasAllPermissions(...permissions: string[]): boolean;
  hasAnyPermission(...permissions: string[]): boolean;
  enforceAuth(): Promise<void>;
  authorize(user: AuthUser, ctx: Context): Promise<boolean>;
}

// ============================================================================
// AuthenticatedEndpoint Base Class
// ============================================================================

/**
 * Base class for authenticated endpoints.
 * Provides helper methods for accessing user info and checking roles/permissions.
 *
 * @example
 * ```ts
 * class SecureEndpoint extends AuthenticatedEndpoint<AuthEnv, MetaInput> {
 *   requiresAuth = true;
 *   requiredRoles = ['admin'];
 *
 *   async handle(ctx: Context<AuthEnv>) {
 *     this.setContext(ctx);
 *     const user = this.getUser(); // AuthUser
 *     return this.success({ user });
 *   }
 * }
 * ```
 */
export abstract class AuthenticatedEndpoint<
  E extends AuthEnv = AuthEnv,
  _M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  /**
   * Whether authentication is required for this endpoint.
   * @default true
   */
  requiresAuth: boolean = true;

  /**
   * Required roles (user must have at least one).
   */
  requiredRoles?: string[];

  /**
   * Required permissions (user must have all).
   */
  requiredPermissions?: string[];

  /**
   * Whether all roles are required (AND logic) vs any role (OR logic).
   * @default false (OR logic)
   */
  requireAllRoles: boolean = false;

  /**
   * Custom authorization check.
   * Return true to allow, false to deny.
   */
  async authorize(_user: AuthUser, _ctx: Context<E>): Promise<boolean> {
    return true;
  }

  // ============================================================================
  // User Access Methods
  // ============================================================================

  /**
   * Gets the authenticated user.
   * Throws UnauthorizedException if not authenticated.
   */
  protected getUser(): AuthUser {
    const ctx = this.getContext();
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    return user;
  }

  /**
   * Gets the authenticated user or undefined.
   */
  protected getUserOrNull(): AuthUser | undefined {
    const ctx = this.getContext();
    return ctx.var.user;
  }

  /**
   * Gets the authenticated user's ID.
   * Throws UnauthorizedException if not authenticated.
   */
  protected getUserId(): string {
    return this.getUser().id;
  }

  /**
   * Gets the authenticated user's ID or undefined.
   */
  protected getUserIdOrNull(): string | undefined {
    return this.getUserOrNull()?.id;
  }

  /**
   * Gets the authenticated user's roles.
   */
  protected getUserRoles(): string[] {
    return this.getUser().roles || [];
  }

  /**
   * Gets the authenticated user's permissions.
   */
  protected getUserPermissions(): string[] {
    return this.getUser().permissions || [];
  }

  // ============================================================================
  // Role/Permission Check Methods
  // ============================================================================

  /**
   * Checks if the user has a specific role.
   */
  protected hasRole(role: string): boolean {
    return this.getUserRoles().includes(role);
  }

  /**
   * Checks if the user has any of the specified roles.
   */
  protected hasAnyRole(...roles: string[]): boolean {
    const userRoles = this.getUserRoles();
    return roles.some((role) => userRoles.includes(role));
  }

  /**
   * Checks if the user has all of the specified roles.
   */
  protected hasAllRoles(...roles: string[]): boolean {
    const userRoles = this.getUserRoles();
    return roles.every((role) => userRoles.includes(role));
  }

  /**
   * Checks if the user has a specific permission.
   */
  protected hasPermission(permission: string): boolean {
    return this.getUserPermissions().includes(permission);
  }

  /**
   * Checks if the user has all of the specified permissions.
   */
  protected hasAllPermissions(...permissions: string[]): boolean {
    const userPermissions = this.getUserPermissions();
    return permissions.every((perm) => userPermissions.includes(perm));
  }

  /**
   * Checks if the user has any of the specified permissions.
   */
  protected hasAnyPermission(...permissions: string[]): boolean {
    const userPermissions = this.getUserPermissions();
    return permissions.some((perm) => userPermissions.includes(perm));
  }

  // ============================================================================
  // Authorization Enforcement
  // ============================================================================

  /**
   * Enforces authentication and authorization requirements.
   * Call this at the beginning of your handle() method.
   */
  protected async enforceAuth(): Promise<void> {
    const ctx = this.getContext();

    // Check authentication
    if (this.requiresAuth) {
      if (!ctx.var.user) {
        throw new UnauthorizedException('Authentication required');
      }
    }

    const user = ctx.var.user;
    if (!user) {
      return; // No auth required and no user - allow access
    }

    // Check roles
    if (this.requiredRoles && this.requiredRoles.length > 0) {
      const userRoles = user.roles || [];

      if (this.requireAllRoles) {
        const hasAllRoles = this.requiredRoles.every((role) => userRoles.includes(role));
        if (!hasAllRoles) {
          throw new ForbiddenException(
            `Required roles: ${this.requiredRoles.join(' and ')}`
          );
        }
      } else {
        const hasAnyRole = this.requiredRoles.some((role) => userRoles.includes(role));
        if (!hasAnyRole) {
          throw new ForbiddenException(
            `Required role: ${this.requiredRoles.join(' or ')}`
          );
        }
      }
    }

    // Check permissions
    if (this.requiredPermissions && this.requiredPermissions.length > 0) {
      const userPermissions = user.permissions || [];
      const hasAllPermissions = this.requiredPermissions.every((perm) =>
        userPermissions.includes(perm)
      );
      if (!hasAllPermissions) {
        throw new ForbiddenException(
          `Required permissions: ${this.requiredPermissions.join(', ')}`
        );
      }
    }

    // Custom authorization
    const isAuthorized = await this.authorize(user, ctx);
    if (!isAuthorized) {
      throw new ForbiddenException('Access denied');
    }
  }

  // ============================================================================
  // Schema Enhancement
  // ============================================================================

  /**
   * Enhanced getSchema that adds auth-related responses.
   */
  getSchema(): OpenAPIRouteSchema {
    const baseSchema = super.getSchema();

    // Add security scheme if auth is required
    const security = this.requiresAuth ? [{ bearerAuth: [] }] : undefined;

    // Add 401/403 responses
    const authResponses = {
      401: {
        description: 'Unauthorized - Authentication required',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(false),
              error: z.object({
                code: z.literal('UNAUTHORIZED'),
                message: z.string(),
              }),
            }),
          },
        },
      },
      403: {
        description: 'Forbidden - Insufficient permissions',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(false),
              error: z.object({
                code: z.literal('FORBIDDEN'),
                message: z.string(),
              }),
            }),
          },
        },
      },
    };

    return {
      ...baseSchema,
      security,
      responses: {
        ...baseSchema.responses,
        ...(this.requiresAuth ? authResponses : {}),
      },
    };
  }
}

// ============================================================================
// withAuth Mixin
// ============================================================================

/**
 * Mixin that adds authentication capabilities to any endpoint class.
 * Preferred approach as it works with existing endpoints.
 *
 * @example
 * ```ts
 * class UserCreate extends withAuth(MemoryCreateEndpoint) {
 *   _meta = { model: UserModel };
 *   requiresAuth = true;
 *   requiredRoles = ['admin'];
 *
 *   async before(data: UserData) {
 *     // Access user via this.getUser()
 *     const creator = this.getUserId();
 *     return { ...data, createdBy: creator };
 *   }
 * }
 * ```
 */
export function withAuth<TBase extends Constructor<OpenAPIRoute>>(
  Base: TBase
): TBase & Constructor<EndpointAuthConfig & AuthEndpointMethods> {
  // @ts-expect-error - TS mixin limitation: cannot access protected members of generic base class (TS#17744)
  class AuthenticatedRoute extends Base implements EndpointAuthConfig {
    /**
     * Whether authentication is required for this endpoint.
     * @default true
     */
    requiresAuth: boolean = true;

    /**
     * Required roles (user must have at least one).
     */
    requiredRoles?: string[];

    /**
     * Required permissions (user must have all).
     */
    requiredPermissions?: string[];

    /**
     * Whether all roles are required (AND logic) vs any role (OR logic).
     * @default false (OR logic)
     */
    requireAllRoles: boolean = false;

    /**
     * Custom authorization check.
     * Return true to allow, false to deny.
     */
    async authorize(_user: AuthUser, _ctx: Context): Promise<boolean> {
      return true;
    }

    // ============================================================================
    // User Access Methods
    // ============================================================================

    /**
     * Gets the authenticated user.
     * Throws UnauthorizedException if not authenticated.
     */
    getUser(): AuthUser {
      const ctx = this.getContext() as Context<AuthEnv>;
      const user = ctx.var.user;
      if (!user) {
        throw new UnauthorizedException('Authentication required');
      }
      return user;
    }

    /**
     * Gets the authenticated user or undefined.
     */
    getUserOrNull(): AuthUser | undefined {
      const ctx = this.getContext() as Context<AuthEnv>;
      return ctx.var.user;
    }

    /**
     * Gets the authenticated user's ID.
     * Throws UnauthorizedException if not authenticated.
     */
    getUserId(): string {
      return this.getUser().id;
    }

    /**
     * Gets the authenticated user's ID or undefined.
     */
    getUserIdOrNull(): string | undefined {
      return this.getUserOrNull()?.id;
    }

    /**
     * Gets the authenticated user's roles.
     */
    getUserRoles(): string[] {
      return this.getUser().roles || [];
    }

    /**
     * Gets the authenticated user's permissions.
     */
    getUserPermissions(): string[] {
      return this.getUser().permissions || [];
    }

    // ============================================================================
    // Role/Permission Check Methods
    // ============================================================================

    /**
     * Checks if the user has a specific role.
     */
    hasRole(role: string): boolean {
      const user = this.getUserOrNull();
      if (!user) return false;
      return (user.roles || []).includes(role);
    }

    /**
     * Checks if the user has any of the specified roles.
     */
    hasAnyRole(...roles: string[]): boolean {
      const userRoles = this.getUserOrNull()?.roles || [];
      return roles.some((role) => userRoles.includes(role));
    }

    /**
     * Checks if the user has all of the specified roles.
     */
    hasAllRoles(...roles: string[]): boolean {
      const userRoles = this.getUserOrNull()?.roles || [];
      return roles.every((role) => userRoles.includes(role));
    }

    /**
     * Checks if the user has a specific permission.
     */
    hasPermission(permission: string): boolean {
      const user = this.getUserOrNull();
      if (!user) return false;
      return (user.permissions || []).includes(permission);
    }

    /**
     * Checks if the user has all of the specified permissions.
     */
    hasAllPermissions(...permissions: string[]): boolean {
      const userPermissions = this.getUserOrNull()?.permissions || [];
      return permissions.every((perm) => userPermissions.includes(perm));
    }

    /**
     * Checks if the user has any of the specified permissions.
     */
    hasAnyPermission(...permissions: string[]): boolean {
      const userPermissions = this.getUserOrNull()?.permissions || [];
      return permissions.some((perm) => userPermissions.includes(perm));
    }

    // ============================================================================
    // Authorization Enforcement
    // ============================================================================

    /**
     * Enforces authentication and authorization requirements.
     * Call this at the beginning of your handle() method or before() hook.
     */
    async enforceAuth(): Promise<void> {
      const ctx = this.getContext() as Context<AuthEnv>;

      // Check authentication
      if (this.requiresAuth) {
        if (!ctx.var.user) {
          throw new UnauthorizedException('Authentication required');
        }
      }

      const user = ctx.var.user;
      if (!user) {
        return; // No auth required and no user - allow access
      }

      // Check roles
      if (this.requiredRoles && this.requiredRoles.length > 0) {
        const userRoles = user.roles || [];

        if (this.requireAllRoles) {
          const hasAllRoles = this.requiredRoles.every((role) => userRoles.includes(role));
          if (!hasAllRoles) {
            throw new ForbiddenException(
              `Required roles: ${this.requiredRoles.join(' and ')}`
            );
          }
        } else {
          const hasAnyRole = this.requiredRoles.some((role) => userRoles.includes(role));
          if (!hasAnyRole) {
            throw new ForbiddenException(
              `Required role: ${this.requiredRoles.join(' or ')}`
            );
          }
        }
      }

      // Check permissions
      if (this.requiredPermissions && this.requiredPermissions.length > 0) {
        const userPermissions = user.permissions || [];
        const hasAllPermissions = this.requiredPermissions.every((perm) =>
          userPermissions.includes(perm)
        );
        if (!hasAllPermissions) {
          throw new ForbiddenException(
            `Required permissions: ${this.requiredPermissions.join(', ')}`
          );
        }
      }

      // Custom authorization
      const isAuthorized = await this.authorize(user, ctx);
      if (!isAuthorized) {
        throw new ForbiddenException('Access denied');
      }
    }

    // ============================================================================
    // Schema Enhancement
    // ============================================================================

    /**
     * Enhanced getSchema that adds auth-related responses.
     */
    getSchema(): OpenAPIRouteSchema {
      const baseSchema = super.getSchema();

      // Add security scheme if auth is required
      const security = this.requiresAuth ? [{ bearerAuth: [] }] : undefined;

      // Add 401/403 responses
      const authResponses = {
        401: {
          description: 'Unauthorized - Authentication required',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.literal('UNAUTHORIZED'),
                  message: z.string(),
                }),
              }),
            },
          },
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.literal('FORBIDDEN'),
                  message: z.string(),
                }),
              }),
            },
          },
        },
      };

      return {
        ...baseSchema,
        security,
        responses: {
          ...baseSchema.responses,
          ...(this.requiresAuth ? authResponses : {}),
        },
      };
    }
  }

  return AuthenticatedRoute as unknown as TBase & Constructor<EndpointAuthConfig & AuthEndpointMethods>;
}
