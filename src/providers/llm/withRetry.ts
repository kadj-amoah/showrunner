import { z, type ZodTypeAny } from 'zod';
import { logger } from '../../util/logger.js';
import type {
  GenerateStructuredOptions,
  LLMProvider,
} from './types.js';
import { LLMProviderError } from './types.js';

export interface WithRetryOptions<S extends ZodTypeAny> extends GenerateStructuredOptions<S> {
  /**
   * Build the follow-up user prompt when the first attempt fails to validate
   * or parse. Receives the prior error text so the model can correct itself.
   * If undefined, no retry happens.
   */
  retryRenderer?: (errorText: string, previousUserPrompt: string) => string;
}

/**
 * Two-attempt structured generation. Provider does single-shot; this helper
 * captures schema-validation failures and re-prompts with the error context.
 * Most call sites that benefit from this are the manifest + product-model
 * generators (the ones whose schemas are complex enough that first-pass output
 * occasionally drifts). Single-shot call sites (like `instrument`) skip this
 * helper and call provider.generateStructured directly.
 */
export async function generateWithRetry<S extends ZodTypeAny>(
  provider: LLMProvider,
  opts: WithRetryOptions<S>,
): Promise<z.infer<S>> {
  try {
    return await provider.generateStructured(opts);
  } catch (err) {
    const errText = formatErrorText(err);
    if (!opts.retryRenderer) {
      throw err;
    }
    logger.warn('Structured generation failed on first attempt; retrying with error feedback', {
      error: errText.slice(0, 200),
    });
    const retryPrompt = opts.retryRenderer(errText, opts.userPrompt);
    try {
      return await provider.generateStructured({ ...opts, userPrompt: retryPrompt });
    } catch (secondErr) {
      const secondErrText = formatErrorText(secondErr);
      throw new LLMProviderError(
        `Structured generation failed after one retry. Last error:\n${secondErrText.slice(0, 2000)}`,
        'unknown',
        secondErr,
      );
    }
  }
}

function formatErrorText(err: unknown): string {
  if (err instanceof z.ZodError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
