import { readFile } from 'node:fs/promises';

export interface CharacterAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export async function loadAlignment(path: string): Promise<CharacterAlignment | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CharacterAlignment>;
    if (
      Array.isArray(parsed.characters) &&
      Array.isArray(parsed.character_start_times_seconds) &&
      Array.isArray(parsed.character_end_times_seconds)
    ) {
      return parsed as CharacterAlignment;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Locate the start-time (relative to the segment's audio start) of a target word
 * within the synthesized VO. Returns null if alignment is missing, the word can't
 * be found, or the requested occurrence doesn't exist.
 */
export function findWordStartTime(
  alignment: CharacterAlignment,
  word: string,
  occurrence: number = 1,
): number | null {
  if (!word || occurrence < 1) return null;
  const haystack = alignment.characters.join('').toLowerCase();
  const target = word.toLowerCase();
  const wordBoundary = /\w/.test(target[0]!) || /\w/.test(target[target.length - 1]!);
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = wordBoundary
    ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'g')
    : new RegExp(escaped, 'g');

  let found = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(haystack)) !== null) {
    found++;
    if (found === occurrence) {
      const charIdx = match.index;
      const t = alignment.character_start_times_seconds[charIdx];
      return typeof t === 'number' ? t : null;
    }
    if (match.index === pattern.lastIndex) pattern.lastIndex++; // empty-match guard
  }
  return null;
}

export interface WordMarker {
  name: string;
  t: number;
}

/**
 * Collapse the per-character alignment into per-word markers: one marker per
 * whitespace-delimited word, `name` = the word text and `t` = the start time of
 * its first character (in the alignment's own timebase). The `produce` harness
 * hands these to the Orchestrator as the beat/word timings that cross-asset locks
 * (and VO-driven motion) reference. Whitespace runs and leading/trailing space are
 * ignored; an empty/whitespace-only alignment yields `[]`.
 */
export function wordMarkers(alignment: CharacterAlignment): WordMarker[] {
  const { characters, character_start_times_seconds: starts } = alignment;
  const markers: WordMarker[] = [];
  let cur = '';
  let startT = 0;
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i] ?? '';
    if (/\s/.test(ch)) {
      if (cur) {
        markers.push({ name: cur, t: startT });
        cur = '';
      }
      continue;
    }
    if (!cur) startT = typeof starts[i] === 'number' ? starts[i]! : 0;
    cur += ch;
  }
  if (cur) markers.push({ name: cur, t: startT });
  return markers;
}
