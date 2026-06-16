import { describe, it, expect } from 'vitest';
import { classifyDeterministic, isInitialismCandidate } from './classify.js';

const common = new Set(['the', 'plan', 'is', 'ok', 'bog', 'rivals', 'it', 'us']);
const african = new Set(['akua', 'kwame', 'adwoa']);

describe('classifyDeterministic', () => {
  it('flags a listed African name', () => {
    expect(classifyDeterministic('Akua', { common, african })).toBe('african_name');
  });
  it('flags BoG as an initialism even though "bog" is a common word', () => {
    expect(classifyDeterministic('BoG', { common, african })).toBe('initialism');
  });
  it('treats OK as a real word, not an initialism', () => {
    expect(classifyDeterministic('OK', { common, african })).toBe('real_word');
  });
  it('leaves common words alone', () => {
    expect(classifyDeterministic('rivals', { common, african })).toBe('real_word');
  });
  it('routes unknown coined names to the LLM tail', () => {
    expect(classifyDeterministic('Eduwaka', { common, african })).toBe('unknown');
  });
});

describe('isInitialismCandidate', () => {
  it('catches mixed-internal-cap and short all-caps', () => {
    expect(isInitialismCandidate('goAML', common)).toBe(true);
    expect(isInitialismCandidate('SAR', common)).toBe(true);
  });
  it('rejects long names with internal caps', () => {
    expect(isInitialismCandidate('McKinsey', common)).toBe(false);
  });
});
