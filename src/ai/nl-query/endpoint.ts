import { z } from 'zod';
import type { Env } from 'hono';
import { OpenAPIRoute } from '../../core/route';
import type {
  MetaInput,
  FilterOperator,
  FilterCondition,
  PaginatedResult,
  OpenAPIRouteSchema,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import { resolveAIModel } from '../provider';
import type { AIConfig, AISecurityConfig, NLTranslationResult, ValidatedNLFilters } from '../types';
import { detectInjection } from '../security/injection';
import { getAIAuditStorage } from '../security/audit';
import type { AIAuditLogEntry } from '../security/types';
import { generateRequestId } from '../../logging/utils';
import { buildFieldDescriptions } from './parser';
import { buildNLQuerySystemPrompt } from './prompt';

/**
 * Base endpoint for natural language queries.
 * Converts natural language into structured filters, then delegates to the
 * adapter's `list()` implementation.
 *
 * Extend this class and implement the abstract `list()` method.
 *
 * @example
 * ```ts
 * class UserNLQuery extends MemoryNLQueryEndpoint {
 *   _meta = userMeta;
 *   schema = { tags: ['Users'], summary: 'Query users with natural language' };
 *   filterFields = ['role', 'department'];
 *   filterConfig = { createdAt: ['gte', 'lte', 'between'] };
 *   minConfidence = 0.6;
 * }
 * ```
 */
export abstract class NLQueryEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  // ============================================================================
  // Configuration
  // ============================================================================

  /** Fields that can be used for simple equality filtering */
  protected filterFields: string[] = [];

  /** Per-field operator configuration */
  protected filterConfig?: Record<string, FilterOperator[]>;

  /** Fields that can be used for sorting */
  protected sortFields: string[] = [];

  /** Minimum AI confidence to execute the query (0-1) */
  protected minConfidence: number = 0.5;

  /** Maximum length of the natural language query (characters) */
  protected maxQueryLength: number = 500;

  /** Additional domain context for the AI prompt */
  protected domainContext?: string;

  /** Per-endpoint AI configuration overrides */
  protected aiConfig?: AIConfig;

  /** Security configuration for injection detection and audit logging */
  protected securityConfig?: AISecurityConfig;

  /** Default pagination settings */
  protected defaultPerPage: number = 20;
  protected maxPerPage: number = 100;

  // ============================================================================
  // Lifecycle Hooks
  // ============================================================================

  /**
   * Called before the query is sent to the AI for translation.
   * Override to modify or validate the query.
   */
  protected async beforeTranslate(query: string): Promise<string> {
    return query;
  }

  /**
   * Called after the AI returns the translation result.
   * Override to modify or validate the result.
   */
  protected async afterTranslate(result: NLTranslationResult): Promise<NLTranslationResult> {
    return result;
  }

  // ============================================================================
  // Abstract Methods
  // ============================================================================

  /**
   * Execute the list query with the validated filters.
   * Implemented by adapter-specific subclasses.
   */
  abstract list(
    filters: FilterCondition[],
    sort: { field: string; direction: 'asc' | 'desc' } | undefined,
    page: number,
    perPage: number
  ): Promise<PaginatedResult<ModelObject<M['model']>>>;

  // ============================================================================
  // Schema
  // ============================================================================

  getSchema(): OpenAPIRouteSchema {
    return {
      ...this.schema,
      request: {
        body: {
          content: {
            'application/json': {
              schema: z.object({
                query: z.string().min(1).describe('Natural language query'),
                page: z.number().int().positive().optional().describe('Page number'),
                per_page: z.number().int().positive().optional().describe('Items per page'),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Query results',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.array(this._meta.model.schema),
                result_info: z.object({
                  page: z.number(),
                  per_page: z.number(),
                  total_count: z.number().optional(),
                  total_pages: z.number().optional(),
                  has_next_page: z.boolean(),
                  has_prev_page: z.boolean(),
                }),
                query_info: z.object({
                  original_query: z.string(),
                  interpretation: z.string(),
                  confidence: z.number(),
                  applied_filters: z.array(z.object({
                    field: z.string(),
                    operator: z.string(),
                    value: z.unknown(),
                  })),
                  applied_sort: z.object({
                    field: z.string(),
                    direction: z.enum(['asc', 'desc']),
                  }).optional(),
                }),
              }),
            },
          },
        },
        422: {
          description: 'Low confidence translation',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                  details: z.object({
                    confidence: z.number(),
                    interpretation: z.string(),
                  }).optional(),
                }),
              }),
            },
          },
        },
      },
    };
  }

  // ============================================================================
  // Handler
  // ============================================================================

  async handle(): Promise<Response> {
    const startTime = Date.now();
    const { body } = await this.getValidatedData<{
      query: string;
      page?: number;
      per_page?: number;
    }>();

    if (!body?.query) {
      return this.error('Query is required', 'MISSING_QUERY', 400);
    }

    // Validate query length
    if (body.query.length > this.maxQueryLength) {
      return this.error(
        `Query exceeds maximum length of ${this.maxQueryLength} characters`,
        'QUERY_TOO_LONG',
        400
      );
    }

    // Injection detection
    if (this.securityConfig?.injection?.disabled !== true) {
      const injectionResult = detectInjection(body.query, this.securityConfig?.injection);
      if (injectionResult.flagged) {
        const action = this.securityConfig?.injection?.action ?? 'block';
        if (action === 'block') {
          this.auditLog({
            endpoint: 'nl-query',
            input: body.query,
            status: 'blocked',
            durationMs: Date.now() - startTime,
            injectionDetected: true,
            injectionScore: injectionResult.riskScore,
          });
          return this.error('Query rejected by security filter', 'INJECTION_DETECTED', 400);
        }
        // action === 'warn': log but continue
      }
    }

    const page = body.page ?? 1;
    const perPage = Math.min(body.per_page ?? this.defaultPerPage, this.maxPerPage);

    // Run beforeTranslate hook
    const query = await this.beforeTranslate(body.query);

    // Build field descriptions for the AI prompt
    const fieldDescriptions = buildFieldDescriptions(
      this._meta.model.schema,
      this.filterFields,
      this.filterConfig,
      this.sortFields
    );

    // Build the system prompt
    const systemPrompt = buildNLQuerySystemPrompt(
      fieldDescriptions,
      this.sortFields,
      this.domainContext
    );

    // Call the AI to translate the query
    let translation: NLTranslationResult;
    try {
      translation = await this.translateQuery(query, systemPrompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI translation failed';
      this.auditLog({
        endpoint: 'nl-query',
        input: body.query,
        status: 'error',
        durationMs: Date.now() - startTime,
        errorCode: 'TRANSLATION_ERROR',
        errorMessage: message,
      });
      return this.error(message, 'TRANSLATION_ERROR', 500);
    }

    // Run afterTranslate hook
    translation = await this.afterTranslate(translation);

    // Check confidence threshold
    if (translation.confidence < this.minConfidence) {
      this.auditLog({
        endpoint: 'nl-query',
        input: body.query,
        status: 'error',
        durationMs: Date.now() - startTime,
        confidence: translation.confidence,
        interpretation: translation.interpretation,
        errorCode: 'LOW_CONFIDENCE',
      });
      return this.json({
        success: false,
        error: {
          code: 'LOW_CONFIDENCE',
          message: 'The AI could not confidently interpret the query. Please rephrase.',
          details: {
            confidence: translation.confidence,
            interpretation: translation.interpretation,
          },
        },
      }, 422);
    }

    // Validate and sanitize the AI-generated filters
    const validated = this.validateFilters(translation);

    // Execute the query
    const paginatedResult = await this.list(
      validated.filters,
      validated.sort,
      page,
      perPage
    );

    // Audit log success
    this.auditLog({
      endpoint: 'nl-query',
      input: body.query,
      status: 'success',
      durationMs: Date.now() - startTime,
      confidence: translation.confidence,
      interpretation: translation.interpretation,
    });

    return this.json({
      success: true,
      result: paginatedResult.result,
      result_info: paginatedResult.result_info,
      query_info: {
        original_query: body.query,
        interpretation: translation.interpretation,
        confidence: translation.confidence,
        applied_filters: validated.filters,
        applied_sort: validated.sort,
      },
    });
  }

  // ============================================================================
  // Audit Logging
  // ============================================================================

  private auditLog(partial: Omit<AIAuditLogEntry, 'id' | 'timestamp'>): void {
    const storage = getAIAuditStorage();
    if (!storage) return;
    const entry: AIAuditLogEntry = {
      id: generateRequestId(),
      timestamp: new Date().toISOString(),
      ...partial,
    };
    this.runAfterResponse(storage.store(entry));
  }

  // ============================================================================
  // AI Translation
  // ============================================================================

  /**
   * Call the Vercel AI SDK to translate the natural language query.
   */
  private async translateQuery(
    query: string,
    systemPrompt: string
  ): Promise<NLTranslationResult> {
    // Lazy import the AI SDK (optional peer dependency)
    const { generateObject } = await import('ai').catch(() => {
      throw new Error(
        'The "ai" package is required for NL queries. Install it with: npm install ai'
      );
    });

    const ctx = this.context as unknown as { get: (key: string) => unknown } | null;
    const model = resolveAIModel(ctx, this.aiConfig?.model);

    // Define the output schema for structured generation
    const outputSchema = z.object({
      filters: z.array(z.object({
        field: z.string(),
        operator: z.string(),
        value: z.unknown(),
      })),
      sort: z.object({
        field: z.string(),
        direction: z.enum(['asc', 'desc']),
      }).optional(),
      confidence: z.number().min(0).max(1),
      interpretation: z.string(),
    });

    const result = await generateObject({
      model,
      system: systemPrompt,
      prompt: query,
      schema: outputSchema,
      temperature: this.aiConfig?.temperature ?? 0.1,
      maxTokens: this.aiConfig?.maxTokens,
    });

    return result.object as NLTranslationResult;
  }

  // ============================================================================
  // Filter Validation (Security Boundary)
  // ============================================================================

  /**
   * Validate AI-generated filters against the configured allowed fields and operators.
   * This prevents the AI from hallucinating fields or operators that would be
   * passed to the database.
   */
  private validateFilters(translation: NLTranslationResult): ValidatedNLFilters {
    const allowedFields = this.buildAllowedFieldsMap();
    const validatedFilters: FilterCondition[] = [];

    for (const filter of translation.filters) {
      const allowedOps = allowedFields.get(filter.field);
      if (!allowedOps) continue; // Field not allowed, skip

      const operator = filter.operator as FilterOperator;
      if (!allowedOps.includes(operator)) continue; // Operator not allowed, skip

      validatedFilters.push({
        field: filter.field,
        operator,
        value: filter.value,
      });
    }

    // Validate sort field
    let validatedSort: ValidatedNLFilters['sort'];
    if (translation.sort && this.sortFields.includes(translation.sort.field)) {
      validatedSort = translation.sort;
    }

    return {
      filters: validatedFilters,
      sort: validatedSort,
    };
  }

  /**
   * Build a map of field name -> allowed operators for validation.
   */
  private buildAllowedFieldsMap(): Map<string, FilterOperator[]> {
    const map = new Map<string, FilterOperator[]>();

    // Add simple filter fields (equality only)
    for (const field of this.filterFields) {
      const existing = map.get(field) || [];
      if (!existing.includes('eq')) {
        existing.push('eq');
      }
      map.set(field, existing);
    }

    // Add operator-configured fields
    if (this.filterConfig) {
      for (const [field, operators] of Object.entries(this.filterConfig)) {
        const existing = map.get(field) || [];
        for (const op of operators) {
          if (!existing.includes(op)) {
            existing.push(op);
          }
        }
        // Also allow eq for configured fields
        if (!existing.includes('eq')) {
          existing.push('eq');
        }
        map.set(field, existing);
      }
    }

    return map;
  }
}
