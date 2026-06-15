export interface NormalizationDiff {
  from: string;
  to: string;
  rule: string;
}

export interface NormalizationResult {
  text: string;
  diffs: NormalizationDiff[];
}

interface Rule {
  name: string;
  pattern: RegExp;
  replace: (match: string, ...groups: string[]) => string;
}

// Applied in order. Earlier rules win on overlapping spans, so domain/symbol
// rules should precede the generic acronym sweep.
const RULES: Rule[] = [
  {
    name: 'keyboard-shortcut',
    pattern: /Ctrl\+([A-Za-z])/g,
    replace: (_match, key) => `Control ${key}`,
  },
  {
    name: 'acronym',
    pattern: /\b[A-Z]{2,}\b/g,
    replace: (match) => match.split('').join(' '),
  },
];

export function normalize(text: string): NormalizationResult {
  const diffs: NormalizationDiff[] = [];
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      // String.prototype.replace passes (…captureGroups, offset, wholeString).
      const groups = rest.slice(0, -2) as string[];
      const to = rule.replace(match, ...groups);
      diffs.push({ from: match, to, rule: rule.name });
      return to;
    });
  }
  return { text: out, diffs };
}
