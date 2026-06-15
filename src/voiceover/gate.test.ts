import { describe, it, expect } from 'vitest';
import { stripBreakTags, checkAlignment, checkNormalizationLeak, runGate } from './gate.js';

describe('stripBreakTags', () => {
  it('removes SSML break tags', () => {
    expect(stripBreakTags('One. <break time="0.75s"/> Two.')).toBe('One.  Two.');
  });
});

describe('checkAlignment', () => {
  const chars = (s: string) => s.split('');

  it('passes when the spoken characters match the expected words', () => {
    const v = checkAlignment('Hello there world.', chars('Hello there world.'));
    expect(v.ok).toBe(true);
    expect(v.issues).toEqual([]);
  });

  it('flags an omission when fewer words were spoken', () => {
    const v = checkAlignment('Hello there world.', chars('Hello world.'));
    expect(v.ok).toBe(false);
    expect(v.issues.join(' ')).toMatch(/omission/);
  });

  it('flags an insertion/repetition when more words were spoken', () => {
    const v = checkAlignment('Hello world.', chars('Hello world world.'));
    expect(v.ok).toBe(false);
    expect(v.issues.join(' ')).toMatch(/insertion|repetition/);
  });

  it('flags a substitution when a word differs', () => {
    const v = checkAlignment('Hello world.', chars('Hello earth.'));
    expect(v.ok).toBe(false);
    expect(v.issues.join(' ')).toMatch(/substitution/);
  });
});

describe('checkNormalizationLeak', () => {
  it('passes on fully normalized text', () => {
    expect(checkNormalizationLeak('It costs ten thousand cedis. Press Control Z.').ok).toBe(true);
  });

  it.each([
    ['$5 a month', 'currency-dollar'],
    ['GH¢5 today', 'currency-cedis'],
    ['Press Ctrl+Z', 'keyboard-shortcut'],
    ['Now on v2.5', 'version'],
  ])('flags a surviving %s token', (text, expectedLeak) => {
    const v = checkNormalizationLeak(text);
    expect(v.ok).toBe(false);
    expect(v.leaks).toContain(expectedLeak);
  });
});

describe('runGate', () => {
  it('is ok when alignment matches and no tokens leak', () => {
    const v = runGate('Press Control Z.', 'Press Control Z.'.split(''));
    expect(v.ok).toBe(true);
  });

  it('is not ok when a token leaked', () => {
    const v = runGate('Press Ctrl+Z.', 'Press Ctrl+Z.'.split(''));
    expect(v.ok).toBe(false);
    expect(v.issues.join(' ')).toMatch(/leak/);
  });
});
