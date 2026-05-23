import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { loadConfig, ConfigError } from '../config/loader.js';
import { logger } from '../util/logger.js';
import type { ShowrunnerConfig } from '../config/schema.js';
import { formatMissingEnvVars, inspectProviderEnv } from '../config/providerEnv.js';

interface ValidateOpts {
  config: string;
  strict?: boolean;
}

export async function validateCommand(opts: ValidateOpts): Promise<void> {
  // Load .env so api_key_env vars resolve the same way `run` would see them.
  try {
    process.loadEnvFile?.();
  } catch {
    // No .env present — fine.
  }

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

  const warnings: string[] = [];
  warnings.push(...(await checkReferencedPaths(loaded.config, loaded.configDir)));
  warnings.push(...formatMissingEnvVars(inspectProviderEnv(loaded.config)));

  if (warnings.length > 0) {
    for (const w of warnings) logger.warn(w);
    logger.info(
      `Config is structurally valid but ${warnings.length} issue(s) found.`,
    );
    if (opts.strict) {
      process.exit(1);
    }
  } else {
    logger.info('Config is valid.');
  }
}

async function checkReferencedPaths(config: ShowrunnerConfig, configDir: string): Promise<string[]> {
  const warnings: string[] = [];
  const check = async (relPath: string | undefined, label: string): Promise<void> => {
    if (!relPath) return;
    const abs = isAbsolute(relPath) ? relPath : resolve(configDir, relPath);
    try {
      await stat(abs);
    } catch {
      warnings.push(`${label} not found: ${abs}`);
    }
  };

  await check(config.project.product_model, 'project.product_model');
  for (const s of config.comprehension.sources) {
    await check(s.path, `comprehension.sources[${s.type}].path`);
  }

  if (config.recording.auth?.type === 'session') {
    await check(config.recording.auth.cookies_file, 'recording.auth.cookies_file');
    if (config.recording.auth.local_storage_file) {
      await check(config.recording.auth.local_storage_file, 'recording.auth.local_storage_file');
    }
  }
  if (config.recording.auth?.type === 'setup_script') {
    await check(config.recording.auth.path, 'recording.auth.path');
  }

  await check(config.recording.state.seed_script, 'recording.state.seed_script');
  await check(config.recording.state.reset_script, 'recording.state.reset_script');
  await check(config.recording.state.teardown_script, 'recording.state.teardown_script');

  await check(config.output.branding.title_card?.font, 'output.branding.title_card.font');
  await check(config.output.branding.title_card?.logo, 'output.branding.title_card.logo');
  await check(config.output.background_music?.path, 'output.background_music.path');

  return warnings;
}
