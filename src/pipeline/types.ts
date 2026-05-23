import type { ShowrunnerConfig } from '../config/schema.js';

export const STAGE_NAMES = ['comprehension', 'script', 'voiceover', 'record', 'mux'] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export interface PipelineOverrides {
  /** Force headed recording regardless of `recording.headless` in config. */
  headed?: boolean;
}

export interface PipelineContext {
  config: ShowrunnerConfig;
  configPath: string;
  configDir: string;
  runId: string;
  interactive: boolean;
  forced: Set<StageName>;
  overrides: PipelineOverrides;
}

export interface StageResult {
  stage: StageName;
  skipped: boolean;
  reason?: string;
  durationMs: number;
  artifacts?: Record<string, string>;
  warnings?: string[];
  meta?: Record<string, unknown>;
  halt?: boolean;
}

export interface PipelineOptions {
  stages?: StageName[];
  force?: StageName[];
  interactive?: boolean;
  resume?: boolean;
  dryRun?: boolean;
  json?: boolean;
  overrides?: PipelineOverrides;
}

export interface PipelineResult {
  runId: string;
  outputPath: string;
  stages: StageResult[];
  buildManifestPath: string;
}

export interface Stage {
  name: StageName;
  run(ctx: PipelineContext): Promise<StageResult>;
}
