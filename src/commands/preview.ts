import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, ConfigError } from '../config/loader.js';
import { runCommand, LifecycleScriptError } from '../recording/lifecycle.js';
import { logger } from '../util/logger.js';

export interface PreviewOpts {
  config: string;
}

export async function previewCommand(opts: PreviewOpts): Promise<void> {
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

  const previewSpec = resolve(loaded.configDir, './scripts/playwright_demo.spec.ts');
  if (!(await fileExists(previewSpec))) {
    logger.error(
      `No preview spec at ${previewSpec}. Run \`showrunner run --stages script\` first to generate it.`,
    );
    process.exit(1);
  }

  logger.info('Opening Playwright UI Mode for preview', { spec: previewSpec });

  try {
    await runCommand({
      cmd: 'npx',
      args: ['playwright', 'test', '--ui', previewSpec],
      cwd: loaded.configDir,
      label: 'preview',
      inherit: true,
    });
  } catch (err) {
    if (err instanceof LifecycleScriptError) {
      logger.debug(`preview UI exited`, { code: err.exitCode });
    } else {
      throw err;
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
