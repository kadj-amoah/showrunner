export interface AlignmentVerdict {
  ok: boolean;
  issues: string[];
}

export interface LeakVerdict {
  ok: boolean;
  leaks: string[];
}

export interface GateVerdict {
  ok: boolean;
  alignment: AlignmentVerdict;
  leak: LeakVerdict;
  issues: string[];
}

/** Remove SSML break tags so we compare against the spoken (not the authored) text. */
export function stripBreakTags(text: string): string {
  return text.replace(/<break[^>]*\/>/g, '');
}

/**
 * Remove inline /IPA/ pronunciation spans injected by the G2P pass. Their
 * grapheme content is a pronunciation hint, not a spoken word to refute, and
 * ElevenLabs echoes them verbatim in the alignment characters — so they must
 * drop out of BOTH sides before word comparison.
 *
 * The span delimiter is `/…/` with no whitespace inside (one token per span, as
 * produced by phonemizeSegments). A bare ASCII `a/b/c` could in principle match,
 * but normalized VO prose doesn't carry slash runs, so the risk is theoretical.
 */
export function stripInlineIpa(text: string): string {
  return text.replace(/\/[^/\s]+\//g, ' ');
}

/**
 * Strip everything that appears in the alignment characters but is not a spoken
 * word: SSML break tags (ElevenLabs echoes them back) and inline IPA spans.
 * Applied symmetrically to the expected text and the spoken characters so
 * neither inflates the word count.
 */
function stripNonSpoken(text: string): string {
  return stripInlineIpa(stripBreakTags(text));
}

function tokenize(s: string): string[] {
  return stripNonSpoken(s).toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function firstDivergence(a: string[], b: string[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

/**
 * Refute a take against its script: the alignment's spoken characters should
 * carry the same words, in order, as the expected (break-stripped) text.
 * Catches omissions, insertions/repetitions, and substitutions — including a
 * descriptive cue that got read aloud.
 */
export function checkAlignment(expectedSpokenText: string, spokenCharacters: string[]): AlignmentVerdict {
  const expected = tokenize(expectedSpokenText);
  const spoken = tokenize(spokenCharacters.join(''));
  if (expected.length === spoken.length && firstDivergence(expected, spoken) === -1) {
    return { ok: true, issues: [] };
  }
  const issues: string[] = [];
  if (spoken.length < expected.length) {
    issues.push(`omission: spoke ${spoken.length} words, expected ${expected.length}`);
  } else if (spoken.length > expected.length) {
    issues.push(`insertion/repetition: spoke ${spoken.length} words, expected ${expected.length}`);
  } else {
    issues.push('substitution: same word count but words differ');
  }
  const i = firstDivergence(expected, spoken);
  if (i >= 0) {
    issues.push(`first divergence at word ${i}: expected "${expected[i] ?? '∅'}", spoke "${spoken[i] ?? '∅'}"`);
  }
  return { ok: false, issues };
}

// Tokens the normalization pre-pass is supposed to have eliminated. If any
// survive into the spoken text, a rule failed to fire.
const LEAK_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'currency-dollar', pattern: /\$\d/ },
  { name: 'currency-cedis', pattern: /GH[¢₵]/ },
  { name: 'keyboard-shortcut', pattern: /\bCtrl\+/ },
  { name: 'version', pattern: /\bv\d+\.\d+\b/ },
];

export function checkNormalizationLeak(text: string): LeakVerdict {
  const leaks = LEAK_PATTERNS.filter((p) => p.pattern.test(text)).map((p) => p.name);
  return { ok: leaks.length === 0, leaks };
}

/** Objective gate: alignment refutation + normalization-leak scan over the spoken master text. */
export function runGate(expectedSpokenText: string, spokenCharacters: string[]): GateVerdict {
  const alignment = checkAlignment(expectedSpokenText, spokenCharacters);
  const leak = checkNormalizationLeak(expectedSpokenText);
  const issues = [...alignment.issues, ...leak.leaks.map((l) => `normalization leak: ${l}`)];
  return { ok: alignment.ok && leak.ok, alignment, leak, issues };
}
