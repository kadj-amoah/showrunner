import type { CharacterAlignment } from '../../manifest/alignment.js';

export interface TTSSynthesisRequest {
  text: string;
  /** Provider-specific voice id; falls back to whatever the provider was constructed with. */
  voice?: string;
  /** Playback speed multiplier (provider-dependent; safe range typically 0.85–1.15). */
  speed?: number;
}

export interface TTSSynthesisResult {
  audio: Buffer;
  /** Character-level timing data. Optional — only ElevenLabs `with_timestamps` returns this today. */
  alignment?: CharacterAlignment;
  durationSeconds: number;
  charactersSynthesized: number;
}

export interface TTSProvider {
  /** Provider name for logging/diagnostics. */
  readonly name: string;
  /** True if this provider returns character-level alignment data. */
  readonly supportsAlignment: boolean;
  synthesize(req: TTSSynthesisRequest): Promise<TTSSynthesisResult>;
}

export class TTSProviderError extends Error {
  override readonly name = 'TTSProviderError';
  constructor(
    message: string,
    readonly providerName: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}
