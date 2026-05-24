import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { LoadedConfig } from '../config/loader.js';
import { logger } from '../util/logger.js';
import { generateRunId } from '../util/runId.js';
import { comprehensionStage } from '../stages/comprehension.js';
import { scriptStage } from '../stages/script.js';
import { recordStage } from '../stages/record.js';
import { voiceoverStage } from '../stages/voiceover.js';
import { muxStage } from '../stages/mux.js';
import {
  STAGE_NAMES,
  type PipelineContext,
  type PipelineOptions,
  type PipelineResult,
  type Stage,
  type StageName,
  type StageResult,
} from './types.js';

export class PipelineStageError extends Error {
  override readonly name = 'PipelineStageError';
  constructor(
    readonly stage: StageName,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

const STAGES_BY_NAME: Record<StageName, Stage> = {
  comprehension: comprehensionStage,
  script: scriptStage,
  record: recordStage,
  voiceover: voiceoverStage,
  mux: muxStage,
};

export async function run(
  loaded: LoadedConfig,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const runId = generateRunId();
  const interactive = options.interactive ?? true;
  const forced = new Set<StageName>(options.force ?? []);
  const enabled = resolveEnabledStages(options.stages);

  const ctx: PipelineContext = {
    config: loaded.config,
    configPath: loaded.configPath,
    configDir: loaded.configDir,
    runId,
    interactive,
    forced,
    overrides: options.overrides ?? {},
  };

  logger.event({ stage: 'pipeline', status: 'start', runId, stages: [...enabled] });

  const results: StageResult[] = [];
  for (const name of STAGE_NAMES) {
    if (!enabled.has(name)) {
      logger.event({ stage: name, status: 'disabled' });
      continue;
    }
    if (options.dryRun && (name === 'record' || name === 'voiceover' || name === 'mux')) {
      logger.event({ stage: name, status: 'dry-run' });
      results.push({
        stage: name,
        skipped: true,
        reason: 'dry-run',
        durationMs: 0,
      });
      continue;
    }
    const stage = STAGES_BY_NAME[name];
    let result: StageResult;
    try {
      result = await stage.run(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.event({ stage: name, status: 'failed', error: message });
      throw new PipelineStageError(name, message, err);
    }
    results.push(result);
    logger.event({
      stage: name,
      status: result.skipped ? 'skipped' : 'complete',
      durationMs: result.durationMs,
      reason: result.reason,
    });
    if (result.halt) {
      logger.event({
        stage: 'pipeline',
        status: 'halted',
        runId,
        by: name,
        reason: result.reason,
      });
      break;
    }
  }

  const outputPath = resolve(ctx.configDir, ctx.config.output.output_path);
  const buildManifestPath = resolve(dirname(outputPath), 'build_manifest.json');
  await writeBuildManifest(buildManifestPath, {
    runId,
    outputPath,
    results,
    config: loaded,
  });

  logger.event({ stage: 'pipeline', status: 'done', runId, buildManifest: buildManifestPath });

  return {
    runId,
    outputPath,
    stages: results,
    buildManifestPath,
  };
}

function resolveEnabledStages(filter: StageName[] | undefined): Set<StageName> {
  if (!filter || filter.length === 0) return new Set(STAGE_NAMES);
  return new Set(filter);
}

interface BuildManifestPayload {
  runId: string;
  outputPath: string;
  results: StageResult[];
  config: LoadedConfig;
}

async function writeBuildManifest(path: string, payload: BuildManifestPayload): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const stages: Record<string, unknown> = {};
  for (const r of payload.results) {
    stages[r.stage] = {
      skipped: r.skipped,
      reason: r.reason,
      duration_ms: r.durationMs,
      warnings: r.warnings,
    };
  }
  const manifest = {
    run_id: payload.runId,
    generated_at: new Date().toISOString(),
    output_file: payload.outputPath,
    inputs: {
      config: payload.config.configPath,
    },
    stages,
    warnings: payload.results.flatMap((r) => r.warnings ?? []),
  };
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}
