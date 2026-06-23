import { spawn } from 'node:child_process';
import { stat, readdir } from 'node:fs/promises';
import { homedir, platform as osPlatform } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import type { CheckResult } from '../types.js';
import { fixFfmpegMissing, fixChromiumMissing } from '../remediate.js';

const browserMap = { chromium, firefox, webkit } as const;
type BrowserName = keyof typeof browserMap;

export async function checkFfmpeg(): Promise<CheckResult> {
  const r = await probeBinary('ffmpeg', ['-version']);
  if (r.ok) {
    return { status: 'PASS', label: 'ffmpeg present', detail: r.firstLine };
  }
  return {
    status: 'FAIL',
    label: r.label,
    detail: installHint('ffmpeg'),
    fix: fixFfmpegMissing,
  };
}

export async function checkFfprobe(): Promise<CheckResult> {
  const r = await probeBinary('ffprobe', ['-version']);
  if (r.ok) {
    return { status: 'PASS', label: 'ffprobe present', detail: r.firstLine };
  }
  return {
    status: 'FAIL',
    label: r.label,
    detail: installHint('ffprobe'),
    // ffprobe ships in the ffmpeg package on every supported pm
    fix: fixFfmpegMissing,
  };
}

export async function checkPlaywrightBrowser(browserName: BrowserName): Promise<CheckResult> {
  try {
    const exec = browserMap[browserName].executablePath();
    await stat(exec);
    return {
      status: 'PASS',
      label: `playwright ${browserName} binary present`,
      detail: exec,
    };
  } catch (err) {
    const sudoHit = await probeRootCache(browserName);
    const fallback = `run \`showrunner install-browser --browser ${browserName}\``;
    if (sudoHit) {
      return {
        status: 'FAIL',
        label: `playwright ${browserName} binary missing for current user, but found in root/admin cache`,
        detail: `${sudoHit} — re-run install WITHOUT sudo so the browser lands in your user cache: ${fallback}`,
        fix: () => fixChromiumMissing(browserName),
      };
    }
    return {
      status: 'FAIL',
      label: `playwright ${browserName} binary missing`,
      detail: `${fallback} (${err instanceof Error ? err.message : String(err)})`,
      fix: () => fixChromiumMissing(browserName),
    };
  }
}

interface BinaryProbe {
  ok: boolean;
  firstLine?: string;
  label: string;
}

function probeBinary(name: string, args: string[]): Promise<BinaryProbe> {
  return new Promise((resolve) => {
    const child = spawn(name, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => {
      resolve({ ok: false, label: `${name} not on PATH` });
    });
    child.on('exit', (code) => {
      if (code === 0) {
        const firstLine = stdout.split('\n')[0]?.trim() ?? '';
        resolve({ ok: true, label: `${name} present`, firstLine });
      } else {
        resolve({ ok: false, label: `${name} exited with code ${code}` });
      }
    });
  });
}

function installHint(binary: 'ffmpeg' | 'ffprobe'): string {
  // ffprobe ships alongside ffmpeg in every supported distro's ffmpeg package,
  // so the hint copy is identical for both.
  void binary;
  const p = osPlatform();
  if (p === 'darwin') return 'install via `brew install ffmpeg`';
  if (p === 'win32') {
    return 'install via `winget install Gyan.FFmpeg` or `choco install ffmpeg`';
  }
  return 'install via `apt install ffmpeg` (Debian/Ubuntu), `pacman -S ffmpeg` (Arch), or `dnf install ffmpeg` (Fedora)';
}

async function probeRootCache(browserName: string): Promise<string | null> {
  const candidates: string[] = [];
  const home = homedir();
  const p = osPlatform();

  if (p === 'linux') {
    candidates.push('/root/.cache/ms-playwright');
  } else if (p === 'darwin') {
    candidates.push('/var/root/Library/Caches/ms-playwright');
  } else if (p === 'win32') {
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
    candidates.push(
      join(
        systemRoot,
        'System32',
        'config',
        'systemprofile',
        'AppData',
        'Local',
        'ms-playwright',
      ),
    );
  }

  if (candidates.length === 0) return null;
  if (home === '/root' || home === '/var/root') return null;

  for (const dir of candidates) {
    try {
      const entries = await readdir(dir);
      const match = entries.find((e) =>
        e.toLowerCase().startsWith(browserName.toLowerCase()),
      );
      if (match) return `found at ${join(dir, match)}`;
    } catch {
      // dir doesn't exist or unreadable — try next
    }
  }
  return null;
}
