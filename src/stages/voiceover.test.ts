import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// No real audio/ffmpeg in this test: the fake provider returns a dummy buffer
// and a synthetic alignment, and ffprobe/ffmpeg are stubbed.
vi.mock('../voiceover/ffmpeg.js', () => ({
  ffprobeDuration: vi.fn(async () => 10),
  runFfmpeg: vi.fn(async () => {}),
}));

// Keep the real pure helpers (parseUtmosScore/naturalnessVerdict); stub only the
// sidecar call so the stage doesn't spawn Python in tests.
const naturalnessMock = vi.hoisted(() => ({ score: null as number | null }));
vi.mock('../voiceover/naturalness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../voiceover/naturalness.js')>()),
  scoreNaturalness: vi.fn(async () => naturalnessMock.score),
}));

vi.mock('../voiceover/g2p.js', async (orig) => ({
  ...(await orig<typeof import('../voiceover/g2p.js')>()),
  phonemizeTokens: vi.fn(async () => ({ Zorptang: 'ˈzɔːptæŋ' })),
}));

import { voiceoverStage } from './voiceover.js';
import { showrunnerConfigSchema } from '../config/schema.js';
import type { PipelineContext } from '../pipeline/types.js';
import type { Manifest } from '../manifest/schema.js';
import type { TTSProvider } from '../providers/tts/types.js';

function makeManifest(): Manifest {
  return {
    total_duration_seconds: 12,
    generated_from: 'product_model.json',
    segments: [
      {
        id: 'intro',
        label: 'Intro',
        start: 0,
        end: 6,
        vo_line: 'Press Ctrl+Z to undo.',
        actions: [{ type: 'idle', at: 0 }],
        transition: 'fade_in',
      },
      {
        id: 'outro',
        label: 'Outro',
        start: 6,
        end: 12,
        vo_line: 'It costs $0/month.',
        actions: [{ type: 'idle', at: 0 }],
        transition: 'fade_out',
      },
    ],
  } as unknown as Manifest;
}

function makeFakeProvider(): { provider: TTSProvider; calls: string[] } {
  const calls: string[] = [];
  const provider: TTSProvider = {
    name: 'fake',
    supportsAlignment: true,
    async synthesize(req) {
      calls.push(req.text);
      // EL consumes SSML break tags — they don't appear in the spoken alignment.
      const chars = req.text.replace(/<break[^>]*\/>/g, '').split('');
      return {
        audio: Buffer.from('FAKE-AUDIO'),
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
  return { provider, calls };
}

function makeCtx(
  projectDir: string,
  provider: TTSProvider,
  voiceoverOverrides: Record<string, unknown> = {},
): PipelineContext {
  const config = showrunnerConfigSchema.parse({
    project: { name: 'FreezeTest' },
    recording: { target_url: 'https://example.com' },
    voiceover: { provider: { name: 'elevenlabs', voice_id: 'v1' }, ...voiceoverOverrides },
  });
  return {
    config,
    configPath: join(projectDir, 'demo.yaml'),
    configDir: projectDir,
    runId: 'test-run',
    interactive: false,
    forced: new Set(),
    overrides: {},
    providers: { tts: provider },
  } as unknown as PipelineContext;
}

async function writeManifestFile(projectDir: string, manifest: Manifest): Promise<void> {
  await writeFile(
    join(projectDir, 'scripts', 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
}

describe('voiceover stage — normalization + freeze wiring', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'showrunner-vo-'));
    await mkdir(join(projectDir, 'scripts'), { recursive: true });
    await writeManifestFile(projectDir, makeManifest());
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('synthesizes the normalized spoken text but leaves the manifest vo_line human-readable', async () => {
    const { provider, calls } = makeFakeProvider();
    const result = await voiceoverStage.run(makeCtx(projectDir, provider));

    expect(result.skipped).toBeFalsy();
    expect(calls).toHaveLength(1);
    // The synthesized master text is normalized…
    expect(calls[0]).toContain('Control Z');
    expect(calls[0]).toContain('zero dollars per month');
    expect(calls[0]).not.toContain('Ctrl+Z');
    expect(calls[0]).not.toContain('$0/month');

    // …but the manifest on disk keeps the original, human-readable lines.
    const manifest = JSON.parse(await readFile(join(projectDir, 'scripts', 'manifest.json'), 'utf8'));
    expect(manifest.segments[0].vo_line).toBe('Press Ctrl+Z to undo.');
    expect(manifest.segments[1].vo_line).toBe('It costs $0/month.');

    // The QA gate passed (alignment matches, nothing leaked) and is recorded.
    const summary = JSON.parse(
      await readFile(join(projectDir, 'segments', 'audio', 'voiceover_summary.json'), 'utf8'),
    );
    expect(summary.gate.ok).toBe(true);
    expect(summary.normalization.substitutions).toBe(3);
    expect(summary.freeze.reused).toBe(false);
    expect(typeof summary.freeze.key).toBe('string');
  });

  it('reuses the frozen master on an unchanged re-run, and re-synthesizes after a script edit', async () => {
    const { provider, calls } = makeFakeProvider();

    await voiceoverStage.run(makeCtx(projectDir, provider));
    expect(calls).toHaveLength(1);

    // Unchanged inputs → freeze-key hit → no second synthesis.
    await voiceoverStage.run(makeCtx(projectDir, provider));
    expect(calls).toHaveLength(1);

    // Edit a line → key busts → re-synthesis (no --force needed).
    const edited = makeManifest();
    edited.segments[0]!.vo_line = 'Press Ctrl+C to copy.';
    await writeManifestFile(projectDir, edited);

    await voiceoverStage.run(makeCtx(projectDir, provider));
    expect(calls).toHaveLength(2);
  });

  it('halts when gate policy is "fail" and a token leaks (normalization disabled)', async () => {
    const { provider } = makeFakeProvider();
    const result = await voiceoverStage.run(
      makeCtx(projectDir, provider, { normalization: { enabled: false }, gate: { policy: 'fail' } }),
    );
    expect(result.halt).toBe(true);
    expect(result.reason).toMatch(/gate failed/);
  });

  it('records a below-floor naturalness score (advisory) without halting', async () => {
    naturalnessMock.score = 1.5;
    const { provider } = makeFakeProvider();
    const result = await voiceoverStage.run(
      makeCtx(projectDir, provider, { naturalness: { enabled: true, floor: 2.0 } }),
    );
    expect(result.halt).toBeFalsy();

    const summary = JSON.parse(
      await readFile(join(projectDir, 'segments', 'audio', 'voiceover_summary.json'), 'utf8'),
    );
    expect(summary.naturalness.available).toBe(true);
    expect(summary.naturalness.score).toBe(1.5);
    expect(summary.naturalness.belowFloor).toBe(true);
  });

  it('injects IPA phonemes for OOV tokens when g2p is enabled and provider is eleven_v3', async () => {
    const manifest = makeManifest();
    manifest.segments[0]!.vo_line = 'Open Zorptang now.';
    await writeManifestFile(projectDir, manifest);

    const { provider, calls } = makeFakeProvider();
    const result = await voiceoverStage.run(
      makeCtx(projectDir, provider, {
        provider: { name: 'elevenlabs', voice_id: 'v1', model: 'eleven_v3' },
        g2p: { enabled: true },
      }),
    );

    expect(result.skipped).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/ˈzɔːptæŋ/);
  });
});
