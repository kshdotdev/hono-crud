import { z } from 'zod';
import type { Env } from 'hono';
import { OpenAPIRoute } from '../../core/route';
import type { MetaInput, OpenAPIRouteSchema } from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import { resolveAIModel } from '../provider';
import type { AIConfig, AISecurityConfig, RAGConfig } from '../types';
import { detectInjection } from '../security/injection';
import { redactPIIFromRecords } from '../security/pii';
import { getAIAuditStorage } from '../security/audit';
import type { AIAuditLogEntry } from '../security/types';
import { generateRequestId } from '../../logging/utils';
import { buildRecordContext } from './context-builder';
import { buildRAGSystemPrompt } from './prompt';

/**
 * Base endpoint for RAG (Retrieval-Augmented Generation).
 * Retrieves relevant records, builds context, and generates an AI answer.
 *
 * Extend this class and implement the abstract `retrieve()` method.
 *
 * @example
 * ```ts
 * class UserRAG extends MemoryRAGEndpoint {
 *   _meta = userMeta;
 *   schema = { tags: ['Users'], summary: 'Ask questions about users' };
 *   protected ragConfig = { contextFields: ['name', 'role', 'department'] };
 * }
 * ```
 */
export abstract class RAGEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  // ============================================================================
  // Configuration
  // ============================================================================

  /** RAG-specific configuration */
  protected ragConfig: RAGConfig = {};

  /** Maximum length of the question (characters) */
  protected maxQuestionLength: number = 500;

  /** Additional domain context for the AI prompt */
  protected domainContext?: string;

  /** Per-endpoint AI configuration overrides */
  protected aiConfig?: AIConfig;

  /** Security configuration for injection detection, PII redaction, and audit logging */
  protected securityConfig?: AISecurityConfig;

  // ============================================================================
  // Lifecycle Hooks
  // ============================================================================

  /**
   * Called before retrieving records.
   * Override to modify or validate the question.
   */
  protected async beforeRetrieve(question: string): Promise<string> {
    return question;
  }

  /**
   * Called after records are retrieved.
   * Override to filter, transform, or augment the records.
   */
  protected async afterRetrieve(
    records: ModelObject<M['model']>[]
  ): Promise<ModelObject<M['model']>[]> {
    return records;
  }

  /**
   * Called after the AI generates an answer.
   * Override to transform the answer.
   */
  protected async afterGenerate(answer: string): Promise<string> {
    return answer;
  }

  // ============================================================================
  // Abstract Methods
  // ============================================================================

  /**
   * Retrieve records relevant to the question.
   * Implemented by adapter-specific subclasses.
   */
  abstract retrieve(question: string): Promise<ModelObject<M['model']>[]>;

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
                question: z.string().min(1).describe('Question about the data'),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'AI-generated answer',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.object({
                  answer: z.string(),
                  sources: z.array(z.record(z.string(), z.unknown())),
                  retrieval_info: z.object({
                    total_records: z.number(),
                    records_used: z.number(),
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
    const { body } = await this.getValidatedData<{ question: string }>();

    if (!body?.question) {
      return this.error('Question is required', 'MISSING_QUESTION', 400);
    }

    if (body.question.length > this.maxQuestionLength) {
      return this.error(
        `Question exceeds maximum length of ${this.maxQuestionLength} characters`,
        'QUESTION_TOO_LONG',
        400
      );
    }

    // Injection detection
    if (this.securityConfig?.injection?.disabled !== true) {
      const injectionResult = detectInjection(body.question, this.securityConfig?.injection);
      if (injectionResult.flagged) {
        const action = this.securityConfig?.injection?.action ?? 'block';
        if (action === 'block') {
          this.auditLog({
            endpoint: 'rag',
            input: body.question,
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

    // Phase 1: Retrieve
    const question = await this.beforeRetrieve(body.question);
    let records = await this.retrieve(question);
    records = await this.afterRetrieve(records);

    // Limit records for context
    const maxRecords = this.ragConfig.maxContextRecords ?? 50;
    const totalRecords = records.length;
    const contextRecords = records.slice(0, maxRecords);

    // Phase 2: PII Redaction + Generate
    const piiEnabled = this.securityConfig?.piiRedactionEnabled !== false;
    const recordsAsObjects = contextRecords as unknown as Record<string, unknown>[];
    const redactedRecords = piiEnabled
      ? redactPIIFromRecords(recordsAsObjects, this.securityConfig?.piiPatterns)
      : recordsAsObjects;

    const context = buildRecordContext(redactedRecords, {
      contextFields: this.ragConfig.contextFields,
      maxContextLength: this.ragConfig.maxContextLength ?? 8000,
    });

    let answer: string;
    try {
      answer = await this.generateAnswer(question, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI generation failed';
      this.auditLog({
        endpoint: 'rag',
        input: body.question,
        status: 'error',
        durationMs: Date.now() - startTime,
        recordCount: contextRecords.length,
        errorCode: 'GENERATION_ERROR',
        errorMessage: message,
      });
      return this.error(message, 'GENERATION_ERROR', 500);
    }

    answer = await this.afterGenerate(answer);

    // Build response — use redacted records as sources to prevent PII leaking
    const result: Record<string, unknown> = {
      answer,
      sources: redactedRecords,
    };

    if (this.ragConfig.includeRetrievalInfo) {
      result.retrieval_info = {
        total_records: totalRecords,
        records_used: contextRecords.length,
      };
    }

    // Audit log success
    this.auditLog({
      endpoint: 'rag',
      input: body.question,
      status: 'success',
      durationMs: Date.now() - startTime,
      recordCount: contextRecords.length,
    });

    return this.json({
      success: true,
      result,
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
  // AI Generation
  // ============================================================================

  /**
   * Call the Vercel AI SDK to generate an answer from the context.
   */
  private async generateAnswer(
    question: string,
    context: string
  ): Promise<string> {
    // Lazy import the AI SDK (optional peer dependency)
    const { generateText } = await import('ai').catch(() => {
      throw new Error(
        'The "ai" package is required for RAG. Install it with: npm install ai'
      );
    });

    const ctx = this.context as unknown as { get: (key: string) => unknown } | null;
    const model = resolveAIModel(ctx, this.aiConfig?.model);

    const systemPrompt = buildRAGSystemPrompt(this.domainContext);

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: `Data context:\n${context}\n\nQuestion: ${question}`,
      temperature: this.aiConfig?.temperature ?? 0.3,
      maxTokens: this.aiConfig?.maxTokens,
    });

    return result.text;
  }
}
