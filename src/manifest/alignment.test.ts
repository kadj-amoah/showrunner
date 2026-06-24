import { describe, it, expect } from 'vitest';
import { wordMarkers, type CharacterAlignment } from './alignment.js';

// 1s per character timebase (integers — no float noise): char start time == its index.
const align = (s: string): CharacterAlignment => {
  const characters = [...s];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i),
    character_end_times_seconds: characters.map((_, i) => i + 1),
  };
};

describe('wordMarkers', () => {
  it('emits one marker per whitespace-delimited word at its first-char start', () => {
    // H0 i1 _2 t3 h4 e5 r6 e7 _8 b9 y10 e11
    expect(wordMarkers(align('Hi there bye'))).toEqual([
      { name: 'Hi', t: 0 },
      { name: 'there', t: 3 },
      { name: 'bye', t: 9 },
    ]);
  });

  it('ignores leading, trailing and repeated whitespace', () => {
    expect(wordMarkers(align('  a   b  ')).map((m) => m.name)).toEqual(['a', 'b']);
  });

  it('keeps punctuation attached to its word', () => {
    expect(wordMarkers(align('go.')).map((m) => m.name)).toEqual(['go.']);
  });

  it('returns [] for empty or whitespace-only alignment', () => {
    expect(wordMarkers(align(''))).toEqual([]);
    expect(wordMarkers(align('   '))).toEqual([]);
  });
});
