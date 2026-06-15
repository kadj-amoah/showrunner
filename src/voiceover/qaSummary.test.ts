import { describe, it, expect } from 'vitest';
import { formatQaSummary } from './qaSummary.js';

describe('formatQaSummary', () => {
  it('shows a passed gate and the MOS', () => {
    const out = formatQaSummary({
      gate: { ok: true, issues: [] },
      naturalness: { available: true, score: 3.5, floor: 2.0, belowFloor: false },
    });
    expect(out).toMatch(/QA gate: passed/);
    expect(out).toMatch(/Naturalness \(MOS\): 3\.5/);
  });

  it('shows a flagged gate with its issues', () => {
    const out = formatQaSummary({ gate: { ok: false, issues: ['omission: ...', 'normalization leak: currency-dollar'] } });
    expect(out).toMatch(/flagged/);
    expect(out).toMatch(/currency-dollar/);
  });

  it('marks a below-floor MOS', () => {
    const out = formatQaSummary({ naturalness: { available: true, score: 1.5, floor: 2.0, belowFloor: true } });
    expect(out).toMatch(/BELOW floor 2/);
  });

  it('notes when naturalness was not scored', () => {
    expect(formatQaSummary({ naturalness: { available: false, score: null, floor: 2.0, belowFloor: false } }))
      .toMatch(/not scored/);
  });

  it('returns empty string when there is nothing to report', () => {
    expect(formatQaSummary({})).toBe('');
  });
});
