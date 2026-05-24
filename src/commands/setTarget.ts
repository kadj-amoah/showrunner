import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadConfig, ConfigError } from '../config/loader.js';
import { probeUrl } from '../setup/targetProbe.js';
import { logger } from '../util/logger.js';

interface SetTargetOpts {
  config: string;
  url: string;
  force?: boolean;
}

export async function setTargetCommand(opts: SetTargetOpts): Promise<void> {
  // Validate URL syntax before touching disk.
  try {
    new URL(opts.url);
  } catch {
    logger.error(`Invalid URL: ${opts.url}`);
    process.exit(2);
  }

  // Load the config (also validates the YAML is well-formed).
  try {
    await loadConfig(opts.config);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(err.message);
      process.exit(2);
    }
    throw err;
  }

  // Probe unless --force.
  if (!opts.force) {
    logger.info(`probing ${opts.url} ...`);
    const probe = await probeUrl(opts.url);
    if (!probe.reachable) {
      logger.error(
        `target ${opts.url} not reachable${
          probe.reason ? ` (${probe.reason})` : ''
        }. Start your dev server first, or pass --force to set the URL anyway.`,
      );
      process.exit(1);
    }
    logger.info(`reachable (HTTP ${probe.statusCode}, ${probe.elapsedMs}ms).`);
  }

  // Rewrite recording.target_url in place. We read the file fresh and modify
  // the parsed YAML rather than re-serialising loadConfig's normalised form,
  // so the user's comments and ordering survive (mostly — js-yaml drops
  // comments either way; this is best-effort).
  const absPath = isAbsolute(opts.config) ? opts.config : resolve(process.cwd(), opts.config);
  const rawText = await readFile(absPath, 'utf8');
  const doc = yaml.load(rawText) as Record<string, unknown>;

  if (!doc || typeof doc !== 'object' || !doc['recording'] || typeof doc['recording'] !== 'object') {
    logger.error(
      `config has no \`recording\` block — has it been edited by hand into an invalid shape?`,
    );
    process.exit(2);
  }
  (doc['recording'] as Record<string, unknown>)['target_url'] = opts.url;

  const newText = yaml.dump(doc, {
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  });
  await writeFile(absPath, newText, 'utf8');

  logger.info(`updated recording.target_url → ${opts.url}`);
  logger.info(`(comments in demo.yaml may have been stripped — re-add them if needed.)`);
}
