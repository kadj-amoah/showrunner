import { describe, it, expect } from 'vitest';
import { contextHash, isFresh, type LexiconEntry } from './lexicon.js';

const entry = (over: Partial<LexiconEntry>): LexiconEntry => ({
  class: 'initialism',
  render: { type: 'letters', value: 'B O G' },
  source: 'llm',
  confidence: 0.9,
  confirmed: true,
  context_hash: 'h1',
  ...over,
});

describe('contextHash', () => {
  it('is stable and whitespace-insensitive', () => {
    expect(contextHash('a  b\n c')).toBe(contextHash('a b c'));
  });
});

describe('isFresh', () => {
  it('reuses a human override regardless of context', () => {
    expect(isFresh(entry({ source: 'human' }), 'h2')).toBe(true);
  });
  it('re-resolves when context changed', () => {
    expect(isFresh(entry({ context_hash: 'h1' }), 'h2')).toBe(false);
  });
  it('reuses a confirmed LLM row when context matches', () => {
    expect(isFresh(entry({ confirmed: true }), 'h1')).toBe(true);
  });
  it('does not reuse an unconfirmed (held) LLM row', () => {
    expect(isFresh(entry({ confirmed: false }), 'h1')).toBe(false);
  });
  it('treats a missing entry as not fresh', () => {
    expect(isFresh(undefined, 'h1')).toBe(false);
  });
});
