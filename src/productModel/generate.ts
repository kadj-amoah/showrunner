import { productModelSchema, type ProductModel } from './schema.js';
import { logger } from '../util/logger.js';
import {
  PRODUCT_MODEL_SYSTEM_PROMPT,
  renderProductModelDocPrompt,
  renderProductModelInteractivePrompt,
  type DocSource,
  type InteractiveAnswers,
} from './prompts.js';
import type { LLMProvider } from '../providers/llm/types.js';
import { generateWithRetry } from '../providers/llm/withRetry.js';

const DEFAULT_MAX_TOKENS = 8000;

export class ProductModelGenerationError extends Error {
  override readonly name = 'ProductModelGenerationError';
}

export interface GenerateFromDocsOptions {
  sources: DocSource[];
  provider: LLMProvider;
}

export interface GenerateFromInteractiveOptions {
  answers: InteractiveAnswers;
  provider: LLMProvider;
}

export async function generateProductModelFromDocs(
  opts: GenerateFromDocsOptions,
): Promise<ProductModel> {
  if (opts.sources.length === 0) {
    throw new ProductModelGenerationError(
      'No source documents provided. Add entries under `comprehension.sources` in demo.yaml.',
    );
  }
  const userPrompt = renderProductModelDocPrompt(opts.sources);
  return callProvider(opts.provider, userPrompt, 'documents');
}

export async function generateProductModelFromInteractive(
  opts: GenerateFromInteractiveOptions,
): Promise<ProductModel> {
  const userPrompt = renderProductModelInteractivePrompt(opts.answers);
  return callProvider(opts.provider, userPrompt, 'interactive');
}

async function callProvider(
  provider: LLMProvider,
  userPrompt: string,
  sourceTag: 'documents' | 'interactive',
): Promise<ProductModel> {
  logger.debug('Generating product_model via LLM provider', { source: sourceTag });
  try {
    return await generateWithRetry(provider, {
      systemPrompt: PRODUCT_MODEL_SYSTEM_PROMPT,
      userPrompt,
      schema: productModelSchema,
      schemaName: 'product_model',
      maxTokens: DEFAULT_MAX_TOKENS,
      retryRenderer: (errorText, prevUserPrompt) =>
        `${prevUserPrompt}\n\nYour previous output failed validation with this error:\n${errorText}\n\nRegenerate the product_model strictly matching the schema.`,
    });
  } catch (err) {
    throw new ProductModelGenerationError(
      err instanceof Error ? err.message : String(err),
    );
  }
}
