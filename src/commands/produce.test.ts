import { describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { produceCommand } from './produce.js';
import type { PipelineResult } from '../pipeline/types.js';

// A spec the produceSpecSchema accepts: a 3s single-segment capture manifest.
const baseSpec = {
  project_name: 'demo',
  target_url: 'https://example.com',
  voice_id: 'v1',
  resolution: '1920x1080',
  manifest: {
    total_duration_seconds: 3,
    segments: [{ id: 's1', label: 'A', start: 0, end: 3, vo_line: 'Hi there' }],
  },
};

// A fake pipeline run: returns a mux StageResult whose artifacts.output is the final mp4.
function fakeRun(
  finalMp4: string,
  opts: { duration?: number; warnings?: string[] } = {},
): () => Promise<PipelineResult> {
  return async () => ({
    runId: 'run-test',
    outputPath: finalMp4,
    buildManifestPath: 'build_manifest.json',
    stages: [
      { stage: 'voiceover', skipped: false, durationMs: 1, warnings: [] },
      { stage: 'record', skipped: false, durationMs: 1, warnings: [] },
      {
        stage: 'mux',
        skipped: false,
        durationMs: 1,
        warnings: opts.warnings ?? [],
        artifacts: { output: finalMp4 },
        meta: { duration_seconds: opts.duration },
      },
    ],
  });
}

async function freshOut(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'produce-'));
}

async function writeSpec(out: string, spec: unknown): Promise<string> {
  const specPath = join(out, 'spec.json');
  await writeFile(specPath, JSON.stringify(spec));
  return specPath;
}

async function readRealized(out: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(out, 'realized.json'), 'utf8')) as Record<string, unknown>;
}

describe('produce harness', () => {
  it('emits an ok realized with the mux mp4, measured duration, and word markers', async () => {
    const out = await freshOut();
    const specPath = await writeSpec(out, baseSpec);
    // master alignment → word markers; 1s/char integer timebase (no float noise)
    const chars = [...'Hi there'];
    await mkdir(join(out, 'segments', 'alignment'), { recursive: true });
    await writeFile(
      join(out, 'segments', 'alignment', '_master.alignment.json'),
      JSON.stringify({
        characters: chars,
        character_start_times_seconds: chars.map((_, i) => i),
        character_end_times_seconds: chars.map((_, i) => i + 1),
      }),
    );
    const finalMp4 = join(out, 'output', 'demo_final.mp4');

    await produceCommand(specPath, { out }, { runPipeline: fakeRun(finalMp4, { duration: 3 }) as never });

    const r = await readRealized(out);
    expect(r.status).toBe('ok');
    expect((r.media as Record<string, unknown>).url).toBe(finalMp4);
    expect((r.media as Record<string, unknown>).intrinsic_duration).toBe(3);
    expect(r.markers).toEqual([
      { name: 'Hi', t: 0 },
      { name: 'there', t: 3 },
    ]);
    expect(r.aspects).toEqual(['1920x1080']);
    expect(r.hash).toBeTruthy();
    // the capture manifest is scaffolded for the pipeline to consume
    const written = JSON.parse(await readFile(join(out, 'scripts', 'manifest.json'), 'utf8'));
    expect(written.segments[0].id).toBe('s1');
  });

  it('falls back to ffprobe when the mux stage reports no duration', async () => {
    const out = await freshOut();
    const specPath = await writeSpec(out, baseSpec);
    const finalMp4 = join(out, 'output', 'demo_final.mp4');
    let probed = '';

    await produceCommand(
      specPath,
      { out },
      {
        runPipeline: fakeRun(finalMp4) as never, // no meta.duration_seconds
        probe: (async (p: string) => {
          probed = p;
          return 7.25;
        }) as never,
      },
    );

    const r = await readRealized(out);
    expect(probed).toBe(finalMp4);
    expect((r.media as Record<string, unknown>).intrinsic_duration).toBe(7.25);
  });

  it('marks degraded when a stage emits warnings', async () => {
    const out = await freshOut();
    const specPath = await writeSpec(out, baseSpec);
    const finalMp4 = join(out, 'output', 'demo_final.mp4');

    await produceCommand(
      specPath,
      { out },
      { runPipeline: fakeRun(finalMp4, { duration: 3, warnings: ['vo drift on s1'] }) as never },
    );

    const r = await readRealized(out);
    expect(r.status).toBe('degraded');
    expect(r.reason).toContain('vo drift on s1');
  });

  it('marks failed (and never throws) when the pipeline throws', async () => {
    const out = await freshOut();
    const specPath = await writeSpec(out, baseSpec);
    const boom = (async () => {
      throw new Error('record stage crashed');
    }) as never;

    await expect(produceCommand(specPath, { out }, { runPipeline: boom })).resolves.toBeUndefined();

    const r = await readRealized(out);
    expect(r.status).toBe('failed');
    expect(r.reason).toContain('record stage crashed');
  });

  it('threads a session auth from the spec into the recording config the pipeline receives', async () => {
    // SP-cap-1c: the record browser is a separate pass from author-plan's explore browser.
    // MAIViS attaches a `session` auth (the storageState it saved) to the produce spec so the
    // record pass reuses that session and captures the real target, not a login redirect.
    const out = await freshOut();
    const auth = { type: 'session', cookies_file: '/sessions/localhost_3000.json' };
    const specPath = await writeSpec(out, { ...baseSpec, auth });
    const finalMp4 = join(out, 'output', 'demo_final.mp4');

    let seenConfig: Record<string, unknown> | undefined;
    const capturingRun = (async (config: Record<string, unknown>) => {
      seenConfig = config;
      return fakeRun(finalMp4, { duration: 3 })();
    }) as never;

    await produceCommand(specPath, { out }, { runPipeline: capturingRun });

    const recording = (seenConfig?.config as Record<string, unknown>).recording as Record<string, unknown>;
    expect(recording.auth).toEqual(auth);
  });

  it('leaves the recording auth unset when the spec omits auth', async () => {
    const out = await freshOut();
    const specPath = await writeSpec(out, baseSpec); // no auth key
    const finalMp4 = join(out, 'output', 'demo_final.mp4');

    let seenConfig: Record<string, unknown> | undefined;
    const capturingRun = (async (config: Record<string, unknown>) => {
      seenConfig = config;
      return fakeRun(finalMp4, { duration: 3 })();
    }) as never;

    await produceCommand(specPath, { out }, { runPipeline: capturingRun });

    const recording = (seenConfig?.config as Record<string, unknown>).recording as Record<string, unknown>;
    expect(recording.auth).toBeUndefined();
  });

  it('marks failed on an invalid spec without running the pipeline', async () => {
    const out = await freshOut();
    const specPath = await writeSpec(out, { project_name: '' }); // missing required fields
    const guard = (async () => {
      throw new Error('pipeline should not run for an invalid spec');
    }) as never;

    await produceCommand(specPath, { out }, { runPipeline: guard });

    const r = await readRealized(out);
    expect(r.status).toBe('failed');
    expect(r.reason).toContain('invalid produce spec');
  });
});
