export interface NormalizationDiff {
  from: string;
  to: string;
  rule: string;
}

export interface NormalizationResult {
  text: string;
  diffs: NormalizationDiff[];
}

export function normalize(text: string): NormalizationResult {
  const diffs: NormalizationDiff[] = [];
  const out = text.replace(/Ctrl\+([A-Za-z])/g, (match, key) => {
    const to = `Control ${key}`;
    diffs.push({ from: match, to, rule: 'keyboard-shortcut' });
    return to;
  });
  return { text: out, diffs };
}
