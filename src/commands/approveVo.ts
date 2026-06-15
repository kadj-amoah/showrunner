import { rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, ConfigError } from '../config/loader.js';
import { readManifest, writeManifest, ManifestError } from '../manifest/io.js';
import { readAndMergeVoScript, VoScriptMergeError } from '../manifest/voScript.js';
import { logger } from '../util/logger.js';
import { loadVoiceoverSummary, formatQaSummary } from '../voiceover/qaSummary.js';

interface ApproveVoOpts {
  config: string;
}

export async function approveVoCommand(opts: ApproveVoOpts): Promise<void> {
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
  const voScriptPath = resolve(loaded.configDir, './scripts/vo_script.txt');
  const lockPath = resolve(loaded.configDir, '.showrunner-lock');

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

  if (!(await pathExists(voScriptPath))) {
    logger.error(`VO script not found: ${voScriptPath}. Run \`showrunner run\` first.`);
    process.exit(1);
  }

  let merged;
  try {
    merged = await readAndMergeVoScript(voScriptPath, manifest);
  } catch (err) {
    if (err instanceof VoScriptMergeError) {
      logger.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  await writeManifest(manifestPath, merged);
  if (await pathExists(lockPath)) {
    await rm(lockPath);
  }

  logger.info('VO edits merged into manifest. Resume with `showrunner run --config <path>`.');

  // If a prior synthesis left a QA verdict, surface it to inform the next pass.
  const summaryPath = resolve(loaded.configDir, loaded.config.voiceover.output_dir, 'voiceover_summary.json');
  const summary = await loadVoiceoverSummary(summaryPath);
  if (summary) {
    const qa = formatQaSummary(summary);
    if (qa) logger.info(`Last synthesis QA:\n${qa}`);
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
