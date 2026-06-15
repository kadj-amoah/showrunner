import { describe, it, expect } from 'vitest';
import { buildSynthesisBody } from './elevenlabs.js';

const base = {
  voiceId: 'v1',
  modelId: 'eleven_multilingual_v2',
  text: 'Hello.',
  voiceSettings: { stability: 0.55, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 },
  apiKey: 'k',
};

describe('buildSynthesisBody', () => {
  it('carries text, model_id and voice_settings', () => {
    const body = buildSynthesisBody(base);
    expect(body.text).toBe('Hello.');
    expect(body.model_id).toBe('eleven_multilingual_v2');
    expect(body.voice_settings).toEqual(base.voiceSettings);
  });

  it('adds a pronunciation dictionary locator when an id is configured', () => {
    const body = buildSynthesisBody({
      ...base,
      pronunciationDictionaryId: 'dict_1',
      pronunciationDictionaryVersionId: 'ver_3',
    });
    expect(body.pronunciation_dictionary_locators).toEqual([
      { pronunciation_dictionary_id: 'dict_1', version_id: 'ver_3' },
    ]);
  });

  it('omits the locator when no dictionary is configured', () => {
    expect(buildSynthesisBody(base).pronunciation_dictionary_locators).toBeUndefined();
  });

  it('passes apply_text_normalization through when set', () => {
    expect(buildSynthesisBody({ ...base, applyTextNormalization: 'off' }).apply_text_normalization).toBe('off');
  });
});
