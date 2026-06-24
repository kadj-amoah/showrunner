import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { validateConfig } from '../config/loader.js';
import { loadAlignment, wordMarkers, type WordMarker } from '../manifest/alignment.js';
import { manifestSchema } from '../manifest/schema.js';
import { run, PipelineStageError } from '../pipeline/run.js';
import { STAGE_NAMES } from '../pipeline/types.js';
import { ffprobeDuration } from '../voiceover/ffmpeg.js';
import { logger } from '../util/logger.js';

/**
 * The MAIViS-Orchestrator-facing capture spec. The Orchestrator's plan authors this
 * (target + voice + the capture manifest); `produce` translates it to a ShowrunnerConfig,
 * runs the capture->VO->mux pipeline non-interactively, and emits ONE `realized` JSON.
 */
const produceSpecSchema = z.object({
  project_name: z.string().min(1),
  target_url: z.string().url(),
  voice_id: z.string().min(1),
  model: z.string().optional(),
  api_key_env: z.string().default('ELEVENLABS_API_KEY'),
  resolution: z
    .string()
    .regex(/^\d+x\d+$/, 'resolution must be WIDTHxHEIGHT')
    .default('1920x1080'),
  output_name: z.string().default('demo_final.mp4'),
  manifest: manifestSchema, // the capture script: segments with vo_line + Playwright actions
  stages: z.array(z.enum(STAGE_NAMES)).default(['voiceover', 'record', 'mux']),
  env_file: z.string().optional(),
});
export type ProduceSpec = z.infer<typeof produceSpecSchema>;

interface Realized {
  media: { url: string; available_range: { start: number; duration: number }; intrinsic_duration: number };
  markers: WordMarker[];
  status: 'ok' | 'degraded' | 'failed';
  reason?: string;
  hash: string;
  aspects: string[];
}

export interface ProduceDeps {
  runPipeline?: typeof run;
  probe?: typeof ffprobeDuration;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function failedRealized(reason: string, hash: string): Realized {
  return {
    media: { url: '', available_range: { start: 0, duration: 0 }, intrinsic_duration: 0 },
    markers: [],
    status: 'failed',
    reason,
    hash,
    aspects: [],
  };
}

async function emit(outDir: string, realized: Realized): Promise<void> {
  // Source of truth = a file the Orchestrator reads; stdout is a convenience.
  try {
    await writeFile(join(outDir, 'realized.json'), JSON.stringify(realized, null, 2));
  } catch (err) {
    logger.warn(`produce: could not write realized.json: ${errMsg(err)}`);
  }
  process.stdout.write(`${JSON.stringify(realized)}\n`);
}

/**
 * `showrunner produce <spec.json> --out <dir>` — run the pipeline from a single spec,
 * emit one consolidated `realized` JSON. Never throws / never bare-exits: every failure
 * path is folded into `status: "failed"` so the Orchestrator always gets a verdict.
 */
export async function produceCommand(
  specPath: string,
  opts: { out: string },
  deps: ProduceDeps = {},
): Promise<void> {
  const runPipeline = deps.runPipeline ?? run;
  const probe = deps.probe ?? ffprobeDuration;
  const outDir = isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out);

  // hash the spec bytes first so even a failure carries run identity
  let specRaw: string;
  try {
    const p = isAbsolute(specPath) ? specPath : resolve(process.cwd(), specPath);
    specRaw = await readFile(p, 'utf8');
  } catch (err) {
    await emit(outDir, failedRealized(`cannot read spec: ${errMsg(err)}`, ''));
    return;
  }
  const hash = createHash('sha256').update(specRaw).digest('hex').slice(0, 16);

  let spec: ProduceSpec;
  try {
    spec = produceSpecSchema.parse(JSON.parse(specRaw));
  } catch (err) {
    await emit(outDir, failedRealized(`invalid produce spec: ${errMsg(err)}`, hash));
    return;
  }

  // scaffold the work dir + write the pre-authored capture manifest
  try {
    await mkdir(join(outDir, 'scripts'), { recursive: true });
    await writeFile(join(outDir, 'scripts', 'manifest.json'), JSON.stringify(spec.manifest, null, 2));
  } catch (err) {
    await emit(outDir, failedRealized(`scaffold failed: ${errMsg(err)}`, hash));
    return;
  }

  // provider keys: load the spec's env file and any work-dir .env (best effort)
  if (spec.env_file) {
    try {
      process.loadEnvFile(resolve(spec.env_file));
    } catch {
      /* optional */
    }
  }
  try {
    process.loadEnvFile(join(outDir, '.env'));
  } catch {
    /* optional */
  }

  // translate spec -> ShowrunnerConfig; configDir becomes the work dir
  let loaded;
  try {
    const provider: Record<string, unknown> = {
      name: 'elevenlabs',
      voice_id: spec.voice_id,
      api_key_env: spec.api_key_env,
    };
    if (spec.model) provider.model = spec.model;
    loaded = validateConfig(
      {
        project: { name: spec.project_name },
        recording: { target_url: spec.target_url, headless: true },
        voiceover: { provider },
        output: { resolution: spec.resolution, output_path: `./output/${spec.output_name}` },
      },
      join(outDir, 'demo.yaml'),
    );
  } catch (err) {
    await emit(outDir, failedRealized(`config invalid: ${errMsg(err)}`, hash));
    return;
  }

  // run the pipeline non-interactively
  let result;
  try {
    result = await runPipeline(loaded, {
      interactive: false,
      stages: spec.stages,
      overrides: { headed: false },
    });
  } catch (err) {
    const reason =
      err instanceof PipelineStageError
        ? `${err.stage}: ${err.message}`
        : `pipeline error: ${errMsg(err)}`;
    await emit(outDir, failedRealized(reason, hash));
    return;
  }

  // final mp4: the mux StageResult's truthful path survives the locked-file rename
  const mux = result.stages.find((s) => s.stage === 'mux');
  const finalMp4 = (mux?.artifacts?.output as string | undefined) ?? result.outputPath;

  // intrinsic duration: prefer the mux stage's measured value, else ffprobe
  let duration = typeof mux?.meta?.duration_seconds === 'number' ? (mux.meta.duration_seconds as number) : NaN;
  if (!Number.isFinite(duration)) {
    try {
      duration = await probe(finalMp4);
    } catch {
      duration = NaN;
    }
  }
  if (!Number.isFinite(duration)) {
    await emit(outDir, failedRealized(`could not determine output duration for ${finalMp4}`, hash));
    return;
  }

  // word markers from the master alignment (whole-film timebase)
  const alignment = await loadAlignment(join(outDir, 'segments', 'alignment', '_master.alignment.json'));
  const markers = alignment ? wordMarkers(alignment) : [];

  // any stage warning ⇒ degraded (re-drivable by the Orchestrator)
  const warnings = result.stages.flatMap((s) => s.warnings ?? []);
  const status: Realized['status'] = warnings.length > 0 ? 'degraded' : 'ok';
  const realized: Realized = {
    media: {
      url: finalMp4,
      available_range: { start: 0, duration: round3(duration) },
      intrinsic_duration: round3(duration),
    },
    markers,
    status,
    ...(status === 'degraded' ? { reason: `stage warnings: ${warnings.slice(0, 5).join('; ')}` } : {}),
    hash,
    aspects: [spec.resolution],
  };
  await emit(outDir, realized);
}
