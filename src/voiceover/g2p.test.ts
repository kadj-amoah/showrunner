import { describe, it, expect } from 'vitest';
import { parseG2pOutput } from './g2p.js';

describe('parseG2pOutput', () => {
  it('parses a token to IPA map', () => {
    expect(parseG2pOutput('{"Eduwaka":"ɛduːˈwɑːkə"}')).toEqual({ Eduwaka: 'ɛduːˈwɑːkə' });
  });
  it('throws on non-object output', () => {
    expect(() => parseG2pOutput('null')).toThrow();
    expect(() => parseG2pOutput('garbage')).toThrow();
  });
});
