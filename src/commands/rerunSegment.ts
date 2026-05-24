import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import { loadConfig, ConfigError } from '../config/loader.js';
import { readManifest, ManifestError } from '../manifest/io.js';
import { buildAuthPlan, AuthError } from '../recording/auth.js';
import { executeAction } from '../recording/actions.js';
import { ensureCursorInstalled, installCursorOverlay } from '../recording/cursorOverlay.js';
import {
  runLifecycleScript,
  LifecycleScriptError,
} from '../recording/lifecycle.js';
import { generateRunId } from '../util/runId.js';
import { logger } from '../util/logger.js';
import type { Segment } from '../manifest/schema.js';

interface RerunOpts {
  config: string;
  segment: string;
}

const RERUN_BUFFER_MS = 500;
const browserMap = { chromium, firefox, webkit } as const;

export async function rerunSegmentCommand(opts: RerunOpts): Promise<void> {
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

  const { config, configDir } = loaded;
  const manifestPath = resolve(configDir, './scripts/manifest.json');
  const videoDir = resolve(configDir, config.recording.output_dir);

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

  const segment: Segment | undefined = manifest.segments.find((s) => s.id === opts.segment);
  if (!segment) {
    logger.error(
      `Segment "${opts.segment}" not found in manifest. Known: ${manifest.segments.map((s) => s.id).join(', ')}`,
    );
    process.exit(1);
  }

  const runId = generateRunId();
  const baseEnv = { SHOWRUNNER_RUN_ID: runId, SHOWRUNNER_SEGMENT_ID: segment.id };

  if (config.recording.state.reset_script) {
    try {
      await runLifecycleScript({
        scriptPath: config.recording.state.reset_script,
        configDir,
        env: baseEnv,
        label: 'reset',
      });
    } catch (err) {
      if (err instanceof LifecycleScriptError) {
        logger.error(`reset script failed: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
  }

  await mkdir(videoDir, { recursive: true });

  let authPlan;
  try {
    authPlan = await buildAuthPlan(config.recording.auth, configDir);
  } catch (err) {
    if (err instanceof AuthError) {
      logger.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const browser = await browserMap[config.recording.browser].launch({
    headless: config.recording.headless,
  });
  try {
    let storageState = authPlan.storageState;
    if (storageState === undefined && authPlan.postLaunch) {
      const authCtx = await browser.newContext({
        viewport: { width: config.recording.viewport.width, height: config.recording.viewport.height },
      });
      try {
        const authPage = await authCtx.newPage();
        await authPage.goto(config.recording.target_url);
        await authPlan.postLaunch(authPage);
        storageState = await authCtx.storageState();
      } finally {
        await authCtx.close();
      }
    }

    const ctx = await browser.newContext({
      viewport: { width: config.recording.viewport.width, height: config.recording.viewport.height },
      recordVideo: {
        dir: videoDir,
        size: { width: config.recording.viewport.width, height: config.recording.viewport.height },
      },
      storageState,
    });
    if (config.recording.cursor_highlight) {
      await installCursorOverlay(ctx);
    }
    await ctx.tracing.start({ screenshots: true, snapshots: true, sources: true });

    const page = await ctx.newPage();
    await page.goto(config.recording.target_url);
    if (config.recording.cursor_highlight) {
      await ensureCursorInstalled(page);
    }
    await page.waitForTimeout(RERUN_BUFFER_MS);

    await ctx.tracing.startChunk({ title: segment.id });
    let failure: string | undefined;
    const warnings: string[] = [];
    for (const action of segment.actions) {
      const outcome = await executeAction(page, action, {
        cursorEnabled: config.recording.cursor_highlight,
      });
      if (outcome.status === 'skipped') {
        warnings.push(`${action.type}: ${outcome.reason}`);
        logger.warn(`${action.type} skipped`, { reason: outcome.reason });
      } else if (outcome.status === 'segment_failed') {
        failure = outcome.reason;
        logger.error(`segment ${segment.id} failed`, { reason: outcome.reason });
        break;
      }
    }
    await page.waitForTimeout(config.recording.segment_buffer_ms);
    const traceDir = resolve(configDir, config.recording.trace_dir);
    await mkdir(traceDir, { recursive: true });
    await ctx.tracing.stopChunk({ path: join(traceDir, `${segment.id}.zip`) });

    const videoHandle = page.video();
    await ctx.close();

    if (!videoHandle) {
      logger.error('No video captured â€” recordVideo may have been ignored');
      process.exit(1);
    }
    const original = await videoHandle.path();
    const dest = join(videoDir, `${segment.id}.webm`);
    await rename(original, dest);

    const metadataPath = join(videoDir, `${segment.id}.rerun.json`);
    await writeFile(
      metadataPath,
      JSON.stringify(
        {
          segment_id: segment.id,
          run_id: runId,
          recorded_at: new Date().toISOString(),
          rerun_buffer_ms: RERUN_BUFFER_MS,
          status: failure ? 'failed' : 'ok',
          failure_reason: failure,
          warnings,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );

    logger.info(`Segment ${segment.id} re-recorded â†’ ${dest}`, { metadata: metadataPath });
    if (failure) {
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}
