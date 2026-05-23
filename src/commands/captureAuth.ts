import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadConfig, ConfigError } from '../config/loader.js';
import { launchHeadedSession } from '../recording/headed.js';
import { logger } from '../util/logger.js';

export interface CaptureAuthOpts {
  config: string;
  outputCookies?: string;
  outputStorage?: string;
}

export async function captureAuthCommand(opts: CaptureAuthOpts): Promise<void> {
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
  } catch {
    // optional
  }

  const cookiesRel = opts.outputCookies ?? './auth/session.json';
  const cookiesPath = isAbsolute(cookiesRel) ? cookiesRel : resolve(loaded.configDir, cookiesRel);
  await mkdir(dirname(cookiesPath), { recursive: true });

  logger.info('Launching headed browser for auth capture', {
    target: loaded.config.recording.target_url,
    output: cookiesPath,
  });

  const session = await launchHeadedSession({
    recording: loaded.config.recording,
    configDir: loaded.configDir,
    recordVideo: false,
    withCursor: false,
    applyAuth: false,
  });

  try {
    await session.page.goto(loaded.config.recording.target_url);

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(
      '\nLog in to the target app in the browser window, then return here.\n' +
        'Press Enter to capture the session state (or Ctrl+C to abort): ',
    );
    await rl.question('');
    rl.close();

    await session.context.storageState({ path: cookiesPath });
    logger.info('Captured storage state', { path: cookiesPath });

    process.stdout.write(
      `\nDone. To use this session, set the following in your demo.yaml:\n\n` +
        `  recording:\n` +
        `    auth:\n` +
        `      type: session\n` +
        `      cookies_file: ${cookiesRel}\n\n` +
        `Then re-run \`showrunner run --config <demo.yaml>\`.\n`,
    );
  } finally {
    await session.close();
  }
}
