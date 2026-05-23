import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { applyBackgroundMusic } from './branding.js';
import { ffprobeDuration } from '../voiceover/ffmpeg.js';

const FIVE_SECONDS = 5;

async function ffmpegAvailable(): Promise<boolean> {
  return await new Promise((resolveProbe) => {
    const c = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    c.on('error', () => resolveProbe(false));
    c.on('exit', (code) => resolveProbe(code === 0));
  });
}

async function makeColorVideoWithVoice(out: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=320x240:r=24:d=${FIVE_SECONDS}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${FIVE_SECONDS}:sample_rate=44100`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-shortest',
    out,
  ]);
}

async function makeSineMp3(out: string, freqHz: number): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${freqHz}:duration=${FIVE_SECONDS}:sample_rate=44100`,
    '-q:a',
    '4',
    out,
  ]);
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const c = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    c.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    c.on('error', rejectRun);
    c.on('exit', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

describe('applyBackgroundMusic', () => {
  let workDir: string;
  let hasFfmpeg = false;

  beforeAll(async () => {
    hasFfmpeg = await ffmpegAvailable();
    if (!hasFfmpeg) return;
    workDir = await mkdtemp(join(tmpdir(), 'showrunner-bg-music-'));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it('mixes a background-music track over the original audio without changing duration', async () => {
    if (!hasFfmpeg) {
      console.warn('ffmpeg not available — skipping background music test');
      return;
    }

    const inputVideo = join(workDir, 'in.mp4');
    const music = join(workDir, 'bg.mp3');
    const out = join(workDir, 'mixed.mp4');

    await makeColorVideoWithVoice(inputVideo);
    await makeSineMp3(music, 220);

    await applyBackgroundMusic({
      inputPath: inputVideo,
      outputPath: out,
      musicPath: music,
      volumeDb: -22,
    });

    const duration = await ffprobeDuration(out);
    expect(duration).toBeGreaterThan(FIVE_SECONDS - 0.5);
    expect(duration).toBeLessThan(FIVE_SECONDS + 0.5);
  }, 60_000);
});
