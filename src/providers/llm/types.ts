import type { z, ZodTypeAny } from 'zod';

export interface GenerateStructuredOptions<S extends ZodTypeAny> {
  systemPrompt: string;
  userPrompt: string;
  schema: S;
  /**
   * Hint for providers that need a schema name (OpenAI's json_schema format
   * requires one). Defaults to "output" if a provider needs one and none given.
   */
  schemaName?: string;
  /** Soft ceiling on output tokens; provider may interpret loosely. */
  maxTokens?: number;
}

export interface LLMProvider {
  /** Single-shot structured generation. Retry/feedback lives at the call layer. */
  generateStructured<S extends ZodTypeAny>(opts: GenerateStructuredOptions<S>): Promise<z.infer<S>>;
}

export class LLMProviderError extends Error {
  override readonly name = 'LLMProviderError';
  constructor(
    message: string,
    readonly providerName: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}
