import OpenAI from 'openai';
import { ffprobeDurationFromStdin } from '../../voiceover/ffmpeg.js';
import type {
  TTSProvider,
  TTSSynthesisRequest,
  TTSSynthesisResult,
} from './types.js';
import { TTSProviderError } from './types.js';

export interface OpenAITTSProviderConfig {
  apiKey: string;
  /** Voice id, e.g. 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'. */
  voice: string;
  /** Model, e.g. 'tts-1', 'tts-1-hd', or 'gpt-4o-mini-tts'. */
  model: string;
  /** Override the API base (Azure / OpenRouter / etc). */
  baseURL?: string;
}

export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai';
  readonly supportsAlignment = false;

  private readonly client: OpenAI;

  constructor(private readonly cfg: OpenAITTSProviderConfig) {
    if (!cfg.apiKey) {
      throw new TTSProviderError(
        'OpenAITTSProvider: apiKey is required',
        'openai',
      );
    }
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
  }

  async synthesize(req: TTSSynthesisRequest): Promise<TTSSynthesisResult> {
    let response;
    try {
      response = await this.client.audio.speech.create({
        model: this.cfg.model,
        voice: (req.voice ?? this.cfg.voice) as 'alloy',
        input: req.text,
        response_format: 'mp3',
        speed: req.speed ?? 1.0,
      });
    } catch (err) {
      throw new TTSProviderError(
        `OpenAI TTS call failed: ${err instanceof Error ? err.message : String(err)}`,
        'openai',
        err,
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);
    const durationSeconds = await ffprobeDurationFromStdin(audio);
    return {
      audio,
      // OpenAI TTS does not return character/word alignment.
      alignment: undefined,
      durationSeconds,
      charactersSynthesized: req.text.length,
    };
  }
}
