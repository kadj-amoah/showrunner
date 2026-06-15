import { describe, it, expect } from 'vitest';
import { numberToWords } from './numberToWords.js';

describe('numberToWords', () => {
  it.each([
    [0, 'zero'],
    [7, 'seven'],
    [13, 'thirteen'],
    [20, 'twenty'],
    [42, 'forty-two'],
    [100, 'one hundred'],
    [305, 'three hundred five'],
    [1000, 'one thousand'],
    [1234, 'one thousand two hundred thirty-four'],
    [10000, 'ten thousand'],
    [2024, 'two thousand twenty-four'],
    [1000000, 'one million'],
  ])('converts %i to "%s"', (n, words) => {
    expect(numberToWords(n)).toBe(words);
  });
});
