import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runFfmpeg } from '../voiceover/ffmpeg.js';

export interface ConcatOptions {
  segmentPaths: string[];
  workDir: string;
  outputPath: string;
}

export async function concatSegments(opts: ConcatOptions): Promise<void> {
  const listPath = join(opts.workDir, 'concat_list.txt');
  const body = opts.segmentPaths
    .map((p) => `file '${escapeForConcat(p)}'`)
    .join('\n') + '\n';
  await writeFile(listPath, body, 'utf8');

  await runFfmpeg({
    args: [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      opts.outputPath,
    ],
  });
}

function escapeForConcat(path: string): string {
  return path.replace(/\\/g, '/').replace(/'/g, "'\\''");
}
