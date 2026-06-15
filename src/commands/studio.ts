import * as net from 'node:net';
import { join } from 'node:path';
import { logger } from '../util/logger.js';
import { createStudioServer } from '../studio/server.js';

export interface StudioOpts {
  port?: string;
}

/**
 * Find the first free TCP port at or above `startPort` by attempting to bind
 * a temporary server on each candidate. No dependency on portScan (which
 * probes existing HTTP servers, not free bind slots).
 */
function findFreePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : startPort;
      server.close(() => resolve(port));
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Recurse to the next candidate.
        findFreePort(startPort + 1).then(resolve, reject);
      } else {
        reject(err);
      }
    });
  });
}

/**
 * `showrunner studio` — start the Studio web testbench.
 *
 * Path assumptions: both runsRoot and staticDir are resolved relative to
 * process.cwd(), which is expected to be the repo root during development.
 * A later task may introduce package-relative resolution once the Studio SPA
 * is distributed alongside the package.
 */
export async function studioCommand(opts: StudioOpts): Promise<void> {
  // NOTE: cwd-relative paths assume the command is run from the repo root.
  const runsRoot = join(process.cwd(), 'studio', '.runs');
  const staticDir = join(process.cwd(), 'studio-web', 'dist');

  const preferredPort = Number(opts.port) || 4321;
  const chosenPort = await findFreePort(preferredPort);

  if (chosenPort !== preferredPort) {
    logger.warn(`Port ${preferredPort} in use — using ${chosenPort} instead`);
  }

  createStudioServer({ runsRoot, staticDir }).listen(chosenPort, () => {
    logger.info('Showrunner Studio → http://localhost:' + chosenPort);
  });
}
