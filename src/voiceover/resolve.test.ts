import { describe, it, expect, vi } from 'vitest';
import { resolveTokens } from './resolve.js';

const fakeLLM = (impl: (opts: any) => Promise<any>) => ({ generateStructured: vi.fn(impl) });

describe('resolveTokens', () => {
  it('returns [] without calling the LLM when there are no tokens', async () => {
    const llm = fakeLLM(async () => ({ tokens: [] }));
    expect(await resolveTokens([], 'ctx', llm as any)).toEqual([]);
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });

  it('passes the script as context and returns parsed items', async () => {
    const llm = fakeLLM(async () => ({
      tokens: [
        { token: 'BoG', class: 'initialism', mode: 'expand', expansion: 'Bank of Ghana', confidence: 0.9, alternatives: [], rationale: 'finance context' },
      ],
    }));
    const items = await resolveTokens(['BoG'], 'Argus audits the ledger for fraud.', llm as any);
    expect(items[0]!.expansion).toBe('Bank of Ghana');
    expect(items[0]!.class).toBe('initialism');
    const call = llm.generateStructured.mock.calls[0]![0];
    expect(call.userPrompt).toContain('Argus audits the ledger');
  });

  it('is best-effort: returns [] when the LLM throws', async () => {
    const llm = fakeLLM(async () => {
      throw new Error('no key');
    });
    expect(await resolveTokens(['X'], 'ctx', llm as any)).toEqual([]);
  });
});
