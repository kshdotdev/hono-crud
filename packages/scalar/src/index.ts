import { apiReference } from '@scalar/hono-api-reference';
import type { ApiReferenceConfiguration } from '@scalar/hono-api-reference';
import type { Env, Hono, MiddlewareHandler } from 'hono';

/**
 * Available Scalar themes.
 *
 * Derived from the upstream `ApiReferenceConfiguration['theme']` enum so the
 * set stays in lockstep with `@scalar/hono-api-reference` instead of drifting
 * from a hand-maintained copy on every Scalar version bump.
 */
export type ScalarTheme = NonNullable<ApiReferenceConfiguration['theme']>;

/**
 * Configuration options for Scalar API Reference.
 */
export interface ScalarConfig {
  /**
   * URL to the OpenAPI spec file.
   * @default '/openapi.json'
   */
  specUrl?: string;

  /**
   * OpenAPI spec content (alternative to specUrl).
   * Can be a string, object, or function returning an object.
   */
  content?: string | Record<string, unknown> | (() => Record<string, unknown>);

  /**
   * Theme for the API reference UI.
   * @default 'default'
   */
  theme?: ScalarTheme;

  /**
   * Page title for the API reference.
   */
  pageTitle?: string;

  /**
   * Whether to show the sidebar.
   * @default true
   */
  showSidebar?: boolean;

  /**
   * Base server URL for try-it-out.
   */
  baseServerURL?: string;

  /**
   * Layout style.
   * @default 'modern'
   */
  layout?: 'modern' | 'classic';

  /**
   * Whether to hide the client button.
   * @default false
   */
  hideClientButton?: boolean;

  /**
   * CDN URL for Scalar assets.
   */
  cdn?: string;
}

/**
 * Creates a Scalar API Reference middleware handler.
 * Use this to add modern, interactive API documentation to your Hono app.
 *
 * @param config - Configuration options for Scalar
 * @returns Hono middleware handler
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { scalarUI } from 'hono-crud';
 *
 * const app = new Hono();
 *
 * // Basic usage
 * app.get('/reference', scalarUI());
 *
 * // With custom configuration
 * app.get('/reference', scalarUI({
 *   specUrl: '/openapi.json',
 *   theme: 'purple',
 *   pageTitle: 'My API Reference',
 * }));
 * ```
 */
export function scalarUI(config: ScalarConfig = {}): MiddlewareHandler {
  const {
    specUrl = '/openapi.json',
    content,
    theme = 'default',
    pageTitle,
    showSidebar = true,
    baseServerURL,
    layout = 'modern',
    hideClientButton = false,
    cdn,
  } = config;

  // Build configuration matching Scalar's expected format.
  //
  // `apiReference()` types its parameter as `Partial<ApiReferenceConfiguration>`,
  // but Scalar's HTML renderer additionally reads `pageTitle` and `cdn` (declared
  // on `HtmlRenderingConfiguration`, which `@scalar/hono-api-reference` does not
  // re-export). Model those two render-only options locally so every assignment
  // below stays type-checked instead of escaping through `as Record<string, unknown>`.
  type ScalarRenderConfig = Partial<ApiReferenceConfiguration> & {
    pageTitle?: string;
    cdn?: string;
  };

  const scalarConfig: ScalarRenderConfig = {
    theme,
    showSidebar,
    layout,
    hideClientButton,
  };

  // Add URL or content for the spec
  if (content) {
    scalarConfig.content = content;
  } else {
    scalarConfig.url = specUrl;
  }

  // Add optional properties
  if (pageTitle) {
    scalarConfig.pageTitle = pageTitle;
  }
  if (baseServerURL) {
    scalarConfig.baseServerURL = baseServerURL;
  }
  if (cdn) {
    scalarConfig.cdn = cdn;
  }

  return apiReference(scalarConfig);
}

/**
 * Sets up Scalar API Reference endpoint on a Hono app.
 *
 * @param app - Hono app instance
 * @param path - Path to serve the API reference (default: '/reference')
 * @param config - Scalar configuration options
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { setupScalar } from 'hono-crud';
 *
 * const app = new Hono();
 *
 * setupScalar(app, '/reference', {
 *   specUrl: '/openapi.json',
 *   theme: 'moon',
 * });
 * ```
 */
export function setupScalar<E extends Env>(
  app: Hono<E>,
  path = '/reference',
  config: ScalarConfig = {},
): void {
  app.get(path, scalarUI(config));
}
