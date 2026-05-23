import type { ShowrunnerConfig, LLMProviderConfig, TTSProviderConfig } from './schema.js';

export interface ProviderEnvCheck {
  provider: string;
  slot: 'llm' | 'tts';
  stage?: string;
  envVar: string;
  set: boolean;
}

/**
 * Inspect the config and return one row per provider env var that needs to be
 * set. Used by `validate` (warnings) and `doctor` (PASS/FAIL rows). Providers
 * that don't need an env var (agent_bridge, custom) are skipped.
 */
export function inspectProviderEnv(config: ShowrunnerConfig): ProviderEnvCheck[] {
  const rows: ProviderEnvCheck[] = [];

  // LLM default
  const llmRow = inspectLLMSpec(config.llm.default);
  if (llmRow) rows.push(llmRow);

  // LLM per-stage overrides
  if (config.llm.overrides) {
    for (const [stage, spec] of Object.entries(config.llm.overrides)) {
      if (!spec) continue;
      const row = inspectLLMSpec(spec);
      if (row) rows.push({ ...row, stage });
    }
  }

  // TTS
  const ttsRow = inspectTTSSpec(config.voiceover.provider);
  if (ttsRow) rows.push(ttsRow);

  return rows;
}

function inspectLLMSpec(spec: LLMProviderConfig): Omit<ProviderEnvCheck, 'stage'> | null {
  switch (spec.provider) {
    case 'anthropic':
    case 'openai':
      return {
        provider: spec.provider,
        slot: 'llm',
        envVar: spec.api_key_env,
        set: Boolean(process.env[spec.api_key_env]),
      };
    case 'agent_bridge':
    case 'custom':
      return null;
  }
}

function inspectTTSSpec(spec: TTSProviderConfig): Omit<ProviderEnvCheck, 'stage'> | null {
  switch (spec.name) {
    case 'elevenlabs':
    case 'openai':
      return {
        provider: spec.name,
        slot: 'tts',
        envVar: spec.api_key_env,
        set: Boolean(process.env[spec.api_key_env]),
      };
    case 'custom':
      return null;
  }
}

export function formatMissingEnvVars(rows: ProviderEnvCheck[]): string[] {
  return rows
    .filter((r) => !r.set)
    .map(
      (r) =>
        `${r.slot} provider "${r.provider}"${r.stage ? ` (stage: ${r.stage})` : ''} expects ${r.envVar} but it is not set`,
    );
}
