import { runFfmpeg } from './ffmpeg.js';

const DEBREATH_FILTER =
  'silenceremove=start_periods=1:start_duration=0.08:start_threshold=-42dB,' +
  'highpass=f=60,' +
  'afade=t=in:st=0:d=0.02';

export async function debreathClip(input: string, output: string): Promise<void> {
  await runFfmpeg({
    args: [
      '-y',
      '-i',
      input,
      '-af',
      DEBREATH_FILTER,
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      output,
    ],
  });
}
