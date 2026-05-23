import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { runFfmpeg } from '../voiceover/ffmpeg.js';
import { normalizeVideo } from './normalize.js';
import { resolveQuality, type QualityPreset } from './quality.js';

const sliceSegmentSchema = z.object({
  id: z.string(),
  t_start: z.number(),
  t_end: z.number(),
  status: z.enum(['ok', 'failed']),
  failure_reason: z.string().optional(),
  failure_screenshots: z.array(z.string()).default([]),
  warnings: z.array(z.string()).optional(),
  trace_path: z.string().optional(),
});

export const slicePlanSchema = z.object({
  recording_path: z.string(),
  recording_started_at: z.string(),
  segments: z.array(sliceSegmentSchema),
});

export type SlicePlan = z.infer<typeof slicePlanSchema>;

export async function readSlicePlan(path: string): Promise<SlicePlan> {
  const raw = await readFile(path, 'utf8');
  return slicePlanSchema.parse(JSON.parse(raw));
}

export interface SliceSegmentInput {
  id: string;
  videoDir: string;
  workDir: string;
  normalizedMasterPath: string;
  slicePlan: SlicePlan;
  fps: number;
  width: number;
  height: number;
  quality?: QualityPreset;
  threads?: number;
}

export interface SegmentVideoSource {
  segment_id: string;
  source: 'rerun' | 'master_slice';
  path: string;
  duration_hint: number;
}

export async function prepareSegmentVideo(input: SliceSegmentInput): Promise<SegmentVideoSource> {
  const q = resolveQuality(input.quality ?? 'standard');
  const rerunWebm = join(input.videoDir, `${input.id}.webm`);
  const rerunMeta = join(input.videoDir, `${input.id}.rerun.json`);
  if ((await fileExists(rerunWebm)) && (await fileExists(rerunMeta))) {
    const out = join(input.workDir, `${input.id}.mp4`);
    await normalizeVideo({
      inputPath: rerunWebm,
      outputPath: out,
      fps: input.fps,
      width: input.width,
      height: input.height,
      quality: input.quality,
      threads: input.threads,
    });
    return {
      segment_id: input.id,
      source: 'rerun',
      path: out,
      duration_hint: 0,
    };
  }

  const slice = input.slicePlan.segments.find((s) => s.id === input.id);
  if (!slice) {
    throw new Error(
      `slice_plan.json has no entry for segment "${input.id}". Re-run the record stage.`,
    );
  }

  const out = join(input.workDir, `${input.id}.mp4`);
  const duration = slice.t_end - slice.t_start;
  await runFfmpeg({
    args: [
      '-y',
      '-ss',
      slice.t_start.toFixed(3),
      '-i',
      input.normalizedMasterPath,
      '-t',
      duration.toFixed(3),
      '-c:v',
      'libx264',
      '-preset',
      q.preset,
      '-crf',
      String(q.crf),
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(input.fps),
      '-g',
      String(input.fps),
      '-an',
      out,
    ],
    threads: input.threads,
    hintContext: { width: input.width, height: input.height },
  });
  return {
    segment_id: input.id,
    source: 'master_slice',
    path: out,
    duration_hint: duration,
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
