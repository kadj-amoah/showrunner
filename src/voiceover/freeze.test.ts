import { describe, it, expect } from 'vitest';
import { masterFreezeKey, shouldReuseMaster } from './freeze.js';

describe('masterFreezeKey', () => {
  const base = {
    text: 'Hello world.',
    voiceConfig: { name: 'elevenlabs', voice_id: 'v1', model: 'eleven_multilingual_v2', stability: 0.55 },
  };

  it('is stable for identical input', () => {
    expect(masterFreezeKey(base)).toBe(masterFreezeKey({ ...base }));
  });

  it('changes when the master text changes', () => {
    expect(masterFreezeKey(base)).not.toBe(masterFreezeKey({ ...base, text: 'Hello world!' }));
  });

  it('changes when a voice setting changes', () => {
    expect(masterFreezeKey(base)).not.toBe(
      masterFreezeKey({ ...base, voiceConfig: { ...base.voiceConfig, stability: 0.6 } }),
    );
  });

  it('is independent of key order in voiceConfig', () => {
    expect(masterFreezeKey({ text: 'X', voiceConfig: { a: 1, b: 2 } })).toBe(
      masterFreezeKey({ text: 'X', voiceConfig: { b: 2, a: 1 } }),
    );
  });

  it('changes when the pronunciation-dict version changes', () => {
    expect(masterFreezeKey({ ...base, pronunciationDictVersion: '1' })).not.toBe(
      masterFreezeKey({ ...base, pronunciationDictVersion: '2' }),
    );
  });
});

describe('shouldReuseMaster', () => {
  const ok = { forced: false, audioExists: true, alignmentExists: true, savedKey: 'k', currentKey: 'k' };

  it('reuses when not forced, files exist, and keys match', () => {
    expect(shouldReuseMaster(ok)).toBe(true);
  });
  it('does not reuse when forced', () => {
    expect(shouldReuseMaster({ ...ok, forced: true })).toBe(false);
  });
  it('does not reuse when the key changed', () => {
    expect(shouldReuseMaster({ ...ok, currentKey: 'different' })).toBe(false);
  });
  it('does not reuse when the audio is missing', () => {
    expect(shouldReuseMaster({ ...ok, audioExists: false })).toBe(false);
  });
  it('does not reuse when there is no saved key', () => {
    expect(shouldReuseMaster({ ...ok, savedKey: null })).toBe(false);
  });
});
