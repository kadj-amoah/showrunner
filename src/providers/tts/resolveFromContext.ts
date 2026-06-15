import type { PipelineContext } from '../../pipeline/types.js';
import type { TTSProvider } from './types.js';
import {
  createTTSProvider,
  getElevenLabsSpec,
  type ElevenLabsTTSSpec,
  type TTSProviderSpec,
} from './factory.js';
import type { TTSProviderConfig } from '../../config/schema.js';

const PROVIDER_CACHE = new WeakMap<PipelineContext, TTSProvider>();

/**
 * Build (or fetch the cached) TTSProvider for this run.
 *
 * Reads from `ctx.providers.tts` when pre-wired by the pipeline, otherwise
 * constructs lazily from `ctx.config.voiceover.provider`. Caching is per-ctx
 * so repeated calls within a stage share the same provider instance.
 */
export function resolveTTSProvider(ctx: PipelineContext): TTSProvider {
  const pre = (ctx as PipelineContext & { providers?: { tts?: TTSProvider } }).providers;
  if (pre?.tts) return pre.tts;

  const cached = PROVIDER_CACHE.get(ctx);
  if (cached) return cached;

  const spec = configToSpec(ctx.config.voiceover.provider);
  const provider = createTTSProvider(spec, { configDir: ctx.configDir });
  PROVIDER_CACHE.set(ctx, provider);
  return provider;
}

export type AlignmentStrategy = 'required' | 'best_effort';

export function resolveAlignmentStrategy(ctx: PipelineContext): AlignmentStrategy {
  return ctx.config.voiceover.alignment_strategy ?? 'required';
}

/**
 * Narrowing helper for legacy ElevenLabs-only call sites (e.g. `voiceover.ts`
 * reads `vo.speed` for the "used_speed" metadata field). Returns the
 * ElevenLabs sub-spec when configured, otherwise null.
 */
export function resolveElevenLabsConfigOrNull(ctx: PipelineContext): ElevenLabsTTSSpec | null {
  const spec = configToSpec(ctx.config.voiceover.provider);
  return getElevenLabsSpec(spec);
}

function configToSpec(cfg: TTSProviderConfig): TTSProviderSpec {
  switch (cfg.name) {
    case 'elevenlabs':
      return {
        name: 'elevenlabs',
        voice_id: cfg.voice_id,
        model: cfg.model,
        api_key_env: cfg.api_key_env,
        endpoint: cfg.endpoint,
        stability: cfg.stability,
        similarity_boost: cfg.similarity_boost,
        style: cfg.style,
        use_speaker_boost: cfg.use_speaker_boost,
        speed: cfg.speed,
        pronunciation_dictionary_id: cfg.pronunciation_dictionary_id,
        pronunciation_dictionary_version_id: cfg.pronunciation_dictionary_version_id,
        apply_text_normalization: cfg.apply_text_normalization,
      };
    case 'openai':
      return {
        name: 'openai',
        voice: cfg.voice,
        model: cfg.model,
        api_key_env: cfg.api_key_env,
        ...(cfg.base_url !== undefined && { base_url: cfg.base_url }),
      };
    case 'custom':
      return {
        name: 'custom',
        module_path: cfg.module_path,
        ...(cfg.options !== undefined && { options: cfg.options }),
      };
  }
}
