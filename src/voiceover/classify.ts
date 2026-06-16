import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export type TokenClass = 'english_name' | 'african_name' | 'initialism' | 'real_word';
export type DeterministicClass = TokenClass | 'unknown';

/**
 * An initialism candidate is a short token that is either all-caps (SAR, BOG)
 * or carries an internal capital after a lowercase letter (BoG, goAML). The
 * internal-capital signal is what lets BoG beat the fact that "bog" is a word.
 * All-caps tokens whose lowercase is a common word (OK, US, IT) are words.
 */
export function isInitialismCandidate(token: string, common: ReadonlySet<string>): boolean {
  if (token.length < 2 || token.length > 6) return false;
  const allCaps = /^[A-Z0-9]+$/.test(token) && /[A-Z]/.test(token);
  const mixedInternalCap = /[a-z][A-Z]/.test(token);
  if (!allCaps && !mixedInternalCap) return false;
  if (allCaps && common.has(token.toLowerCase())) return false;
  return true;
}

export function classifyDeterministic(
  token: string,
  lists: { common: ReadonlySet<string>; african: ReadonlySet<string> },
): DeterministicClass {
  if (lists.african.has(token.toLowerCase())) return 'african_name';
  if (isInitialismCandidate(token, lists.common)) return 'initialism';
  if (lists.common.has(token.toLowerCase())) return 'real_word';
  return 'unknown';
}

export async function loadAfricanNames(path: string): Promise<Set<string>> {
  const raw = await readFile(path, 'utf8');
  return new Set(raw.split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => w.length > 0));
}

export function defaultAfricanNamesPath(): string {
  return fileURLToPath(new URL('./data/african-names.txt', import.meta.url));
}

export async function loadDefaultAfricanNames(): Promise<Set<string>> {
  return loadAfricanNames(defaultAfricanNamesPath());
}
