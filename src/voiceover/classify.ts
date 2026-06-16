import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * The four pronunciation classes a token can carry. `classifyDeterministic`
 * below only ever returns `african_name`, `initialism`, or `real_word`;
 * `english_name` is produced later by the LLM resolver (and is the fallback for
 * an unknown token with no resolver), so it lives here as the shared type home.
 */
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
  // All-caps tokens are excluded if their lowercase is a common word (OK, US, IT are words);
  // mixed-case tokens carry no common-word exclusion because no English common word has a
  // mid-word capital, and BoG must win even though "bog" is a word.
  if (allCaps && common.has(token.toLowerCase())) return false;
  return true;
}

export function classifyDeterministic(
  token: string,
  lists: { common: ReadonlySet<string>; african: ReadonlySet<string> },
): DeterministicClass {
  // African check runs first: an all-caps token whose lowercase is a listed African name
  // (e.g. AMA, ESI) classifies as african_name, not the initialism reading. Domain-specific
  // all-caps initialisms that homograph day-names must be handled via lexicon/override upstream.
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
