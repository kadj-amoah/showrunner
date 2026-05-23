import { runFfmpeg } from '../voiceover/ffmpeg.js';
import type { Transition } from '../manifest/schema.js';
import { resolveQuality, type QualityPreset } from './quality.js';

export interface SegmentMuxOptions {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  fps: number;
  width: number;
  height: number;
  transition: Transition;
  quality?: QualityPreset;
  threads?: number;
}

const FADE_IN_DURATION_S = 0.5;
const FADE_OUT_DURATION_S = 0.5;

export async function muxSegment(opts: SegmentMuxOptions): Promise<void> {
  const q = resolveQuality(opts.quality ?? 'standard');
  const videoFilters: string[] = [];
  if (opts.transition === 'fade_in') {
    videoFilters.push(`fade=t=in:st=0:d=${FADE_IN_DURATION_S}`);
  } else if (opts.transition === 'fade_out') {
    videoFilters.push(`fade=t=out:st=0:d=${FADE_OUT_DURATION_S}`);
  }

  const args: string[] = ['-y', '-i', opts.videoPath, '-i', opts.audioPath];
  if (videoFilters.length > 0) {
    args.push('-vf', videoFilters.join(','));
  }
  args.push(
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-preset',
    q.preset,
    '-crf',
    String(q.crf),
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(opts.fps),
    '-g',
    String(opts.fps),
    '-c:a',
    'aac',
    '-b:a',
    q.audioBitrate,
    '-shortest',
    opts.outputPath,
  );
  await runFfmpeg({
    args,
    threads: opts.threads,
    hintContext: { width: opts.width, height: opts.height },
  });
}
