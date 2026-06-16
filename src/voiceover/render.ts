import type { TokenClass } from './classify.js';
export type { TokenClass };

export type Render =
  | { type: 'ipa'; value: string; proxy: string }
  | { type: 'letters'; value: string }
  | { type: 'expansion'; value: string }
  | { type: 'none' };

export function renderToText(r: Render): string | null {
  switch (r.type) {
    case 'ipa':
      return `/${r.value}/`;
    case 'letters':
      return r.value;
    case 'expansion':
      return r.value;
    case 'none':
      return null;
  }
}

/** Spell an initialism as space-separated upper letters: BoG → "B O G". */
export function spellLetters(token: string): string {
  return token.toUpperCase().split('').join(' ');
}

/** Whole-word replacement of each token with its rendered spoken form. */
export function applyRenders<T extends { vo_line: string }>(
  segments: T[],
  renders: Record<string, Render>,
): T[] {
  const entries = Object.entries(renders);
  if (entries.length === 0) return segments;
  return segments.map((seg) => {
    let line = seg.vo_line;
    for (const [token, r] of entries) {
      const replacement = renderToText(r);
      if (replacement === null) continue;
      const safe = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      line = line.replace(new RegExp(`\\b${safe}\\b`, 'g'), replacement);
    }
    return { ...seg, vo_line: line };
  });
}
