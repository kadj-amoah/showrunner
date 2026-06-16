import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('./g2p.js', async (orig) => ({
  ...(await orig<typeof import('./g2p.js')>()),
  phonemizeByLanguage: vi.fn(async (groups: Record<string, string[]>) => {
    const out: Record<string, string> = {};
    for (const tokens of Object.values(groups)) for (const t of tokens) out[t] = `IPA_${t}`;
    return out;
  }),
}));

import { pronounce } from './pronounce.js';

const fakeLLM = (impl: (opts: any) => Promise<any>) => ({ generateStructured: vi.fn(impl) });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pron-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const cfg = (over = {}) => ({
  python: 'python',
  scriptPath: 'scripts/g2p.py',
  proxyLanguage: 'sw',
  resolverEnabled: true,
  confidenceThreshold: 0.75,
  lexiconPath: join(dir, 'lexicon.json'),
  ...over,
});

describe('pronounce', () => {
  it('routes a listed African name to proxy IPA and expands BoG in finance context', async () => {
    const llm = fakeLLM(async () => ({
      tokens: [
        { token: 'BoG', class: 'initialism', mode: 'expand', expansion: 'Bank of Ghana', confidence: 0.95, alternatives: [], rationale: 'finance' },
      ],
    }));
    const segs = [{ vo_line: 'Akua audits the BoG ledger.' }];
    const out = await pronounce(segs, 'Akua audits the BoG ledger for fraud.', cfg(), llm as any);
    expect(out.segments[0]!.vo_line).toBe('/IPA_Akua/ audits the Bank of Ghana ledger.');
    expect(out.held).toEqual([]);
    const lex = JSON.parse(await readFile(join(dir, 'lexicon.json'), 'utf8'));
    expect(lex.Akua.render.proxy).toBe('sw');
    expect(lex.BoG.render.type).toBe('expansion');
  });

  it('holds a low-confidence expansion and falls back to letters', async () => {
    const llm = fakeLLM(async () => ({
      tokens: [
        { token: 'BoG', class: 'initialism', mode: 'expand', expansion: 'Board of Governors', confidence: 0.4, alternatives: ['Bank of Ghana'], rationale: 'ambiguous' },
      ],
    }));
    const out = await pronounce([{ vo_line: 'The BoG met.' }], 'The BoG met at the school.', cfg(), llm as any);
    expect(out.segments[0]!.vo_line).toBe('The B O G met.');
    expect(out.held).toEqual(['BoG']);
  });

  it('is best-effort: with no LLM, unknown names fall to English IPA', async () => {
    const out = await pronounce([{ vo_line: 'Open Eduwaka now.' }], 'Open Eduwaka now.', cfg({ resolverEnabled: false }), null);
    expect(out.segments[0]!.vo_line).toBe('Open /IPA_Eduwaka/ now.');
  });
});
