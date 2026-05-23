import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ParsedMessage } from '@anthropic-ai/sdk/lib/parser';
import type { z, ZodTypeAny } from 'zod';
import type {
  GenerateStructuredOptions,
  LLMProvider,
} from './types.js';
import { LLMProviderError } from './types.js';

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  /** Default max_tokens when the call site doesn't override. */
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 8000;

export class AnthropicLLMProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly defaultMaxTokens: number;

  constructor(cfg: AnthropicProviderConfig) {
    if (!cfg.apiKey) {
      throw new LLMProviderError(
        'AnthropicLLMProvider: apiKey is required',
        'anthropic',
      );
    }
    this.client = new Anthropic({ apiKey: cfg.apiKey });
    this.model = cfg.model;
    this.defaultMaxTokens = cfg.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async generateStructured<S extends ZodTypeAny>(opts: GenerateStructuredOptions<S>): Promise<z.infer<S>> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
      thinking: { type: 'adaptive' as const },
      system: [
        {
          type: 'text' as const,
          text: opts.systemPrompt,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      output_config: { format: zodOutputFormat(opts.schema) },
      messages: [{ role: 'user', content: opts.userPrompt }],
    });

    return extractAndValidate(response, opts.schema);
  }
}

function extractAndValidate<S extends ZodTypeAny>(
  response: ParsedMessage<unknown>,
  schema: S,
): z.infer<S> {
  if (response.parsed_output !== undefined && response.parsed_output !== null) {
    return schema.parse(response.parsed_output);
  }
  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  throw new LLMProviderError(
    text.length > 0
      ? `Anthropic returned no parseable structured output. Raw text:\n${text.slice(0, 2000)}`
      : 'Anthropic returned an empty response with no parseable output.',
    'anthropic',
  );
}
