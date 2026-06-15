import { createHash } from 'node:crypto';

export interface MasterFreezeInput {
  /** The full post-normalization master script. */
  text: string;
  /** Resolved TTS provider config (model + voice settings) — anything that changes the audio. */
  voiceConfig: unknown;
  /** Pronunciation-dictionary version. Wired in Task 3; absent for now. */
  pronunciationDictVersion?: string;
}

/** Deterministic JSON with recursively sorted keys, so object key order never affects the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Causal hash over the inputs that determine a master take (Design §9): the
 * post-normalization master script, the voice config, and the pronunciation-dict
 * version. A cache hit means none of those changed, so the frozen take is reused.
 */
export function masterFreezeKey(input: MasterFreezeInput): string {
  const canonical = stableStringify({
    text: input.text,
    voiceConfig: input.voiceConfig,
    dict: input.pronunciationDictVersion ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export interface ReuseDecision {
  forced: boolean;
  audioExists: boolean;
  alignmentExists: boolean;
  savedKey: string | null;
  currentKey: string;
}

/** Reuse the frozen master only when nothing forces a rebuild, both artifacts exist, and the key matches. */
export function shouldReuseMaster(d: ReuseDecision): boolean {
  return !d.forced && d.audioExists && d.alignmentExists && d.savedKey === d.currentKey;
}
