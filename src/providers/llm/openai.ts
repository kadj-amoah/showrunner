import OpenAI from 'openai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z, ZodTypeAny } from 'zod';
import { logger } from '../../util/logger.js';
import type {
  GenerateStructuredOptions,
  LLMProvider,
} from './types.js';
import { LLMProviderError } from './types.js';

export interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  /** Default max output tokens. */
  maxTokens?: number;
  /** Override the API base (Azure / OpenRouter / etc). */
  baseURL?: string;
}

const DEFAULT_MAX_TOKENS = 8000;

/**
 * Uses the OpenAI chat-completions API with `response_format: json_schema`
 * for native structured-output validation. Falls back to `json_object` mode
 * (free-form JSON + post-parse) when the schema is rejected (some Zod
 * constructs OpenAI's strict mode can't validate — discriminated unions,
 * deeply-nested z.record, etc).
 */
export class OpenAILLMProvider implements LLMProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly defaultMaxTokens: number;

  constructor(cfg: OpenAIProviderConfig) {
    if (!cfg.apiKey) {
      throw new LLMProviderError(
        'OpenAILLMProvider: apiKey is required',
        'openai',
      );
    }
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
    this.model = cfg.model;
    this.defaultMaxTokens = cfg.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async generateStructured<S extends ZodTypeAny>(opts: GenerateStructuredOptions<S>): Promise<z.infer<S>> {
    const jsonSchema = patchSchemaForStrict(
      zodToJsonSchema(opts.schema, opts.schemaName ?? 'output'),
    );
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userPrompt },
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: opts.maxTokens ?? this.defaultMaxTokens,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: opts.schemaName ?? 'output',
            schema: jsonSchema as Record<string, unknown>,
            strict: true,
          },
        },
      });
      const raw = response.choices[0]?.message?.content ?? '';
      const parsed = safeJsonParse(raw);
      return opts.schema.parse(parsed);
    } catch (err) {
      // OpenAI rejects some schema shapes outright. Fall back to free-form
      // JSON output + post-parse via Zod.
      if (!isSchemaRejection(err)) throw wrap(err);
      logger.warn('OpenAI rejected the json_schema; falling back to json_object mode', {
        cause: err instanceof Error ? err.message : String(err),
      });
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: opts.maxTokens ?? this.defaultMaxTokens,
        messages: [
          {
            role: 'system',
            content: `${opts.systemPrompt}\n\nRespond with a single JSON object that matches the schema described in the user message. Do not include any prose.`,
          },
          { role: 'user', content: opts.userPrompt },
        ],
        response_format: { type: 'json_object' },
      });
      const raw = response.choices[0]?.message?.content ?? '';
      const parsed = safeJsonParse(raw);
      return opts.schema.parse(parsed);
    }
  }
}

function isSchemaRejection(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = (err as { message?: string }).message ?? '';
  return /Invalid schema|response_format|json_schema/i.test(msg);
}

function wrap(err: unknown): LLMProviderError {
  return new LLMProviderError(
    `OpenAI call failed: ${err instanceof Error ? err.message : String(err)}`,
    'openai',
    err,
  );
}

function safeJsonParse(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new LLMProviderError('OpenAI returned empty content', 'openai');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some models still wrap output in a fence even when asked not to.
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
    if (fenced && fenced[1]) return JSON.parse(fenced[1].trim());
    throw new LLMProviderError(
      `OpenAI content was not valid JSON. First 500 chars:\n${trimmed.slice(0, 500)}`,
      'openai',
    );
  }
}

/**
 * OpenAI's strict json_schema rejects schemas that don't set
 * `additionalProperties: false` on every object node. Walk the tree and patch.
 */
function patchSchemaForStrict(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(patchSchemaForStrict);
  if (schema && typeof schema === 'object') {
    const obj = { ...(schema as Record<string, unknown>) };
    if (obj['type'] === 'object' && obj['additionalProperties'] === undefined) {
      obj['additionalProperties'] = false;
    }
    for (const k of Object.keys(obj)) {
      obj[k] = patchSchemaForStrict(obj[k]);
    }
    return obj;
  }
  return schema;
}
