import { describe, it, expect } from 'vitest';
import { normalize } from './normalize.js';

describe('normalize', () => {
  it('expands a Ctrl+ keyboard shortcut into spoken words', () => {
    const result = normalize('Press Ctrl+Z to undo.');
    expect(result.text).toBe('Press Control Z to undo.');
  });
});
