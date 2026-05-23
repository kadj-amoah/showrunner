import { spawn } from 'node:child_process';
import { stat, access, constants } from 'node:fs/promises';
import { isAbsolute, resolve, dirname } from 'node:path';
import { request as undiciRequest } from 'undici';
import { chromium, firefox, webkit } from 'playwright';
import type { ShowrunnerConfig } from '../config/schema.js';
import { loadConfig, ConfigError } from '../config/loader.js';
import { inspectProviderEnv } from '../config/providerEnv.js';
import { logger } from '../util/logger.js';
import {
  computeThreadCap,
  formatBytes,
  getFreeDiskBytes,
  getFreeMemoryBytes,
  getTotalMemoryBytes,
} from '../util/resources.js';

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL';

export interface CheckResult {
  status: CheckStatus;
  label: string;
  detail?: string;
}

interface DoctorOpts {
  config: string;
  json?: boolean;
}

const browserMap = { chromium, firefox, webkit } as const;

export async function doctorCommand(opts: DoctorOpts): Promise<void> {
  // Load .env from the config's directory so env-var checks see what `run` would see.
  const envFile = resolve(dirname(resolve(opts.config)), '.env');
  try {
    process.loadEnvFile(envFile);
  } catch {
    // No .env in project dir — env vars may come from the shell or fail the check below.
  }

  const results = await runDoctorChecks(opts.config);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ results, summary: summarize(results) }, null, 2) + '\n');
  } else {
    for (const r of results) printRow(r);
    const summary = summarize(results);
    if (summary.fail > 0) {
      logger.error(`doctor: ${summary.fail} FAIL, ${summary.warn} WARN, ${summary.pass} PASS`);
    } else if (summary.warn > 0) {
      logger.warn(`doctor: ${summary.warn} WARN, ${summary.pass} PASS`);
    } else {
      logger.info(`doctor: ${summary.pass}/${results.length} checks passed. ready to run.`);
    }
  }

  if (results.some((r) => r.status === 'FAIL')) {
    process.exit(1);
  }
}

/**
 * Reusable from `run` for the implicit pre-flight (with `--skip-doctor` escape).
 * Returns the full results array; caller decides whether to bail on FAIL.
 */
export async function runDoctorChecks(configPath: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Config loads cleanly.
  let loaded;
  try {
    loaded = await loadConfig(configPath);
    results.push({ status: 'PASS', label: `config syntactically valid: ${configPath}` });
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : err instanceof Error ? err.message : String(err);
    results.push({ status: 'FAIL', label: `config invalid: ${configPath}`, detail: msg });
    return results;
  }
  const { config, configDir } = loaded;

  // 2. Provider env vars.
  for (const row of inspectProviderEnv(config)) {
    const suffix = row.stage ? ` (${row.stage} override)` : '';
    results.push({
      status: row.set ? 'PASS' : 'FAIL',
      label: `${row.slot} provider=${row.provider}${suffix}, ${row.envVar} ${row.set ? 'set' : 'NOT set'}`,
    });
  }

  // 3. ffmpeg + ffprobe.
  results.push(await checkBinary('ffmpeg', ['-version']));
  results.push(await checkBinary('ffprobe', ['-version']));

  // 4. Playwright chromium present.
  results.push(await checkPlaywrightBrowser(config));

  // 5. Target URL reachable.
  results.push(await checkTargetReachable(config.recording.target_url));

  // 6. Free disk on the dirs we write into.
  const dirsToCheck: Array<{ relPath: string; label: string }> = [
    { relPath: config.recording.output_dir, label: 'recording.output_dir' },
    { relPath: config.voiceover.output_dir, label: 'voiceover.output_dir' },
    { relPath: dirname(config.output.output_path), label: 'output.output_path parent' },
  ];
  for (const d of dirsToCheck) {
    const abs = isAbsolute(d.relPath) ? d.relPath : resolve(configDir, d.relPath);
    const parent = await firstExistingAncestor(abs);
    const free = await getFreeDiskBytes(parent);
    const enough = free > 1024 * 1024 * 1024; // 1 GB rule of thumb
    results.push({
      status: enough ? 'PASS' : 'WARN',
      label: `free disk ${d.label} (${parent}): ${formatBytes(free)}`,
    });
  }

  // 7. Free memory + thread cap.
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
  results.push({
    status: freeMem > 1024 * 1024 * 1024 ? 'PASS' : 'WARN',
    label: `free memory: ${formatBytes(freeMem)} of ${formatBytes(totalMem)} (ffmpeg thread cap: ${threads})`,
  });

  // 8. Lifecycle scripts exist + (on POSIX) are executable.
  for (const [label, p] of [
    ['recording.state.seed_script', config.recording.state.seed_script],
    ['recording.state.reset_script', config.recording.state.reset_script],
    ['recording.state.teardown_script', config.recording.state.teardown_script],
  ] as const) {
    if (!p) continue;
    const abs = isAbsolute(p) ? p : resolve(configDir, p);
    results.push(await checkScript(label, abs));
  }

  return results;
}

function summarize(results: CheckResult[]): { pass: number; warn: number; fail: number } {
  return {
    pass: results.filter((r) => r.status === 'PASS').length,
    warn: results.filter((r) => r.status === 'WARN').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
  };
}

function printRow(r: CheckResult): void {
  const tag = `[${r.status}]`;
  const line = `${tag} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`;
  if (r.status === 'FAIL') logger.error(line);
  else if (r.status === 'WARN') logger.warn(line);
  else logger.info(line);
}

async function checkBinary(name: string, args: string[]): Promise<CheckResult> {
  return new Promise((resolve) => {
    const child = spawn(name, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => {
      resolve({ status: 'FAIL', label: `${name} not on PATH` });
    });
    child.on('exit', (code) => {
      if (code === 0) {
        const firstLine = stdout.split('\n')[0]?.trim() ?? '';
        resolve({ status: 'PASS', label: `${name} present`, detail: firstLine });
      } else {
        resolve({ status: 'FAIL', label: `${name} exited with code ${code}` });
      }
    });
  });
}

async function checkPlaywrightBrowser(config: ShowrunnerConfig): Promise<CheckResult> {
  const browserName = config.recording.browser;
  try {
    const exec = browserMap[browserName].executablePath();
    await stat(exec);
    return {
      status: 'PASS',
      label: `playwright ${browserName} binary present`,
      detail: exec,
    };
  } catch (err) {
    return {
      status: 'FAIL',
      label: `playwright ${browserName} binary missing`,
      detail: `run \`npx playwright install ${browserName}\` (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

async function checkTargetReachable(url: string): Promise<CheckResult> {
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
    return {
      status: 'FAIL',
      label: `target ${url} not reachable`,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkScript(label: string, abs: string): Promise<CheckResult> {
  try {
    await stat(abs);
  } catch {
    return { status: 'FAIL', label: `${label} not found`, detail: abs };
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
