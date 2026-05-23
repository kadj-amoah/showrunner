import { spawn } from 'node:child_process';

export type FfmpegErrorCategory =
  | 'oom'
  | 'no_space'
  | 'codec_missing'
  | 'permission'
  | 'unknown';

export class FfmpegError extends Error {
  override readonly name = 'FfmpegError';
  readonly category: FfmpegErrorCategory;
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    category?: FfmpegErrorCategory,
  ) {
    super(message);
    this.category = category ?? classifyFfmpegStderr(stderr);
  }
}

/**
 * Pure classifier — pattern-match common failure modes in ffmpeg/x264 stderr
 * so callers can attach actionable remediation hints.
 */
export function classifyFfmpegStderr(stderr: string): FfmpegErrorCategory {
  if (/malloc|out of memory|cannot allocate/i.test(stderr)) return 'oom';
  if (/no space left|ENOSPC|disk full/i.test(stderr)) return 'no_space';
  if (/unknown encoder|encoder not found|libx264 not found/i.test(stderr)) return 'codec_missing';
  if (/EACCES|permission denied/i.test(stderr)) return 'permission';
  return 'unknown';
}

/**
 * Build an actionable hint to append to an ffmpeg failure message based on its
 * category. Caller injects width/height/workDir context where relevant.
 */
export function ffmpegHintFor(
  category: FfmpegErrorCategory,
  ctx?: { width?: number; height?: number; workDir?: string },
): string {
  switch (category) {
    case 'oom': {
      const cur = ctx?.width && ctx?.height ? ` (currently ${ctx.width}x${ctx.height})` : '';
      return `x264 ran out of working memory${cur}. Try lowering output.resolution to 1280x720, or set SHOWRUNNER_FFMPEG_THREADS=1 to use a single encoder thread.`;
    }
    case 'no_space':
      return `Disk full${ctx?.workDir ? ` at ${ctx.workDir}` : ''}. Free up space and re-run.`;
    case 'codec_missing':
      return `Your ffmpeg build is missing libx264. Reinstall ffmpeg with --enable-libx264 (or via your package manager's "ffmpeg-full" variant).`;
    case 'permission':
      return `Permission denied. Check write access on the output directory.`;
    case 'unknown':
      return '';
  }
}

export interface RunOptions {
  bin?: string;
  args: string[];
  captureStderr?: boolean;
  /** Inject `-threads N` before the output path. Useful for memory-constrained encodes. */
  threads?: number;
  /** Context for error hint rendering (resolution, work dir). */
  hintContext?: { width?: number; height?: number; workDir?: string };
}

export async function runFfmpeg(opts: RunOptions): Promise<{ stderr: string }> {
  const bin = opts.bin ?? 'ffmpeg';
  const args =
    opts.threads !== undefined
      ? injectThreadsArg(opts.args, opts.threads)
      : opts.args;
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      rejectRun(new FfmpegError(`Failed to spawn ${bin}: ${err.message}`, null, stderr));
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolveRun({ stderr });
      } else {
        const category = classifyFfmpegStderr(stderr);
        const hint = ffmpegHintFor(category, opts.hintContext);
        const hintLine = hint ? `\n→ ${hint}` : '';
        rejectRun(
          new FfmpegError(
            `${bin} exited ${code}${hintLine}\n${stderr.slice(-2000)}`,
            code,
            stderr,
            category,
          ),
        );
      }
    });
  });
}

/**
 * Insert `-threads N` immediately before the output path (last arg). Idempotent
 * if the input already contained `-threads`.
 */
function injectThreadsArg(args: string[], threads: number): string[] {
  if (args.includes('-threads')) return args;
  // Output path is conventionally the last positional arg in ffmpeg invocations.
  return [...args.slice(0, -1), '-threads', String(threads), args[args.length - 1]!];
}

/**
 * Get the duration of an audio buffer by piping it through ffprobe via stdin.
 * Avoids the tmpfile dance for short clips returned directly from a TTS API.
 */
export async function ffprobeDurationFromStdin(buf: Buffer): Promise<number> {
  const bin = 'ffprobe';
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      bin,
      ['-i', 'pipe:0', '-show_entries', 'format=duration', '-v', 'quiet', '-of', 'csv=p=0'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      rejectRun(new FfmpegError(`Failed to spawn ${bin}: ${err.message}`, null, stderr));
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        rejectRun(new FfmpegError(`${bin} exited ${code}: ${stderr.slice(-500)}`, code, stderr));
        return;
      }
      const trimmed = stdout.trim();
      const n = Number.parseFloat(trimmed);
      if (Number.isNaN(n)) {
        rejectRun(new FfmpegError(`${bin} returned unparseable duration: ${trimmed}`, code, stderr));
      } else {
        resolveRun(n);
      }
    });
    child.stdin.write(buf);
    child.stdin.end();
  });
}

export async function ffprobeDuration(path: string): Promise<number> {
  const bin = 'ffprobe';
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      bin,
      ['-i', path, '-show_entries', 'format=duration', '-v', 'quiet', '-of', 'csv=p=0'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      rejectRun(new FfmpegError(`Failed to spawn ${bin}: ${err.message}`, null, stderr));
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        rejectRun(new FfmpegError(`${bin} exited ${code}: ${stderr.slice(-500)}`, code, stderr));
        return;
      }
      const trimmed = stdout.trim();
      const n = Number.parseFloat(trimmed);
      if (Number.isNaN(n)) {
        rejectRun(new FfmpegError(`${bin} returned unparseable duration: ${trimmed}`, code, stderr));
      } else {
        resolveRun(n);
      }
    });
  });
}
