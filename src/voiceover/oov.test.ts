import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { detectOov, loadCommonWords } from './oov.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const common = new Set(['the', 'plan', 'is', 'free', 'press', 'control', 'to', 'undo', 'by', 'beats', 'open', 'now']);

describe('detectOov', () => {
  it('flags alphabetic tokens not in the common-word list (case-insensitive), de-duped, in order', () => {
    expect(detectOov('The plan, by Eduwaka, beats Argus.', common)).toEqual(['Eduwaka', 'Argus']);
  });
  it('leaves common words alone', () => {
    expect(detectOov('the plan is free', common)).toEqual([]);
  });
  it('ignores pure numbers and punctuation (normalization owns those)', () => {
    expect(detectOov('press 42 to undo!', common)).toEqual([]);
  });
});

describe('loadCommonWords', () => {
  it('loads the bundled common-word list: size > 1000 and contains "the"', async () => {
    const path = join(__dirname, 'data', 'common-words.txt');
    const set = await loadCommonWords(path);
    expect(set.size).toBeGreaterThan(1000);
    expect(set.has('the')).toBe(true);
  });
});
