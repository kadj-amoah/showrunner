import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from '../util/logger.js';

interface InstallBrowserOpts {
  browser?: string;
}

const DEFAULT_BROWSER = 'chromium';

export async function installBrowserCommand(opts: InstallBrowserOpts): Promise<void> {
  const browser = opts.browser ?? DEFAULT_BROWSER;
  const cli = await resolvePlaywrightCoreCli();

  logger.info(`installing Playwright ${browser} (via bundled playwright-core, no project required)`);
  // playwright-core's cli.js skips the "install your project's dependencies first" warning
  // that plain `npx playwright install` shows when invoked outside a project.
  const child = spawn(process.execPath, [cli, 'install', browser], {
    stdio: 'inherit',
    env: process.env,
  });
  const code: number = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (c) => resolve(c ?? 0));
  });
  if (code !== 0) {
    logger.error(`playwright install exited with code ${code}`);
    process.exit(code);
  }
  logger.info(`${browser} installed. Try \`showrunner doctor -c demo.yaml\` next.`);
}

async function resolvePlaywrightCoreCli(): Promise<string> {
  // Walk up from this module to the showrunner package root, then locate
  // playwright-core inside its node_modules. This works both when showrunner
  // is installed globally and when invoked via tsx during development.
  const here = fileURLToPath(import.meta.url);
  let dir = dirname(here);
  const root = dir.split(/[\\/]/)[0] + '/';
  while (dir && dir !== root) {
    const candidate = join(dir, 'node_modules', 'playwright-core', 'cli.js');
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next ancestor
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate playwright-core CLI inside Showrunner\'s node_modules. ' +
      'This is a packaging bug — please file an issue.',
  );
}
