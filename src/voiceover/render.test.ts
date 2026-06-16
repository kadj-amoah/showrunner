import { describe, it, expect } from 'vitest';
import { applyRenders, spellLetters } from './render.js';

describe('render', () => {
  it('injects inline IPA for ipa renders', () => {
    const out = applyRenders([{ vo_line: 'Welcome to Eduwaka today.' }], {
      Eduwaka: { type: 'ipa', value: 'ɛduwaka', proxy: 'sw' },
    });
    expect(out[0]!.vo_line).toBe('Welcome to /ɛduwaka/ today.');
  });
  it('spells an initialism as letters', () => {
    expect(spellLetters('BoG')).toBe('B O G');
    const out = applyRenders([{ vo_line: 'The BoG rule.' }], {
      BoG: { type: 'letters', value: spellLetters('BoG') },
    });
    expect(out[0]!.vo_line).toBe('The B O G rule.');
  });
  it('substitutes an expansion', () => {
    const out = applyRenders([{ vo_line: 'The BoG rule.' }], {
      BoG: { type: 'expansion', value: 'Bank of Ghana' },
    });
    expect(out[0]!.vo_line).toBe('The Bank of Ghana rule.');
  });
  it('leaves none-renders untouched', () => {
    const out = applyRenders([{ vo_line: 'Plain text.' }], { rivals: { type: 'none' } });
    expect(out[0]!.vo_line).toBe('Plain text.');
  });
});
