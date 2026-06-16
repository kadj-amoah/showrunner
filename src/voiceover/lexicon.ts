import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { TokenClass } from './classify.js';
import type { Render } from './render.js';

export interface LexiconEntry {
  class: TokenClass;
  render: Render;
  source: 'deterministic' | 'llm' | 'human';
  confidence: number;
  confirmed: boolean;
  alternatives?: string[];
  context_hash: string;
  rationale?: string;
}
export type Lexicon = Record<string, LexiconEntry>;

export async function loadLexicon(path: string): Promise<Lexicon> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Lexicon;
  } catch {
    return {};
  }
}

export async function saveLexicon(path: string, lex: Lexicon): Promise<void> {
  await writeFile(path, JSON.stringify(lex, null, 2) + '\n', 'utf8');
}

/** A stable hash of the spoken context a resolution depended on. */
export function contextHash(scriptContext: string): string {
  return createHash('sha256')
    .update(scriptContext.replace(/\s+/g, ' ').trim())
    .digest('hex')
    .slice(0, 16);
}

/**
 * A lexicon row is reusable (no re-resolution) when:
 *  - it's human-authored (an override sticks regardless of context drift), or
 *  - its context still matches AND it's deterministic, or a confirmed LLM row.
 * An unconfirmed (held) LLM row is never reused — it still needs a pick.
 */
export function isFresh(entry: LexiconEntry | undefined, ctxHash: string): boolean {
  if (!entry) return false;
  if (entry.source === 'human') return true;
  if (entry.context_hash !== ctxHash) return false;
  if (entry.source === 'deterministic') return true;
  return entry.confirmed;
}
