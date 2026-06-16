import { detectOov, loadDefaultCommonWords } from './oov.js';
import { classifyDeterministic, loadDefaultAfricanNames, type TokenClass } from './classify.js';
import { phonemizeByLanguage } from './g2p.js';
import { resolveTokens, type ResolutionItem } from './resolve.js';
import { applyRenders, spellLetters, type Render } from './render.js';
import {
  loadLexicon,
  saveLexicon,
  contextHash,
  isFresh,
  type Lexicon,
  type LexiconEntry,
} from './lexicon.js';
import type { LLMProvider } from '../providers/llm/types.js';

export interface PronounceConfig {
  python: string;
  scriptPath: string;
  proxyLanguage: string;
  resolverEnabled: boolean;
  confidenceThreshold: number;
  lexiconPath: string;
}

export interface PronounceResult<T> {
  segments: T[];
  lexicon: Lexicon;
  renders: Record<string, Render>;
  held: string[];
}

export async function pronounce<T extends { vo_line: string }>(
  segments: T[],
  scriptContext: string,
  cfg: PronounceConfig,
  llm: LLMProvider | null,
): Promise<PronounceResult<T>> {
  const common = await loadDefaultCommonWords();
  const african = await loadDefaultAfricanNames();
  const tokens = [...new Set(segments.flatMap((s) => detectOov(s.vo_line, common)))];
  const ctxHash = contextHash(scriptContext);
  const lexicon = await loadLexicon(cfg.lexiconPath);

  // 1. Deterministic classify for tokens not already fresh in the lexicon.
  const classes: Record<string, TokenClass | 'unknown'> = {};
  const needLLM: string[] = [];
  for (const t of tokens) {
    if (isFresh(lexicon[t], ctxHash)) continue;
    const c = classifyDeterministic(t, { common, african });
    classes[t] = c;
    if (cfg.resolverEnabled && llm && (c === 'unknown' || c === 'initialism')) needLLM.push(t);
  }

  // 2. LLM pass (best-effort) over unknowns + initialisms.
  const verdicts: Record<string, ResolutionItem> = {};
  if (needLLM.length > 0 && llm) {
    for (const item of await resolveTokens(needLLM, scriptContext, llm)) verdicts[item.token] = item;
  }

  // 3. Final class per freshly-classified token (LLM overrides the deterministic guess).
  const finalClass: Record<string, TokenClass> = {};
  for (const t of Object.keys(classes)) {
    const v = verdicts[t];
    // A verdict wins. With no verdict, an unknown token falls to the English-IPA
    // floor (phonemize it) — a silent LLM omission must not drop pronunciation help.
    if (v) finalClass[t] = v.class;
    else if (classes[t] === 'unknown') finalClass[t] = 'english_name';
    else finalClass[t] = classes[t] as TokenClass;
  }

  // 4. Phonemize name-class tokens, grouped by language.
  const afLang = (t: string) => verdicts[t]?.proxy_language ?? cfg.proxyLanguage;
  const groups: Record<string, string[]> = {};
  for (const t of Object.keys(finalClass)) {
    if (finalClass[t] === 'english_name') (groups['en-us'] ??= []).push(t);
    else if (finalClass[t] === 'african_name') (groups[afLang(t)] ??= []).push(t);
  }
  const ipa = await phonemizeByLanguage(groups, { python: cfg.python, scriptPath: cfg.scriptPath });

  // 5. Build lexicon entries + apply the confidence tier (names auto; expansions gated).
  for (const t of Object.keys(finalClass)) {
    const v = verdicts[t];
    const cls = finalClass[t]!;
    const source: LexiconEntry['source'] = v ? 'llm' : 'deterministic';
    const confidence = v?.confidence ?? 1;
    let render: Render;
    let confirmed = true;

    if (cls === 'real_word') {
      render = { type: 'none' };
    } else if (cls === 'initialism') {
      if (v?.mode === 'expand' && v.expansion) {
        if (confidence >= cfg.confidenceThreshold) {
          render = { type: 'expansion', value: v.expansion };
        } else {
          render = { type: 'letters', value: spellLetters(t) };
          confirmed = false;
        }
      } else {
        render = { type: 'letters', value: spellLetters(t) };
      }
    } else {
      // name (english_name | african_name): phonology auto-applies. A sidecar miss
      // (no IPA) must NOT be frozen as 'none' — skip the entry so it retries next run.
      const value = ipa[t];
      if (!value) continue;
      const proxy = cls === 'african_name' ? afLang(t) : 'en-us';
      render = { type: 'ipa', value, proxy };
    }

    lexicon[t] = {
      class: cls,
      render,
      source,
      confidence,
      confirmed,
      ...(v?.alternatives?.length ? { alternatives: v.alternatives } : {}),
      context_hash: ctxHash,
      ...(v?.rationale ? { rationale: v.rationale } : {}),
    };
  }

  await saveLexicon(cfg.lexiconPath, lexicon);

  // 6. Compose the render map (held rows already store their letters floor).
  const renders: Record<string, Render> = {};
  const held: string[] = [];
  for (const t of tokens) {
    const e = lexicon[t];
    if (!e) continue;
    renders[t] = e.render;
    if (!e.confirmed) held.push(t);
  }

  return { segments: applyRenders(segments, renders), lexicon, renders, held };
}
