import { describe, it, expect } from 'vitest';
import { phonemizeSegments } from './phonemize.js';

describe('phonemizeSegments', () => {
  it('wraps known tokens in inline /IPA/ and leaves the rest', () => {
    const segs = [{ id: 'a', vo_line: 'Welcome to Eduwaka today.' }];
    const phon = { Eduwaka: 'ɛduːˈwɑːkə' };
    const out = phonemizeSegments(segs, phon);
    expect(out[0]!.vo_line).toBe('Welcome to /ɛduːˈwɑːkə/ today.');
    expect(out[0]!.id).toBe('a');
  });
  it('is a no-op when the phoneme map is empty', () => {
    const segs = [{ id: 'a', vo_line: 'Nothing flagged.' }];
    expect(phonemizeSegments(segs, {})[0]!.vo_line).toBe('Nothing flagged.');
  });
});
