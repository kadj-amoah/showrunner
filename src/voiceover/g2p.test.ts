import { describe, it, expect } from 'vitest';
import { parseG2pOutput, phonemizeByLanguage } from './g2p.js';

describe('parseG2pOutput', () => {
  it('parses a token to IPA map', () => {
    expect(parseG2pOutput('{"Eduwaka":"ɛduːˈwɑːkə"}')).toEqual({ Eduwaka: 'ɛduːˈwɑːkə' });
  });
  it('throws on non-object output', () => {
    expect(() => parseG2pOutput('null')).toThrow();
    expect(() => parseG2pOutput('garbage')).toThrow();
  });
});

describe('phonemizeByLanguage', () => {
  it('returns {} without spawning when every group is empty', async () => {
    const out = await phonemizeByLanguage({ 'en-us': [], sw: [] }, { scriptPath: 'scripts/g2p.py' });
    expect(out).toEqual({});
  });
});
