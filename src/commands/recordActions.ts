import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { loadConfig, ConfigError } from '../config/loader.js';
import { launchHeadedSession } from '../recording/headed.js';
import {
  attachNavigationCapture,
  coalesceEvents,
  installCaptureBinding,
  type RecordedEvent,
} from '../recording/captureEvents.js';
import { readManifest, writeManifest, ManifestError } from '../manifest/io.js';
import type { Action, Manifest } from '../manifest/schema.js';
import { logger } from '../util/logger.js';

export interface RecordActionsOpts {
  config: string;
  segment?: string;
  output?: string;
}

export async function recordActionsCommand(opts: RecordActionsOpts): Promise<void> {
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

  const manifestPath = opts.output
    ? resolve(loaded.configDir, opts.output)
    : resolve(loaded.configDir, './scripts/manifest.json');

  logger.info('Launching headed browser for action capture', {
    target: loaded.config.recording.target_url,
  });

  const events: RecordedEvent[] = [];
  const interleavedNavigations: Action[] = [];
  const sessionEnd = new AbortController();

  const session = await launchHeadedSession({
    recording: loaded.config.recording,
    configDir: loaded.configDir,
    recordVideo: false,
    withCursor: false,
    applyAuth: true,
  });

  try {
    await installCaptureBinding(session.context, (evt) => events.push(evt));
    attachNavigationCapture(session.page, (action) => interleavedNavigations.push(action));

    await session.page.goto(loaded.config.recording.target_url);

    process.stdout.write(
      '\nDrive the demo in the browser window. Click, type, navigate.\n' +
        'When you\'re done, return here and press Enter to write the manifest (or Ctrl+C to abort).\n',
    );

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const closed = new Promise<void>((resolveClose) => {
      sessionEnd.signal.addEventListener('abort', () => resolveClose());
    });
    const userPrompt = rl.question('Press Enter to save: ');
    await Promise.race([userPrompt, closed]);
    rl.close();
  } finally {
    await session.close();
  }

  const coalesced = coalesceEvents(events);
  const actions = mergeWithNavigations(coalesced, interleavedNavigations);
  logger.info('Coalesced action stream', {
    raw_events: events.length,
    navigations: interleavedNavigations.length,
    actions: actions.length,
  });

  if (actions.length === 0) {
    logger.warn('No actions captured — manifest not modified.');
    return;
  }

  const updatedManifest = await mergeIntoManifest({
    manifestPath,
    segmentId: opts.segment,
    actions,
    projectName: loaded.config.project.name,
  });

  await writeManifest(manifestPath, updatedManifest);
  logger.info('Wrote manifest', { path: manifestPath, segments: updatedManifest.segments.length });
}

/**
 * Insert navigation events into the action stream by timestamp. Navigations
 * arrive on their own channel from Playwright; the click/input events come from
 * the in-page binding. Cheap interleave: append navigations to the end. (For
 * v1 this is fine — the typical pattern is "fill form → submit → navigate".)
 */
function mergeWithNavigations(coalesced: Action[], navigations: Action[]): Action[] {
  return [...coalesced, ...navigations];
}

interface MergeOptions {
  manifestPath: string;
  segmentId?: string;
  actions: Action[];
  projectName: string;
}

async function mergeIntoManifest(opts: MergeOptions): Promise<Manifest> {
  const exists = await fileExists(opts.manifestPath);
  if (!exists) {
    // Build a one-segment skeleton.
    const segmentId = opts.segmentId ?? 'recorded';
    const duration = Math.max(8, opts.actions.length * 2);
    return {
      total_duration_seconds: duration,
      generated_from: 'record-actions',
      segments: [
        {
          id: segmentId,
          label: 'Recorded',
          start: 0,
          end: duration,
          vo_line: `Recorded walkthrough of ${opts.projectName}.`,
          actions: opts.actions,
          transition: 'cut',
        },
      ],
    };
  }

  let existing;
  try {
    existing = await readManifest(opts.manifestPath);
  } catch (err) {
    if (err instanceof ManifestError) {
      throw new Error(`record-actions: existing manifest invalid — ${err.message}`);
    }
    throw err;
  }

  if (!opts.segmentId) {
    // Append a new "recorded" segment at the end.
    const lastEnd = existing.segments[existing.segments.length - 1]!.end;
    const newStart = lastEnd;
    const newEnd = newStart + Math.max(8, opts.actions.length * 2);
    existing.segments.push({
      id: `recorded-${existing.segments.length}`,
      label: 'Recorded',
      start: newStart,
      end: newEnd,
      vo_line: 'Recorded walkthrough.',
      actions: opts.actions,
      transition: 'cut',
    });
    existing.total_duration_seconds = newEnd;
    return existing;
  }

  const target = existing.segments.find((s) => s.id === opts.segmentId);
  if (!target) {
    throw new Error(
      `record-actions: segment "${opts.segmentId}" not found in ${opts.manifestPath}. ` +
        `Available: ${existing.segments.map((s) => s.id).join(', ')}`,
    );
  }
  target.actions = opts.actions;
  return existing;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
