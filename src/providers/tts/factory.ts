import type { TTSProvider } from './types.js';
import { TTSProviderError } from './types.js';
import { ElevenLabsTTSProvider } from './elevenlabs.js';
import { OpenAITTSProvider } from './openai.js';
import { CustomTTSProvider } from './custom.js';

export interface ElevenLabsTTSSpec {
  name: 'elevenlabs';
  voice_id: string;
  model: string;
  api_key_env: string;
  endpoint?: 'with_timestamps' | 'basic';
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

export interface OpenAITTSSpec {
  name: 'openai';
  voice: string;
  model: string;
  api_key_env: string;
  base_url?: string;
}

export interface CustomTTSSpec {
  name: 'custom';
  module_path: string;
  options?: Record<string, unknown>;
}

export type TTSProviderSpec = ElevenLabsTTSSpec | OpenAITTSSpec | CustomTTSSpec;

export interface CreateTTSContext {
  configDir: string;
}

export function createTTSProvider(spec: TTSProviderSpec, ctx: CreateTTSContext): TTSProvider {
  switch (spec.name) {
    case 'elevenlabs': {
      const apiKey = process.env[spec.api_key_env];
      if (!apiKey) {
        throw new TTSProviderError(
          `TTS provider 'elevenlabs' configured with api_key_env='${spec.api_key_env}' but that env var is not set.`,
          'elevenlabs',
        );
      }
      return new ElevenLabsTTSProvider({
        apiKey,
        voiceId: spec.voice_id,
        modelId: spec.model,
        stability: spec.stability,
        similarityBoost: spec.similarity_boost,
        style: spec.style,
        useSpeakerBoost: spec.use_speaker_boost,
        speed: spec.speed,
      });
    }
    case 'openai': {
      const apiKey = process.env[spec.api_key_env];
      if (!apiKey) {
        throw new TTSProviderError(
          `TTS provider 'openai' configured with api_key_env='${spec.api_key_env}' but that env var is not set.`,
          'openai',
        );
      }
      return new OpenAITTSProvider({
        apiKey,
        voice: spec.voice,
        model: spec.model,
        baseURL: spec.base_url,
      });
    }
    case 'custom':
      return new CustomTTSProvider({
        modulePath: spec.module_path,
        configDir: ctx.configDir,
        options: spec.options,
      });
  }
}

/**
 * Narrowing helper: return the ElevenLabs sub-config when that's the configured
 * provider, otherwise null. Used by call sites that need to read voice_id etc.
 * without unwrapping the full discriminated union everywhere.
 */
export function getElevenLabsSpec(spec: TTSProviderSpec): ElevenLabsTTSSpec | null {
  return spec.name === 'elevenlabs' ? spec : null;
}
