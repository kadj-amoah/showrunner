import { stat } from 'node:fs/promises';
import { runFfmpeg } from '../voiceover/ffmpeg.js';
import { resolveQuality, type QualityPreset } from './quality.js';

export interface CardOptions {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  text: string;
  textColor: string;
  backgroundColor: string;
  fontPath?: string;
  fontSize: number;
  logoPath?: string;
  logoPosition?: 'top_left' | 'top_center' | 'top_right';
  quality?: QualityPreset;
  threads?: number;
}

export async function renderCard(opts: CardOptions): Promise<void> {
  const q = resolveQuality(opts.quality ?? 'standard');
  const fontDirective = opts.fontPath
    ? `fontfile=${escapeFilterPath(opts.fontPath)}:`
    : '';
  const escapedText = escapeFilterText(opts.text);
  const drawText =
    `drawtext=${fontDirective}` +
    `text=${escapedText}:` +
    `fontsize=${opts.fontSize}:` +
    `fontcolor=${ffmpegColor(opts.textColor)}:` +
    `x=(w-text_w)/2:` +
    `y=(h-text_h)/2`;

  const args: string[] = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${ffmpegColor(opts.backgroundColor)}:s=${opts.width}x${opts.height}:r=${opts.fps}:d=${opts.durationSeconds}`,
    '-f',
    'lavfi',
    '-i',
    `anullsrc=channel_layout=stereo:sample_rate=44100`,
  ];

  if (opts.logoPath) {
    args.push('-i', opts.logoPath);
    const overlayXY = logoOverlayPosition(opts.logoPosition ?? 'top_center');
    args.push(
      '-filter_complex',
      `[0:v]${drawText}[bg];[bg][2:v]overlay=${overlayXY}[v]`,
      '-map',
      '[v]',
    );
  } else {
    args.push('-vf', drawText, '-map', '0:v');
  }

  args.push(
    '-map',
    '1:a',
    '-t',
    String(opts.durationSeconds),
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
    opts.outputPath,
  );

  await runFfmpeg({
    args,
    threads: opts.threads,
    hintContext: { width: opts.width, height: opts.height },
  });
}

export interface BackgroundMusicOptions {
  inputPath: string;
  outputPath: string;
  musicPath: string;
  volumeDb: number;
  quality?: QualityPreset;
  threads?: number;
}

export async function applyBackgroundMusic(opts: BackgroundMusicOptions): Promise<void> {
  const q = resolveQuality(opts.quality ?? 'standard');
  const volumeFactor = Math.pow(10, opts.volumeDb / 20);
  const filterComplex =
    `[1:a]volume=${volumeFactor.toFixed(4)},aloop=loop=-1:size=2e9[bg];` +
    `[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`;
  await runFfmpeg({
    args: [
      '-y',
      '-i',
      opts.inputPath,
      '-i',
      opts.musicPath,
      '-filter_complex',
      filterComplex,
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      q.audioBitrate,
      '-shortest',
      opts.outputPath,
    ],
    threads: opts.threads,
  });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function escapeFilterText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,');
}

function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\\\:');
}

function ffmpegColor(value: string): string {
  if (value.startsWith('#')) {
    return `0x${value.slice(1)}`;
  }
  return value;
}

function logoOverlayPosition(pos: 'top_left' | 'top_center' | 'top_right'): string {
  switch (pos) {
    case 'top_left':
      return 'x=24:y=24';
    case 'top_right':
      return 'x=W-w-24:y=24';
    case 'top_center':
    default:
      return 'x=(W-w)/2:y=24';
  }
}
