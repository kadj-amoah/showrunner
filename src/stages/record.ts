import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Stage, StageResult, PipelineContext } from '../pipeline/types.js';
import { logger } from '../util/logger.js';
import { readManifest, ManifestError } from '../manifest/io.js';
import {
  runLifecycleScript,
  LifecycleScriptError,
} from '../recording/lifecycle.js';
import { recordDemo, type SlicePlan } from '../recording/record.js';
import { AuthError } from '../recording/auth.js';
import {
  assertEnoughDisk,
  estimateMasterWebmBytes,
  formatBytes,
  getFreeDiskBytes,
} from '../util/resources.js';

export const recordStage: Stage = {
  name: 'record',
  async run(ctx: PipelineContext): Promise<StageResult> {
    const start = Date.now();
    const warnings: string[] = [];

    const manifestPath = resolve(ctx.configDir, './scripts/manifest.json');
    const videoDir = resolve(ctx.configDir, ctx.config.recording.output_dir);
    const masterPath = resolve(videoDir, 'master.webm');
    const slicePlanPath = resolve(videoDir, 'slice_plan.json');

    const masterExists = await fileExists(masterPath);
    const forced = ctx.forced.has('record');

    if (masterExists && !forced) {
      logger.event({
        stage: 'record',
        status: 'reusing',
        reason: 'master.webm present',
        path: masterPath,
      });
      return {
        stage: 'record',
        skipped: true,
        reason: 'master.webm already present',
        durationMs: Date.now() - start,
        artifacts: { master_video: masterPath, slice_plan: slicePlanPath },
      };
    }

    if (!(await fileExists(manifestPath))) {
      return {
        stage: 'record',
        skipped: true,
        reason: `manifest.json not found at ${manifestPath} — run the script stage first`,
        durationMs: Date.now() - start,
      };
    }

    let manifest;
    try {
      manifest = await readManifest(manifestPath);
    } catch (err) {
      if (err instanceof ManifestError) {
        throw new Error(`record stage: ${err.message}`);
      }
      throw err;
    }

    const baseEnv = { SHOWRUNNER_RUN_ID: ctx.runId };

    if (ctx.config.recording.state.seed_script) {
      try {
        await runLifecycleScript({
          scriptPath: ctx.config.recording.state.seed_script,
          configDir: ctx.configDir,
          env: baseEnv,
          label: 'seed',
        });
      } catch (err) {
        if (err instanceof LifecycleScriptError) {
          throw new Error(`record stage: seed script failed — ${err.message}`);
        }
        throw err;
      }
    }

    // Preflight: estimate the master.webm size against free disk on the video dir.
    const estimatedWebm = estimateMasterWebmBytes({
      durationSec: manifest.total_duration_seconds,
      width: ctx.config.recording.viewport.width,
      height: ctx.config.recording.viewport.height,
      fps: 25, // Playwright records at 25fps regardless of output.fps
    });
    const headroom = Math.ceil(estimatedWebm * 1.5);
    const freeBytes = await getFreeDiskBytes(videoDir);
    logger.event({
      stage: 'record',
      status: 'preflight',
      free_disk: formatBytes(freeBytes),
      estimated_webm: formatBytes(estimatedWebm),
      required: formatBytes(headroom),
    });
    await assertEnoughDisk(videoDir, headroom, 'record video dir');

    let slicePlan: SlicePlan;
    let recordError: unknown;
    try {
      slicePlan = await recordDemo({
        recording: ctx.config.recording,
        voiceover: ctx.config.voiceover,
        manifest,
        configDir: ctx.configDir,
        overrides: ctx.overrides,
      });
    } catch (err) {
      recordError = err;
      slicePlan = {
        recording_path: '',
        recording_started_at: new Date().toISOString(),
        segments: [],
      };
    } finally {
      if (ctx.config.recording.state.teardown_script) {
        try {
          await runLifecycleScript({
            scriptPath: ctx.config.recording.state.teardown_script,
            configDir: ctx.configDir,
            env: {
              ...baseEnv,
              SHOWRUNNER_STATUS: recordError ? 'failure' : 'success',
            },
            label: 'teardown',
          });
        } catch (err) {
          if (err instanceof LifecycleScriptError) {
            warnings.push(`teardown script failed: ${err.message}`);
            logger.warn(`teardown script failed`, { error: err.message });
          } else {
            throw err;
          }
        }
      }
    }

    if (recordError) {
      const cause = recordError instanceof Error ? recordError.message : String(recordError);
      if (recordError instanceof AuthError) {
        throw new Error(
          `record stage: auth failed — ${cause}. If a captured session expired, re-run \`showrunner capture-auth\`.`,
        );
      }
      throw new Error(`record stage: ${cause}`);
    }

    await mkdir(dirname(slicePlanPath), { recursive: true });
    await writeFile(slicePlanPath, JSON.stringify(slicePlan, null, 2) + '\n', 'utf8');

    const failedSegments = slicePlan.segments.filter((s) => s.status === 'failed');
    for (const s of failedSegments) {
      const tail =
        s.failure_screenshots.length > 0
          ? ` (screenshot: ${s.failure_screenshots.join(', ')})`
          : '';
      warnings.push(`segment ${s.id} failed: ${s.failure_reason ?? 'unknown'}${tail}`);
    }

    const allScreenshots = slicePlan.segments.flatMap((s) => s.failure_screenshots);

    return {
      stage: 'record',
      skipped: false,
      durationMs: Date.now() - start,
      artifacts: {
        master_video: slicePlan.recording_path,
        slice_plan: slicePlanPath,
      },
      warnings,
      meta: {
        segments: slicePlan.segments.length,
        failed_segments: failedSegments.length,
        failure_screenshots: allScreenshots,
      },
    };
  },
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
