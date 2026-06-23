import { spawn } from 'node:child_process';
import { logger } from '../util/logger.js';
import { resolvePlaywrightCoreCli } from '../setup/playwrightCli.js';

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
