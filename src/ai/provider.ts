import type { AILanguageModel } from './types';

// ============================================================================
// Global AI Model Registry
// ============================================================================

let globalAIModel: AILanguageModel | null = null;

/**
 * Set the global AI model instance.
 * Users typically call this once at app startup with a Vercel AI SDK model.
 *
 * @example
 * ```ts
 * import { openai } from '@ai-sdk/openai';
 * import { setAIModel } from 'hono-crud/ai';
 *
 * setAIModel(openai('gpt-4o-mini'));
 * ```
 */
export function setAIModel(model: AILanguageModel): void {
  validateAIModel(model);
  globalAIModel = model;
}

/**
 * Get the global AI model instance.
 * Returns null if no model has been set.
 */
export function getAIModel(): AILanguageModel | null {
  return globalAIModel;
}

/**
 * Resolve the AI model from multiple sources in priority order:
 * 1. Explicit model passed as parameter
 * 2. Hono context variable (`c.get('aiModel')`)
 * 3. Global registry (set via `setAIModel()`)
 *
 * Throws if no model is found.
 */
export function resolveAIModel(
  ctx?: { get: (key: string) => unknown } | null,
  explicitModel?: AILanguageModel
): AILanguageModel {
  // 1. Explicit model takes priority
  if (explicitModel) {
    return explicitModel;
  }

  // 2. Check Hono context
  if (ctx) {
    const contextModel = ctx.get('aiModel');
    if (contextModel && isAIModel(contextModel)) {
      return contextModel;
    }
  }

  // 3. Fall back to global registry
  if (globalAIModel) {
    return globalAIModel;
  }

  throw new Error(
    'No AI model configured. Call setAIModel() or set the "aiModel" context variable. ' +
    'Example: import { openai } from "@ai-sdk/openai"; setAIModel(openai("gpt-4o-mini"));'
  );
}

/**
 * Duck-type check for a Vercel AI SDK LanguageModel.
 */
function isAIModel(value: unknown): value is AILanguageModel {
  return (
    typeof value === 'object' &&
    value !== null &&
    'modelId' in value &&
    'provider' in value &&
    typeof (value as AILanguageModel).modelId === 'string' &&
    typeof (value as AILanguageModel).provider === 'string'
  );
}

/**
 * Validate that the provided value looks like a Vercel AI SDK model.
 * Throws with a helpful error message if not.
 */
export function validateAIModel(model: unknown): asserts model is AILanguageModel {
  if (!isAIModel(model)) {
    throw new Error(
      'Invalid AI model. Expected a Vercel AI SDK LanguageModel with "modelId" and "provider" properties. ' +
      'Example: import { openai } from "@ai-sdk/openai"; setAIModel(openai("gpt-4o-mini"));'
    );
  }
}
