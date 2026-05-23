import { logger } from '../util/logger.js';

export function notImplemented(name: string): () => Promise<never> {
  return async () => {
    logger.error(`Command "${name}" is not yet implemented.`);
    process.exit(1);
  };
}
