import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../voiceover/ffmpeg.js', () => ({
  ffprobeDuration: vi.fn(async () => 10),
  runFfmpeg: vi.fn(async () => {}),
}));

// Stub the espeak sidecar so the resolver test never spawns Python.
vi.mock('../voiceover/g2p.js', async (orig) => ({
  ...(await orig<typeof import('../voiceover/g2p.js')>()),
  phonemizeByLanguage: vi.fn(async () => ({})),
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

  it('routes the resolver through a local agent_bridge LLM (no API key)', async () => {
    const calls: string[] = [];
    // A hermetic "LLM": a node one-liner that ignores stdin and prints the
    // resolver's structured verdict. Proves opts.llm threads into the stage and
    // the agent_bridge provider drives the resolver — no API key, no network.
    const verdict = JSON.stringify({
      tokens: [
        { token: 'BoG', class: 'initialism', mode: 'expand', expansion: 'Bank of Ghana', confidence: 0.95, alternatives: [], rationale: 't' },
      ],
    });
    // A script file (not `node -e`) so win32 shell:true can't mangle the args.
    const bridgePath = join(root, 'fake-bridge.cjs');
    await writeFile(bridgePath, `process.stdout.write(${JSON.stringify(verdict)})\n`, 'utf8');
    const res = await runAdHocSynthesis(
      { script: 'Open the BoG report.', voiceId: 'v1', model: 'eleven_v3', g2p: true },
      {
        runsRoot: root,
        provider: fakeProvider(calls),
        llm: {
          default: { provider: 'agent_bridge', bridge: { mode: 'spawn', command: 'node', args: [bridgePath] } },
        },
      },
    );
    // The resolver (via the bridge) expanded BoG, and that reached the synth text.
    expect(calls[0]).toContain('Bank of Ghana');
    expect(res.summary.pronunciation).not.toBeNull();
  });
});
