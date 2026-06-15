export function phonemizeSegments<T extends { vo_line: string }>(
  segments: T[],
  phonemes: Record<string, string>,
): T[] {
  const entries = Object.entries(phonemes);
  if (entries.length === 0) return segments;
  return segments.map((seg) => {
    let line = seg.vo_line;
    for (const [token, ipa] of entries) {
      // Replace whole-word occurrences only; escape regex-special chars in the token.
      const safe = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      line = line.replace(new RegExp(`\\b${safe}\\b`, 'g'), `/${ipa}/`);
    }
    return { ...seg, vo_line: line };
  });
}
