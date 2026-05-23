import { resolve } from 'node:path';
import { loadConfig, ConfigError } from '../config/loader.js';
import { run } from '../pipeline/run.js';
import { logger } from '../util/logger.js';
import type { StageName } from '../pipeline/types.js';
import { runDoctorChecks } from './doctor.js';
import { formatResolution, resolvePreset } from '../util/resolutionPresets.js';

export interface RunOpts {
  config: string;
  stages?: StageName[];
  force?: StageName[];
  interactive?: boolean;
  resume?: boolean;
  dryRun?: boolean;
  estimate?: boolean;
  outputPath?: string;
  watch?: boolean;
  skipDoctor?: boolean;
  resolution?: string;
}

export async function runCommand(opts: RunOpts): Promise<void> {
  let loaded;
  try {
    loaded = await loadConfig(opts.config);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(err.message);
      process.exit(2);
    }
    throw err;
  }

  const envFile = resolve(loaded.configDir, '.env');
  try {
    process.loadEnvFile(envFile);
    logger.debug(`loaded env from ${envFile}`);
  } catch {
    // No .env in project dir — fine, env vars may come from the shell.
  }

  if (opts.outputPath) {
    loaded.config.output.output_path = opts.outputPath;
  }

  if (opts.resolution) {
    let r;
    try {
      r = resolvePreset(opts.resolution);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
    loaded.config.recording.viewport.width = r.width;
    loaded.config.recording.viewport.height = r.height;
    loaded.config.output.resolution = formatResolution(r);
    logger.info(`Resolution override: ${opts.resolution} → ${formatResolution(r)} (recording + output)`);
  }

  if (opts.estimate) {
    logger.warn('--estimate is not yet implemented; running the pipeline.');
  }

  // Implicit pre-flight via doctor. Bail on FAIL unless --skip-doctor was passed.
  if (!opts.skipDoctor) {
    const results = await runDoctorChecks(opts.config);
    const fails = results.filter((r) => r.status === 'FAIL');
    if (fails.length > 0) {
      for (const f of fails) {
        logger.error(`[doctor] ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
      }
      logger.error(
        `Doctor reported ${fails.length} FAIL row(s). Run \`showrunner doctor -c ${opts.config}\` for details, or pass --skip-doctor to bypass.`,
      );
      process.exit(1);
    }
    const warns = results.filter((r) => r.status === 'WARN');
    for (const w of warns) {
      logger.warn(`[doctor] ${w.label}${w.detail ? ` — ${w.detail}` : ''}`);
    }
  }

  try {
    const result = await run(loaded, {
      stages: opts.stages,
      force: opts.force,
      interactive: opts.interactive ?? true,
      resume: opts.resume ?? false,
      dryRun: opts.dryRun ?? false,
      overrides: { headed: opts.watch ?? false },
    });
    logger.info('Pipeline complete', {
      runId: result.runId,
      output: result.outputPath,
      buildManifest: result.buildManifestPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Pipeline failed: ${message}`);
    process.exit(1);
  }
}
