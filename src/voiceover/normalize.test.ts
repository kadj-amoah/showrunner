import { describe, it, expect } from 'vitest';
import { normalize } from './normalize.js';

describe('normalize', () => {
  it('expands a Ctrl+ keyboard shortcut into spoken words', () => {
    const result = normalize('Press Ctrl+Z to undo.');
    expect(result.text).toBe('Press Control Z to undo.');
  });

  it('logs a diff for each substitution it makes', () => {
    const result = normalize('Press Ctrl+Z.');
    expect(result.diffs).toContainEqual({ from: 'Ctrl+Z', to: 'Control Z', rule: 'keyboard-shortcut' });
  });

  it('spaces an all-caps acronym for letter-by-letter reading', () => {
    const result = normalize('Open the API settings.');
    expect(result.text).toBe('Open the A P I settings.');
  });

  it.each([
    ['GH¢10,000', 'ten thousand cedis'],
    ['$5', 'five dollars'],
    ['$0/month', 'zero dollars per month'],
  ])('normalizes currency %s → %s', (input, expected) => {
    expect(normalize(input).text).toBe(expected);
  });

  it.each([
    ['v2.5', 'version two point five'],
    ['Now on v2.55.', 'Now on version two point five five.'],
  ])('normalizes a version string %s → %s', (input, expected) => {
    expect(normalize(input).text).toBe(expected);
  });
});
