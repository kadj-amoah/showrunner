import { describe, it, expect } from 'vitest';
import { manifestFromScript } from './manifestFromScript.js';

describe('manifestFromScript', () => {
  it('makes one segment per blank-line-separated paragraph', () => {
    const m = manifestFromScript('Para one.\nstill one.\n\nPara two.');
    expect(m.segments).toHaveLength(2);
    expect(m.segments[0]!.vo_line).toBe('Para one.\nstill one.');
    expect(m.segments[1]!.vo_line).toBe('Para two.');
    expect(m.segments[0]!.id).toBe('seg-0');
    expect(m.segments[0]!.actions).toEqual([{ type: 'idle', at: 0 }]);
  });

  it('treats a single block as one segment', () => {
    expect(manifestFromScript('Just one line.').segments).toHaveLength(1);
  });

  it('throws on empty input', () => {
    expect(() => manifestFromScript('   ')).toThrow();
  });
});
