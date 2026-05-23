import { runFfmpeg } from '../voiceover/ffmpeg.js';
import { resolveQuality, type QualityPreset } from './quality.js';

export interface NormalizeOptions {
  inputPath: string;
  outputPath: string;
  fps: number;
  width: number;
  height: number;
  quality?: QualityPreset;
  threads?: number;
}

export async function normalizeVideo(opts: NormalizeOptions): Promise<void> {
  const q = resolveQuality(opts.quality ?? 'standard');
  const scaleFilter =
    `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease,` +
    `pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
    `setsar=1,format=yuv420p`;

  await runFfmpeg({
    args: [
      '-y',
      '-i',
      opts.inputPath,
      '-vf',
      scaleFilter,
      '-r',
      String(opts.fps),
      '-g',
      String(opts.fps),
      '-c:v',
      'libx264',
      '-preset',
      q.preset,
      '-crf',
      String(q.crf),
      '-pix_fmt',
      'yuv420p',
      '-an',
      opts.outputPath,
    ],
    threads: opts.threads,
    hintContext: { width: opts.width, height: opts.height },
  });
}
