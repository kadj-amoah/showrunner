import { stat, access, constants } from 'node:fs/promises';
import { isAbsolute, resolve, dirname } from 'node:path';
import { request as undiciRequest } from 'undici';
import type { ShowrunnerConfig } from '../../config/schema.js';
import {
  computeThreadCap,
  formatBytes,
  getFreeDiskBytes,
  getFreeMemoryBytes,
  getTotalMemoryBytes,
} from '../../util/resources.js';
import type { CheckResult } from '../types.js';

export async function checkTargetReachable(url: string): Promise<CheckResult> {
  try {
    const start = Date.now();
    const res = await undiciRequest(url, {
      method: 'HEAD',
      bodyTimeout: 5000,
      headersTimeout: 5000,
    });
    const elapsed = Date.now() - start;
    if (res.statusCode >= 200 && res.statusCode < 500) {
      return {
        status: 'PASS',
        label: `target ${url} reachable (HTTP ${res.statusCode}, ${elapsed}ms)`,
      };
    }
    return {
      status: 'WARN',
      label: `target ${url} returned HTTP ${res.statusCode}`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message.trim() : String(err).trim();
    const prefix = reason ? `${reason} — ` : '';
    return {
      status: 'FAIL',
      label: `target ${url} not reachable`,
      detail: `${prefix}start your dev server on this URL, or change \`recording.target_url\` in demo.yaml`,
    };
  }
}

export async function diskChecks(
  config: ShowrunnerConfig,
  configDir: string,
): Promise<CheckResult[]> {
  const dirsToCheck: Array<{ relPath: string; label: string }> = [
    { relPath: config.recording.output_dir, label: 'recording.output_dir' },
    { relPath: config.voiceover.output_dir, label: 'voiceover.output_dir' },
    { relPath: dirname(config.output.output_path), label: 'output.output_path parent' },
  ];
  const out: CheckResult[] = [];
  for (const d of dirsToCheck) {
    const abs = isAbsolute(d.relPath) ? d.relPath : resolve(configDir, d.relPath);
    const parent = await firstExistingAncestor(abs);
    const free = await getFreeDiskBytes(parent);
    const enough = free > 1024 * 1024 * 1024; // 1 GB rule of thumb
    out.push({
      status: enough ? 'PASS' : 'WARN',
      label: `free disk ${d.label} (${parent}): ${formatBytes(free)}`,
    });
  }
  return out;
}

export function memoryCheck(config: ShowrunnerConfig): CheckResult {
  const freeMem = getFreeMemoryBytes();
  const totalMem = getTotalMemoryBytes();
  const [widthStr, heightStr] = config.output.resolution.split('x');
  const width = Number.parseInt(widthStr ?? '1920', 10);
  const height = Number.parseInt(heightStr ?? '1080', 10);
  const threads = computeThreadCap({
    width,
    height,
    fps: config.output.fps,
    quality: config.output.quality,
    freeMemBytes: freeMem,
  });
  return {
    status: freeMem > 1024 * 1024 * 1024 ? 'PASS' : 'WARN',
    label: `free memory: ${formatBytes(freeMem)} of ${formatBytes(totalMem)} (ffmpeg thread cap: ${threads})`,
  };
}

export async function scriptChecks(
  config: ShowrunnerConfig,
  configDir: string,
): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const entries: Array<[string, string | undefined]> = [
    ['recording.state.seed_script', config.recording.state.seed_script],
    ['recording.state.reset_script', config.recording.state.reset_script],
    ['recording.state.teardown_script', config.recording.state.teardown_script],
  ];
  for (const [label, p] of entries) {
    if (!p) continue;
    const abs = isAbsolute(p) ? p : resolve(configDir, p);
    out.push(await checkScript(label, abs));
  }
  return out;
}

async function checkScript(label: string, abs: string): Promise<CheckResult> {
  try {
    await stat(abs);
  } catch {
    return {
      status: 'FAIL',
      label: `${label} not found`,
      detail: `expected at ${abs} — re-scaffold (\`showrunner init\` writes these) or remove the entry from demo.yaml's recording.state block`,
    };
  }
  if (process.platform !== 'win32') {
    try {
      await access(abs, constants.X_OK);
    } catch {
      return {
        status: 'WARN',
        label: `${label} found but not executable`,
        detail: `chmod +x ${abs}`,
      };
    }
  }
  return { status: 'PASS', label: `${label} ok`, detail: abs };
}

async function firstExistingAncestor(p: string): Promise<string> {
  let current = p;
  while (true) {
    try {
      await stat(current);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}
