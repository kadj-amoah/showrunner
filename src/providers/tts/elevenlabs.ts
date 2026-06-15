import { synthesizeWithTimestamps } from '../../voiceover/elevenlabs.js';
import type {
  TTSProvider,
  TTSSynthesisRequest,
  TTSSynthesisResult,
} from './types.js';
import { TTSProviderError } from './types.js';

export interface ElevenLabsProviderConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
  speed: number;
  pronunciationDictionaryId?: string;
  pronunciationDictionaryVersionId?: string;
  applyTextNormalization?: 'auto' | 'on' | 'off';
}

export class ElevenLabsTTSProvider implements TTSProvider {
  readonly name = 'elevenlabs';
  readonly supportsAlignment = true;

  constructor(private readonly cfg: ElevenLabsProviderConfig) {
    if (!cfg.apiKey) {
      throw new TTSProviderError(
        'ElevenLabsTTSProvider: apiKey is required',
        'elevenlabs',
      );
    }
  }

  async synthesize(req: TTSSynthesisRequest): Promise<TTSSynthesisResult> {
    const result = await synthesizeWithTimestamps({
      voiceId: req.voice ?? this.cfg.voiceId,
      modelId: this.cfg.modelId,
      text: req.text,
      voiceSettings: {
        stability: this.cfg.stability,
        similarity_boost: this.cfg.similarityBoost,
        style: this.cfg.style,
        use_speaker_boost: this.cfg.useSpeakerBoost,
        speed: req.speed ?? this.cfg.speed,
      },
      apiKey: this.cfg.apiKey,
      pronunciationDictionaryId: this.cfg.pronunciationDictionaryId,
      pronunciationDictionaryVersionId: this.cfg.pronunciationDictionaryVersionId,
      applyTextNormalization: this.cfg.applyTextNormalization,
    });
    return {
      audio: result.audio,
      alignment: result.alignment,
      durationSeconds: result.durationSeconds,
      charactersSynthesized: result.charactersSynthesized,
    };
  }
}
