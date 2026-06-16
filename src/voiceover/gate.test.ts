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

  // ElevenLabs echoes SSML break tags verbatim into the alignment characters
  // (verified against a real eleven_v3 capture). The expected side has them
  // stripped, so an un-stripped spoken side inflates the word count → false flag.
  it('ignores SSML break tags echoed back in the alignment characters', () => {
    const v = checkAlignment('One. Two.', chars('One. <break time="0.45s"/> Two.'));
    expect(v.ok).toBe(true);
    expect(v.issues).toEqual([]);
  });

  // Inline /IPA/ spans (from the G2P pass) are pronunciation hints, not spoken
  // words. EL echoes them on the spoken side too, so they must drop out of both.
  it('ignores inline /IPA/ spans on both sides', () => {
    const text = 'Welcome to /ɛduːˈwɑːkə/ today.';
    const v = checkAlignment(text, chars(text));
    expect(v.ok).toBe(true);
  });

  // The gate must not go blind: a real dropped word is still caught even with
  // break-tag and IPA noise present.
  it('still flags an omission when a real word is dropped amid IPA/break noise', () => {
    const expected = 'Welcome to /ɛduːˈwɑːkə/ today friends.';
    const spoken = chars('Welcome to /ɛduːˈwɑːkə/ <break time="0.45s"/> today.');
    const v = checkAlignment(expected, spoken);
    expect(v.ok).toBe(false);
    expect(v.issues.join(' ')).toMatch(/omission/);
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

  // Regression for the 2026-06-15 G2P smoke false-flag. The expected text is the
  // break-stripped (but IPA-injected) master; the spoken characters are EL's
  // verbatim echo — break tag AND inline IPA included. Before the fix this
  // reported "spoke 26 words, expected 22 / first divergence … spoke 'break'".
  it('passes the captured G2P multi-segment master (break + inline IPA)', () => {
    const expected =
      'Our platform /ˌɛdʒuːwˈɑːkə/ watches every transaction.  It was built by /kɹˈɛdstoʊn/, and it /ɹˈaɪvəlz/ /ˈɑːɹɡəs/.';
    const spoken =
      'Our platform /ˌɛdʒuːwˈɑːkə/ watches every transaction. <break time="0.45s"/> It was built by /kɹˈɛdstoʊn/, and it /ɹˈaɪvəlz/ /ˈɑːɹɡəs/.';
    const v = runGate(expected, spoken.split(''));
    expect(v.ok).toBe(true);
    expect(v.issues).toEqual([]);
  });
});
