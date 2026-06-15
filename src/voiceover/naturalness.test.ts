import { describe, it, expect } from 'vitest';
import { parseUtmosScore, naturalnessVerdict } from './naturalness.js';

describe('parseUtmosScore', () => {
  it('parses the score float from the sidecar JSON', () => {
    expect(parseUtmosScore('{"score": 3.42}')).toBeCloseTo(3.42);
    expect(parseUtmosScore('{"score": 3}')).toBe(3);
  });

  it('throws on malformed or non-numeric output', () => {
    expect(() => parseUtmosScore('not json')).toThrow();
    expect(() => parseUtmosScore('{"score": "high"}')).toThrow();
    expect(() => parseUtmosScore('{}')).toThrow();
  });
});

describe('naturalnessVerdict', () => {
  it('marks unavailable when no score was produced', () => {
    const v = naturalnessVerdict(null, 2.0);
    expect(v.available).toBe(false);
    expect(v.belowFloor).toBe(false);
  });

  it('is above floor for a good score', () => {
    const v = naturalnessVerdict(3.5, 2.0);
    expect(v.available).toBe(true);
    expect(v.belowFloor).toBe(false);
    expect(v.score).toBe(3.5);
  });

  it('flags below floor for a poor score', () => {
    expect(naturalnessVerdict(1.5, 2.0).belowFloor).toBe(true);
  });

  it('never flags below floor when no floor is set (warn-only/scoring mode)', () => {
    const v = naturalnessVerdict(1.2, null);
    expect(v.available).toBe(true);
    expect(v.belowFloor).toBe(false);
    expect(v.floor).toBeNull();
  });
});
