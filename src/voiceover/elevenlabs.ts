import { request } from 'undici';
import { logger } from '../util/logger.js';

const BASE_URL = 'https://api.elevenlabs.io';

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

export interface SynthesisRequest {
  voiceId: string;
  modelId: string;
  text: string;
  voiceSettings: VoiceSettings;
  apiKey: string;
  /** ElevenLabs pronunciation-dictionary id (uploaded once, recorded in config). */
  pronunciationDictionaryId?: string;
  /** Version id pinning a specific dictionary revision. */
  pronunciationDictionaryVersionId?: string;
  /** EL's own text normalization. Default 'off' — our pre-pass owns it. */
  applyTextNormalization?: 'auto' | 'on' | 'off';
}

export interface WithTimestampsResponse {
  audio_base64: string;
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
}

export interface SynthesisResult {
  audio: Buffer;
  alignment?: WithTimestampsResponse['alignment'];
  durationSeconds: number;
  charactersSynthesized: number;
}

export class ElevenLabsError extends Error {
  override readonly name = 'ElevenLabsError';
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

/**
 * Build the POST body for a TTS request, attaching the pronunciation-dictionary
 * locator and text-normalization mode only when configured.
 */
export function buildSynthesisBody(req: SynthesisRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    text: req.text,
    model_id: req.modelId,
    voice_settings: req.voiceSettings,
  };
  if (req.applyTextNormalization) {
    body.apply_text_normalization = req.applyTextNormalization;
  }
  if (req.pronunciationDictionaryId) {
    body.pronunciation_dictionary_locators = [
      {
        pronunciation_dictionary_id: req.pronunciationDictionaryId,
        ...(req.pronunciationDictionaryVersionId
          ? { version_id: req.pronunciationDictionaryVersionId }
          : {}),
      },
    ];
  }
  return body;
}

const MAX_ATTEMPTS = 3;

export async function synthesizeWithTimestamps(req: SynthesisRequest): Promise<SynthesisResult> {
  const url = `${BASE_URL}/v1/text-to-speech/${encodeURIComponent(req.voiceId)}/with-timestamps`;
  const body = buildSynthesisBody(req);

  const responseJson = await postWithRetry(url, body, req.apiKey, 'json');
  const parsed = responseJson as WithTimestampsResponse;
  if (
    typeof parsed.audio_base64 !== 'string' ||
    !parsed.alignment ||
    !Array.isArray(parsed.alignment.character_end_times_seconds)
  ) {
    throw new ElevenLabsError(
      'ElevenLabs with_timestamps response shape unexpected',
      200,
      JSON.stringify(parsed).slice(0, 500),
    );
  }

  const audio = Buffer.from(parsed.audio_base64, 'base64');
  const endTimes = parsed.alignment.character_end_times_seconds;
  const durationSeconds = endTimes.length > 0 ? (endTimes[endTimes.length - 1] ?? 0) : 0;

  return {
    audio,
    alignment: parsed.alignment,
    durationSeconds,
    charactersSynthesized: req.text.length,
  };
}

export async function synthesizeBasic(req: SynthesisRequest): Promise<Omit<SynthesisResult, 'durationSeconds'>> {
  const url = `${BASE_URL}/v1/text-to-speech/${encodeURIComponent(req.voiceId)}`;
  const body = buildSynthesisBody(req);

  const audio = (await postWithRetry(url, body, req.apiKey, 'binary')) as Buffer;
  return {
    audio,
    charactersSynthesized: req.text.length,
  };
}

async function postWithRetry(
  url: string,
  body: unknown,
  apiKey: string,
  responseMode: 'json' | 'binary',
): Promise<unknown> {
  let lastError: ElevenLabsError | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await postOnce(url, body, apiKey, responseMode);
    } catch (err) {
      if (!(err instanceof ElevenLabsError)) throw err;
      lastError = err;
      const retriable = err.status === 429 || err.status >= 500;
      if (!retriable || attempt === MAX_ATTEMPTS) break;
      const backoffMs = Math.min(8000, 500 * 2 ** (attempt - 1));
      logger.warn(`ElevenLabs ${err.status} on attempt ${attempt}, retrying in ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }
  throw lastError ?? new ElevenLabsError('ElevenLabs request failed', 0, '');
}

async function postOnce(
  url: string,
  body: unknown,
  apiKey: string,
  responseMode: 'json' | 'binary',
): Promise<unknown> {
  const res = await request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: responseMode === 'json' ? 'application/json' : 'audio/mpeg',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (res.statusCode >= 400) {
    const errBody = await res.body.text();
    throw new ElevenLabsError(
      `ElevenLabs ${res.statusCode}: ${errBody.slice(0, 300)}`,
      res.statusCode,
      errBody,
    );
  }

  if (responseMode === 'json') {
    return await res.body.json();
  }
  const buf = Buffer.from(await res.body.arrayBuffer());
  return buf;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
