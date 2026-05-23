import { runFfmpeg } from './ffmpeg.js';

export interface SilencePeriod {
  start: number;
  end: number;
  duration: number;
  mid: number;
}

export interface DetectOptions {
  noiseDb?: string;
  minDuration?: number;
}

export async function detectSilences(
  path: string,
  opts: DetectOptions = {},
): Promise<SilencePeriod[]> {
  const noiseDb = opts.noiseDb ?? '-32dB';
  const minDuration = opts.minDuration ?? 0.12;
  const filter = `silencedetect=noise=${noiseDb}:d=${minDuration}`;

  const { stderr } = await runFfmpeg({
    args: ['-i', path, '-af', filter, '-f', 'null', '-'],
  });
  return parseSilenceLog(stderr);
}

export function parseSilenceLog(stderr: string): SilencePeriod[] {
  const startRe = /silence_start:\s*(-?[\d.]+)/;
  const endRe = /silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*(-?[\d.]+)/;
  const periods: SilencePeriod[] = [];
  const pendingStarts: number[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = startRe.exec(line);
    if (startMatch) {
      pendingStarts.push(Number.parseFloat(startMatch[1]!));
      continue;
    }
    const endMatch = endRe.exec(line);
    if (endMatch && pendingStarts.length > 0) {
      const end = Number.parseFloat(endMatch[1]!);
      const duration = Number.parseFloat(endMatch[2]!);
      const start = pendingStarts.shift()!;
      periods.push({ start, end, duration, mid: (start + end) / 2 });
    }
  }
  return periods;
}
