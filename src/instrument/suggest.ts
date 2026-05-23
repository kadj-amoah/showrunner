import { z } from 'zod';
import type { InstrumentCandidate } from './scan.js';
import { logger } from '../util/logger.js';
import type { LLMProvider } from '../providers/llm/types.js';

const DEFAULT_MAX_TOKENS = 8000;

const suggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().positive(),
      original: z.string(),
      replacement: z.string(),
      reasoning: z.string().default(''),
    }),
  ),
});

export type Suggestion = z.infer<typeof suggestionSchema>['suggestions'][number];

export class InstrumentSuggestionError extends Error {
  override readonly name = 'InstrumentSuggestionError';
}

export interface SuggestOptions {
  candidates: InstrumentCandidate[];
  provider: LLMProvider;
}

const SYSTEM_PROMPT = `You add data-testid attributes to JSX elements so they can be reliably targeted by automated demo tools.

Rules:
- For each candidate, propose a stable kebab-case data-testid based on visible text, surrounding context, or the element's role. Examples: "login-submit", "new-article-button", "todo-item-toggle".
- Prefer short, semantic ids over verbose ones.
- Output a single-line replacement: take the original line and insert data-testid="..." just before the closing > of the opening tag. Preserve all existing whitespace and other attributes.
- Skip elements where you can't infer a meaningful name (e.g. truly generic wrappers). In that case omit them from the output rather than guessing.
- Never duplicate an existing data-testid on the page; if two candidates would collide, suffix the second with an index ("-2").
- Reasoning: one short line explaining the chosen name.

Return JSON matching the requested schema.`;

export async function suggestTestIds(opts: SuggestOptions): Promise<Suggestion[]> {
  if (opts.candidates.length === 0) return [];

  const candidateBlock = opts.candidates
    .map(
      (c, i) =>
        `[${i + 1}] file=${c.file} line=${c.line} tag=${c.tag}\n    ${c.snippet.trim()}`,
    )
    .join('\n');

  const userPrompt = `Suggest data-testid attributes for the following JSX elements:\n\n${candidateBlock}\n\nFor each, return {file, line, original (exact source line), replacement (source line with data-testid inserted), reasoning}.`;

  logger.debug('Calling LLM provider for instrument suggestions', {
    candidates: opts.candidates.length,
  });

  try {
    const result = await opts.provider.generateStructured({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      schema: suggestionSchema,
      schemaName: 'instrument_suggestions',
      maxTokens: DEFAULT_MAX_TOKENS,
    });
    return result.suggestions;
  } catch (err) {
    throw new InstrumentSuggestionError(
      err instanceof Error ? err.message : String(err),
    );
  }
}
