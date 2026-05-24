import { spawn } from 'node:child_process';
import { stat, access, constants, readdir } from 'node:fs/promises';
import { isAbsolute, resolve, dirname, join } from 'node:path';
import { homedir, platform as osPlatform } from 'node:os';
import { request as undiciRequest } from 'undici';
import { chromium, firefox, webkit } from 'playwright-core';
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
    // No .env in project dir â€” env vars may come from the shell or fail the check below.
  }

  const results = await runDoctorChecks(opts.config);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ results, summary: summarize(results) }, null, 2) + '\n');
  } else {
    for (const r of results) printRow(r);
    const summary = summarize(results);
    if (summary.fail > 0) {
      printFixOrder(results);
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
    if (row.set) {
      results.push({
        status: 'PASS',
        label: `${row.slot} provider=${row.provider}${suffix}, ${row.envVar} set`,
      });
    } else {
      results.push({
        status: 'FAIL',
        label: `${row.slot} provider=${row.provider}${suffix}, ${row.envVar} NOT set`,
        detail: providerEnvHint(row.slot, row.provider, row.envVar),
      });
    }
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

function printFixOrder(results: CheckResult[]): void {
  const fails = results.filter((r) => r.status === 'FAIL');
  if (fails.length === 0) return;
  process.stdout.write('\n');
  logger.info('To fix:');
  fails.forEach((r, i) => {
    const hint = r.detail ? ` — ${r.detail}` : '';
    logger.info(`  ${i + 1}. ${r.label}${hint}`);
  });
  process.stdout.write('\n');
}

function printRow(r: CheckResult): void {
  const tag = `[${r.status}]`;
  const line = `${tag} ${r.label}${r.detail ? ` â€” ${r.detail}` : ''}`;
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
      resolve({
        status: 'FAIL',
        label: `${name} not on PATH`,
        detail: installHintFor(name),
      });
    });
    child.on('exit', (code) => {
      if (code === 0) {
        const firstLine = stdout.split('\n')[0]?.trim() ?? '';
        resolve({ status: 'PASS', label: `${name} present`, detail: firstLine });
      } else {
        resolve({
          status: 'FAIL',
          label: `${name} exited with code ${code}`,
          detail: installHintFor(name),
        });
      }
    });
  });
}

function providerEnvHint(slot: 'llm' | 'tts', provider: string, envVar: string): string {
  const dashboards: Record<string, string> = {
    anthropic: 'https://console.anthropic.com/settings/keys',
    openai: 'https://platform.openai.com/api-keys',
    elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
  };
  const dash = dashboards[provider];
  const dashHint = dash ? ` (get a key from ${dash})` : '';
  const altHint =
    slot === 'llm'
      ? ` — or switch llm.default.provider to "agent_bridge" in demo.yaml to use a local CLI agent (no API key needed)`
      : '';
  return `add ${envVar}=... to your project's .env file${dashHint}${altHint}`;
}

function installHintFor(binary: string): string {
  const p = osPlatform();
  if (binary !== 'ffmpeg' && binary !== 'ffprobe') return '';
  // ffprobe ships alongside ffmpeg in every distro's ffmpeg package, so the hint is the same.
  if (p === 'darwin') return 'install via `brew install ffmpeg`';
  if (p === 'win32') return 'install via `winget install Gyan.FFmpeg` or `choco install ffmpeg`';
  // linux — show the three common package managers
  return 'install via `apt install ffmpeg` (Debian/Ubuntu), `pacman -S ffmpeg` (Arch), or `dnf install ffmpeg` (Fedora)';
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
    // Probe the sudo/root cache to give a better hint when the user ran
    // `sudo npx playwright install` and the browser landed in /root/.cache
    // (or %SystemRoot%\System32\config\systemprofile\AppData\Local on Windows).
    const sudoHit = await probeRootCache(browserName);
    const fallback = `run \`npx playwright install ${browserName}\``;
    if (sudoHit) {
      return {
        status: 'FAIL',
        label: `playwright ${browserName} binary missing for current user, but found in root/admin cache`,
        detail:
          `${sudoHit} — re-run install WITHOUT sudo so the browser lands in your user cache: ${fallback}`,
      };
    }
    return {
      status: 'FAIL',
      label: `playwright ${browserName} binary missing`,
      detail: `${fallback} (${err instanceof Error ? err.message : String(err)})`,
    };
  }
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
    candidates.push(join(systemRoot, 'System32', 'config', 'systemprofile', 'AppData', 'Local', 'ms-playwright'));
  }

  // Don't flag if the current user is root — the executablePath() above would have hit.
  if (candidates.length === 0) return null;
  if (home === '/root' || home === '/var/root') return null;

  for (const dir of candidates) {
    try {
      const entries = await readdir(dir);
      const match = entries.find((e) => e.toLowerCase().startsWith(browserName.toLowerCase()));
      if (match) {
        return `found at ${join(dir, match)}`;
      }
    } catch {
      // dir doesn't exist or unreadable — fine, try next
    }
  }
  return null;
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
    const reason = err instanceof Error ? err.message.trim() : String(err).trim();
    const prefix = reason ? `${reason} — ` : '';
    return {
      status: 'FAIL',
      label: `target ${url} not reachable`,
      detail: `${prefix}start your dev server on this URL, or change \`recording.target_url\` in demo.yaml`,
    };
  }
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
