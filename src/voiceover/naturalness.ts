import { spawn } from 'node:child_process';

export interface NaturalnessVerdict {
  /** True when the sidecar produced a score. */
  available: boolean;
  score: number | null;
  floor: number | null;
  /** score < floor — advisory in v1 (never halts; calibrate the floor first). */
  belowFloor: boolean;
}

/** Parse the `{ "score": <float> }` JSON the UTMOSv2 sidecar prints on stdout. */
export function parseUtmosScore(stdout: string): number {
  const parsed = JSON.parse(stdout) as { score?: unknown };
  if (typeof parsed.score !== 'number' || Number.isNaN(parsed.score)) {
    throw new Error(`utmos sidecar returned no numeric score: ${stdout.slice(0, 200)}`);
  }
  return parsed.score;
}

export function naturalnessVerdict(
  score: number | null,
  floor: number | null | undefined,
): NaturalnessVerdict {
  const f = floor ?? null;
  if (score === null) {
    return { available: false, score: null, floor: f, belowFloor: false };
  }
  return { available: true, score, floor: f, belowFloor: f !== null && score < f };
}

export interface ScoreNaturalnessOptions {
  /** Python interpreter. Defaults to 'python'. */
  python?: string;
  /** Path to scripts/utmos_score.py. */
  scriptPath: string;
}

/**
 * Score an audio file via the UTMOSv2 Python sidecar. Returns null on any
 * failure (missing interpreter, model not downloaded, bad output) — naturalness
 * is advisory in v1 and must never crash the pipeline.
 */
export async function scoreNaturalness(
  audioPath: string,
  opts: ScoreNaturalnessOptions,
): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(opts.python ?? 'python', [opts.scriptPath, audioPath], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        resolve(parseUtmosScore(out.trim()));
      } catch {
        resolve(null);
      }
    });
  });
}
