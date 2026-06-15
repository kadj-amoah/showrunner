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
  const out = text.replace(/Ctrl\+([A-Za-z])/g, 'Control $1');
  return { text: out, diffs: [] };
}
