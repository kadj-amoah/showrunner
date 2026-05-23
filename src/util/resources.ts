import { cpus, freemem, totalmem } from 'node:os';
import { statfs } from 'node:fs/promises';
import { logger } from './logger.js';

export class ResourceError extends Error {
  override readonly name = 'ResourceError';
  constructor(
    message: string,
    readonly kind: 'disk' | 'memory',
  ) {
    super(message);
  }
}

const MB = 1024 * 1024;
const GB = 1024 * MB;
const SAFETY_FLOOR_BYTES = 500 * MB;

export function getFreeMemoryBytes(): number {
  return freemem();
}

export function getTotalMemoryBytes(): number {
  return totalmem();
}

/**
 * Free disk space at `path` in bytes. Returns Infinity on filesystems that
 * don't support statfs (network mounts, some Windows configurations).
 */
export async function getFreeDiskBytes(path: string): Promise<number> {
  try {
    const stats = await statfs(path);
    return stats.bavail * stats.bsize;
  } catch {
    return Infinity;
  }
}

export interface ThreadCapOptions {
  width: number;
  height: number;
  fps: number;
  quality: 'draft' | 'standard' | 'high';
  freeMemBytes: number;
}

/**
 * libx264 working set ≈ frame buffer (W*H*1.5 bytes for YUV420) × per-thread
 * coefficient × lookahead frames. Quality preset drives lookahead.
 *   draft     → veryfast → ~10 lookahead frames
 *   standard  → medium   → ~25 lookahead frames
 *   high      → slow     → ~50 lookahead frames
 * Cap at the CPU count. Operator escape hatch: SHOWRUNNER_FFMPEG_THREADS env.
 */
export function computeThreadCap(opts: ThreadCapOptions): number {
  const override = process.env['SHOWRUNNER_FFMPEG_THREADS'];
  if (override) {
    const n = parseInt(override, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const cpuCount = Math.max(1, cpus().length);
  const lookaheadByQuality: Record<ThreadCapOptions['quality'], number> = {
    draft: 10,
    standard: 25,
    high: 50,
  };
  const lookahead = lookaheadByQuality[opts.quality];
  const frameBytes = Math.ceil(opts.width * opts.height * 1.5);
  // Per-thread overhead: roughly one frame buffer × lookahead, plus some slack
  const perThreadBytes = frameBytes * lookahead * 1.2;
  const headroom = Math.max(0, opts.freeMemBytes - SAFETY_FLOOR_BYTES);
  if (headroom < perThreadBytes) return 1;
  const capByMemory = Math.floor(headroom / perThreadBytes);
  return Math.max(1, Math.min(cpuCount, capByMemory));
}

export interface MasterWebmEstimateOptions {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}

/**
 * Conservative size estimate for the master.webm Playwright will record.
 * VP8 in Playwright defaults to ~1 Mbps at 720p and scales with resolution +
 * fps. Used to fail-fast before recording if disk space is too tight.
 */
export function estimateMasterWebmBytes(opts: MasterWebmEstimateOptions): number {
  const pixelRate = opts.width * opts.height * opts.fps;
  // Bytes per pixel-frame ≈ 0.1 bits → ~0.0125 bytes
  const bytesPerSec = pixelRate * 0.0125;
  return Math.ceil(bytesPerSec * opts.durationSec);
}

export async function assertEnoughDisk(
  targetDir: string,
  minBytes: number,
  label: string,
): Promise<void> {
  const free = await getFreeDiskBytes(targetDir);
  if (free < minBytes) {
    throw new ResourceError(
      `${label}: insufficient free disk at ${targetDir} — need ~${formatBytes(minBytes)}, found ~${formatBytes(free)}. Free up space or move the project off this filesystem.`,
      'disk',
    );
  }
  logger.debug(`disk check ok: ${label}`, {
    path: targetDir,
    free_mb: Math.round(free / MB),
    required_mb: Math.round(minBytes / MB),
  });
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  if (n >= MB) return `${Math.round(n / MB)} MB`;
  return `${Math.round(n / 1024)} KB`;
}
