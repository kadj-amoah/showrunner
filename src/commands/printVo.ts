import { resolve } from 'node:path';
import { loadConfig, ConfigError } from '../config/loader.js';
import { readManifest, ManifestError } from '../manifest/io.js';
import { renderVoScript } from '../manifest/voScript.js';
import { loadVoiceoverSummary, formatQaSummary } from '../voiceover/qaSummary.js';
import { logger } from '../util/logger.js';

interface PrintVoOpts {
  config: string;
}

export async function printVoCommand(opts: PrintVoOpts): Promise<void> {
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

  const manifestPath = resolve(loaded.configDir, './scripts/manifest.json');
  let manifest;
  try {
    manifest = await readManifest(manifestPath);
  } catch (err) {
    if (err instanceof ManifestError) {
      logger.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const text = renderVoScript(manifest, { projectName: loaded.config.project.name });
  process.stdout.write(text);

  // Surface the last synthesis's QA verdict so the human pick is informed.
  const summaryPath = resolve(loaded.configDir, loaded.config.voiceover.output_dir, 'voiceover_summary.json');
  const summary = await loadVoiceoverSummary(summaryPath);
  if (summary) {
    const qa = formatQaSummary(summary);
    if (qa) logger.info(`\n--- QA (from last synthesis) ---\n${qa}`);
  }
}
