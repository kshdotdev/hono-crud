/**
 * Minimal type declarations for the `ai` package (Vercel AI SDK).
 * This is an optional peer dependency — these declarations allow
 * TypeScript to resolve the dynamic import without requiring the
 * package to be installed.
 */
declare module 'ai' {
  export function generateObject(options: {
    model: unknown;
    system?: string;
    prompt: string;
    schema: unknown;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ object: unknown }>;

  export function generateText(options: {
    model: unknown;
    system?: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string }>;
}
