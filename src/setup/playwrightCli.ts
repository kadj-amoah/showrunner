import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export async function resolvePlaywrightCoreCli(): Promise<string> {
  const here = fileURLToPath(import.meta.url);
  let dir = dirname(here);
  const root = (dir.split(/[\\/]/)[0] ?? '') + '/';
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
    "Could not locate playwright-core CLI inside Showrunner's node_modules. " +
      'This is a packaging bug — please file an issue.',
  );
}
