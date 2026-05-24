import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';

export interface DetectedEnvironment {
  claudeCli: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  chromium: boolean;
  envVars: {
    anthropic: boolean;
    openai: boolean;
    elevenlabs: boolean;
  };
}

export async function detectEnvironment(): Promise<DetectedEnvironment> {
  const [claudeCli, ffmpeg, ffprobe, chromium] = await Promise.all([
    isOnPath('claude'),
    isOnPath('ffmpeg'),
    isOnPath('ffprobe'),
    chromiumInstalled(),
  ]);

  return {
    claudeCli,
    ffmpeg,
    ffprobe,
    chromium,
    envVars: {
      anthropic: Boolean(process.env['ANTHROPIC_API_KEY']),
      openai: Boolean(process.env['OPENAI_API_KEY']),
      elevenlabs: Boolean(process.env['ELEVENLABS_API_KEY']),
    },
  };
}

async function isOnPath(binary: string): Promise<boolean> {
  // We resolve via spawning the binary with --version (or similar) rather than
  // shelling out to `which`, so this works on Windows without bash.
  return new Promise((resolve) => {
    const useShell = process.platform === 'win32'; // .cmd/.ps1 shims
    const child = spawn(binary, ['--version'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      shell: useShell,
    });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.on('error', () => finish(false));
    child.on('exit', (code) => finish(code === 0));
    // Hard cap so a hung binary doesn't block setup.
    setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
        finish(false);
      }
    }, 4000);
  });
}

async function chromiumInstalled(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright-core');
    const exec = chromium.executablePath();
    await stat(exec);
    return true;
  } catch {
    return false;
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
