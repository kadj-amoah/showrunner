import { z } from 'zod';
import type { LLMProvider } from '../providers/llm/types.js';

export const ResolutionItemSchema = z.object({
  token: z.string(),
  class: z.enum(['english_name', 'african_name', 'initialism', 'real_word']),
  proxy_language: z.string().optional(),
  mode: z.enum(['letters', 'expand']).optional(),
  expansion: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1),
  alternatives: z.array(z.string()).default([]),
  rationale: z.string().optional(),
});
export type ResolutionItem = z.infer<typeof ResolutionItemSchema>;
export const ResolutionSchema = z.object({ tokens: z.array(ResolutionItemSchema) });

const SYSTEM_PROMPT = `You classify out-of-vocabulary tokens from a voiceover script so a speech synthesizer pronounces them correctly. For each token return its class:
- english_name: a name read by English pronunciation rules.
- african_name: a name of African origin. Always set proxy_language to "sw" (Swahili). It is the single v1 proxy for all African names: espeak-ng has no West African voices, and Swahili's pure-vowel, CV phonology renders most African names (West and East) correctly. Do not propose any other language code.
- initialism: an abbreviation/initialism. Set mode to "expand" with an "expansion" when the surrounding script makes the meaning clear (e.g. finance/fraud context -> BoG = "Bank of Ghana"); otherwise set mode to "letters". Give a confidence 0-1, up to two alternatives, and a one-line rationale citing the context cues.
- real_word: an ordinary word needing no special handling.
Use the full script as context. Return strictly the schema.`;

export function buildUserPrompt(tokens: string[], scriptContext: string): string {
  return `Script:\n"""\n${scriptContext}\n"""\n\nTokens to classify: ${JSON.stringify(tokens)}`;
}

/** Best-effort: returns [] on any LLM failure (the run falls back to the deterministic floor). */
export async function resolveTokens(
  tokens: string[],
  scriptContext: string,
  llm: LLMProvider,
): Promise<ResolutionItem[]> {
  if (tokens.length === 0) return [];
  try {
    const out = await llm.generateStructured({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(tokens, scriptContext),
      schema: ResolutionSchema,
      schemaName: 'pronunciation_resolution',
      maxTokens: 1024,
    });
    return out.tokens;
  } catch {
    return [];
  }
}
