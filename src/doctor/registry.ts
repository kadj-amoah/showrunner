import { dirname, resolve } from 'node:path';
import { log } from '@clack/prompts';
import { loadConfig, ConfigError } from '../config/loader.js';
import type { CheckResult, CheckSummary, FixOutcome } from './types.js';
import { checkFfmpeg, checkFfprobe, checkPlaywrightBrowser } from './checks/system.js';
import {
  checkTargetReachable,
  diskChecks,
  memoryCheck,
  scriptChecks,
} from './checks/config.js';
import { runFitnessChecks } from './checks/fitness.js';

export interface RunChecksOpts {
  /** Path to demo.yaml. When omitted, only system-prereq checks run. */
  configPath?: string;
}

export async function runChecks(opts: RunChecksOpts): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // System pass only — no config supplied.
  if (!opts.configPath) {
    results.push(await checkFfmpeg());
    results.push(await checkFfprobe());
    results.push(await checkPlaywrightBrowser('chromium'));
    return results;
  }

  // Full pass. Load .env from the config's directory so env-var checks see what
  // `run` would see.
  const configPath = opts.configPath;
  const envFile = resolve(dirname(resolve(configPath)), '.env');
  try {
    process.loadEnvFile(envFile);
  } catch {
    // No .env in project dir — env vars may come from the shell or fail the check below.
  }

  // 1. Config syntactically valid.
  let loaded;
  try {
    loaded = await loadConfig(configPath);
    results.push({ status: 'PASS', label: `config syntactically valid: ${configPath}` });
  } catch (err) {
    const msg =
      err instanceof ConfigError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    results.push({ status: 'FAIL', label: `config invalid: ${configPath}`, detail: msg });
    return results;
  }
  const { config, configDir } = loaded;

  // 2. Provider fitness — checks env-var presence + cheapest-call API ping
  //    (Anthropic / OpenAI models.list, ElevenLabs /v1/voices including
  //    voice_id catalog match, agent_bridge claude --version probe).
  results.push(...(await runFitnessChecks(config, configDir, configPath)));

  // 3. ffmpeg + ffprobe.
  results.push(await checkFfmpeg());
  results.push(await checkFfprobe());

  // 4. Playwright browser (configured one, defaults to chromium).
  results.push(await checkPlaywrightBrowser(config.recording.browser));

  // 5. Target URL reachable.
  results.push(await checkTargetReachable(config.recording.target_url));

  // 6. Free disk per output dir.
  results.push(...(await diskChecks(config, configDir)));

  // 7. Free memory + thread cap.
  results.push(memoryCheck(config));

  // 8. Lifecycle scripts.
  results.push(...(await scriptChecks(config, configDir)));

  return results;
}

export function summarize(results: CheckResult[]): CheckSummary {
  return {
    pass: results.filter((r) => r.status === 'PASS').length,
    warn: results.filter((r) => r.status === 'WARN').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
  };
}

/**
 * Walk FAILing checks with a `fix` function, prompt the user (already done
 * inside each fix), re-run all checks, and repeat until either nothing
 * fixable remains or no further progress is made. Capped at MAX_PASSES to
 * avoid infinite loops on a check that keeps failing post-install.
 */
const MAX_PASSES = 3;

export async function runFixLoop(
  initialResults: CheckResult[],
  opts: RunChecksOpts,
): Promise<CheckResult[]> {
  let results = initialResults;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const fixable = results.filter((r) => r.status === 'FAIL' && r.fix);
    if (fixable.length === 0) break;

    let anyFixed = false;
    for (const r of fixable) {
      log.warn(`fix: ${r.label}`);
      const fixResult = await r.fix!();
      logFixOutcome(fixResult.outcome, r.label, fixResult.detail);
      if (fixResult.outcome === 'FIXED') anyFixed = true;
    }

    if (!anyFixed) break;
    results = await runChecks(opts);
  }
  return results;
}

function logFixOutcome(outcome: FixOutcome, label: string, detail?: string): void {
  const suffix = detail ? ` — ${detail}` : '';
  if (outcome === 'FIXED') {
    log.success(`fixed: ${label}`);
  } else if (outcome === 'SKIPPED') {
    log.info(`skipped: ${label}${suffix}`);
  } else if (outcome === 'FAILED') {
    log.error(`fix failed: ${label}${suffix}`);
  } else {
    log.warn(`partial: ${label}${suffix}`);
  }
}
