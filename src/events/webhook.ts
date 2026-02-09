import type { CrudEventPayload, CrudEventListener } from './types';
import { getEventEmitter, type CrudEventEmitter } from './emitter';

/**
 * Webhook endpoint configuration.
 */
export interface WebhookEndpoint {
  /** The URL to send webhook events to */
  url: string;
  /** Optional secret for HMAC signing */
  secret?: string;
  /** Events to subscribe to. If empty, receives all events. */
  events?: Array<`${string}:${'created' | 'updated' | 'deleted' | 'restored'}` | '*'>;
  /** Custom headers to include with each request */
  headers?: Record<string, string>;
  /** Timeout in milliseconds. @default 10000 */
  timeout?: number;
  /** Number of retry attempts on failure. @default 2 */
  retries?: number;
}

/**
 * Options for the webhook delivery system.
 */
export interface WebhookConfig {
  /** Webhook endpoints to deliver events to */
  endpoints: WebhookEndpoint[];
  /** Event emitter to subscribe to. Uses global emitter if not provided. */
  emitter?: CrudEventEmitter;
  /** Callback for delivery failures */
  onError?: (endpoint: WebhookEndpoint, event: CrudEventPayload, error: Error) => void;
}

/**
 * Result of a webhook delivery attempt.
 */
export interface WebhookDeliveryResult {
  url: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  attempts: number;
}

/**
 * Sign a payload using HMAC-SHA256 (Web Crypto API, edge-safe).
 */
async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check if an event matches a webhook endpoint's subscription filter.
 */
function matchesFilter(
  event: CrudEventPayload,
  filters?: WebhookEndpoint['events']
): boolean {
  if (!filters || filters.length === 0) return true;
  const eventKey = `${event.table}:${event.type}`;
  return filters.some((f) => f === '*' || f === eventKey);
}

/**
 * Deliver a webhook event to a single endpoint with retries.
 */
async function deliverToEndpoint(
  endpoint: WebhookEndpoint,
  event: CrudEventPayload
): Promise<WebhookDeliveryResult> {
  const timeout = endpoint.timeout ?? 10000;
  const maxRetries = endpoint.retries ?? 2;
  const body = JSON.stringify(event);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Event': `${event.table}.${event.type}`,
    'X-Webhook-Timestamp': event.timestamp,
    ...(endpoint.headers ?? {}),
  };

  // Add HMAC signature if secret is configured
  if (endpoint.secret) {
    const signature = await signPayload(body, endpoint.secret);
    headers['X-Webhook-Signature'] = `sha256=${signature}`;
  }

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return {
          url: endpoint.url,
          success: true,
          statusCode: response.status,
          attempts: attempt + 1,
        };
      }

      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    // Wait before retry (exponential backoff: 1s, 2s, 4s...)
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }

  return {
    url: endpoint.url,
    success: false,
    error: lastError?.message,
    attempts: maxRetries + 1,
  };
}

/**
 * Create a webhook delivery listener that sends events to configured endpoints.
 * Returns an unsubscribe function.
 *
 * @example
 * ```ts
 * import { registerWebhooks, getEventEmitter } from 'hono-crud';
 *
 * const unsubscribe = registerWebhooks({
 *   endpoints: [
 *     {
 *       url: 'https://hooks.example.com/crud',
 *       secret: 'whsec_...',
 *       events: ['users:created', 'users:updated'],
 *     },
 *   ],
 *   onError: (endpoint, event, error) => {
 *     console.error(`Webhook delivery failed to ${endpoint.url}:`, error);
 *   },
 * });
 *
 * // Later: stop delivering webhooks
 * unsubscribe();
 * ```
 */
export function registerWebhooks(config: WebhookConfig): () => void {
  const emitter = config.emitter ?? getEventEmitter();

  const listener: CrudEventListener = (event) => {
    for (const endpoint of config.endpoints) {
      if (!matchesFilter(event, endpoint.events)) continue;

      // Fire and forget delivery
      deliverToEndpoint(endpoint, event).then((result) => {
        if (!result.success && config.onError) {
          config.onError(
            endpoint,
            event,
            new Error(result.error ?? 'Unknown delivery error')
          );
        }
      }).catch((err) => {
        if (config.onError) {
          config.onError(
            endpoint,
            event,
            err instanceof Error ? err : new Error(String(err))
          );
        }
      });
    }
  };

  const sub = emitter.onAny(listener);
  return () => sub.unsubscribe();
}
