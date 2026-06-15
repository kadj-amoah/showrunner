import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../voiceover/ffmpeg.js', () => ({
  ffprobeDuration: vi.fn(async () => 10),
  runFfmpeg: vi.fn(async () => {}),
}));

import { runAdHocSynthesis } from './synthesize.js';
import type { TTSProvider } from '../providers/tts/types.js';

function fakeProvider(calls: string[]): TTSProvider {
  return {
    name: 'fake',
    supportsAlignment: true,
    async synthesize(req) {
      calls.push(req.text);
      const chars = req.text.replace(/<break[^>]*\/>/g, '').split('');
      return {
        audio: Buffer.from('FAKE'),
        alignment: {
          characters: chars,
          character_start_times_seconds: chars.map((_, i) => i * 0.1),
          character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1),
        },
        durationSeconds: chars.length * 0.1,
        charactersSynthesized: req.text.length,
      };
    },
  };
}

describe('runAdHocSynthesis', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'studio-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('synthesizes normalized text and returns diagnostics + audio path', async () => {
    const calls: string[] = [];
    const res = await runAdHocSynthesis(
      { script: 'Press Ctrl+Z to undo.', voiceId: 'v1', model: 'eleven_multilingual_v2' },
      { runsRoot: root, provider: fakeProvider(calls) },
    );
    expect(calls[0]).toContain('Control Z');
    expect(res.summary.normalization.substitutions).toBeGreaterThan(0);
    expect(res.summary.freeze.reused).toBe(false);
    expect(res.audioPath).toMatch(/_master\.raw\.mp3$/);
  });

  it('reuses the frozen master on an identical re-run (no second synth)', async () => {
    const calls: string[] = [];
    const opts = { runsRoot: root, provider: fakeProvider(calls) };
    const input = { script: 'Hello there.', voiceId: 'v1', model: 'eleven_multilingual_v2' };
    await runAdHocSynthesis(input, opts);
    const second = await runAdHocSynthesis(input, opts);
    expect(calls).toHaveLength(1);
    expect(second.summary.freeze.reused).toBe(true);
  });
});
