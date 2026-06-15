import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Tokens are alphabetic runs (letters + internal apostrophes). Numbers/symbols
 *  are normalization's job, not G2P's. */
export function detectOov(text: string, common: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const matches = text.match(/[A-Za-z][A-Za-z']*/g) ?? [];
  for (const tok of matches) {
    if (common.has(tok.toLowerCase())) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

export async function loadCommonWords(path: string): Promise<Set<string>> {
  const raw = await readFile(path, 'utf8');
  return new Set(raw.split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => w.length > 0));
}

export function defaultCommonWordsPath(): string {
  return fileURLToPath(new URL('./data/common-words.txt', import.meta.url));
}

export async function loadDefaultCommonWords(): Promise<Set<string>> {
  return loadCommonWords(defaultCommonWordsPath());
}
