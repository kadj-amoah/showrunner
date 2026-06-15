import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { showrunnerConfigSchema } from '../config/schema.js';
import type { PipelineContext } from '../pipeline/types.js';
import type { TTSProvider } from '../providers/tts/types.js';
import { voiceoverStage } from '../stages/voiceover.js';
import { manifestFromScript } from './manifestFromScript.js';

export interface AdHocInput {
  script: string;
  voiceId: string;
  model: string;
  normalize?: boolean;
  gatePolicy?: 'warn' | 'fail';
  naturalness?: boolean;
}
export interface AdHocOptions {
  runsRoot: string;
  provider?: TTSProvider;
}
export interface AdHocResult {
  summary: any;
  audioPath: string;
  workdir: string;
}

export async function runAdHocSynthesis(input: AdHocInput, opts: AdHocOptions): Promise<AdHocResult> {
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
  const workdir = join(opts.runsRoot, hash);
  await mkdir(join(workdir, 'scripts'), { recursive: true });
  await writeFile(
    join(workdir, 'scripts', 'manifest.json'),
    JSON.stringify(manifestFromScript(input.script), null, 2),
    'utf8',
  );

  const config = showrunnerConfigSchema.parse({
    project: { name: 'studio-adhoc' },
    recording: { target_url: 'https://example.com' },
    voiceover: {
      provider: { name: 'elevenlabs', voice_id: input.voiceId, model: input.model },
      normalization: { enabled: input.normalize ?? true },
      gate: { policy: input.gatePolicy ?? 'warn' },
      naturalness: { enabled: input.naturalness ?? false },
    },
  });

  const ctx = {
    config,
    configPath: join(workdir, 'demo.yaml'),
    configDir: workdir,
    runId: 'studio',
    interactive: false,
    forced: new Set(),
    overrides: {},
    ...(opts.provider ? { providers: { tts: opts.provider } } : {}),
  } as unknown as PipelineContext;

  await voiceoverStage.run(ctx);

  const audioDir = resolve(workdir, config.voiceover.output_dir);
  const summary = JSON.parse(await readFile(join(audioDir, 'voiceover_summary.json'), 'utf8'));
  return { summary, audioPath: join(audioDir, '_master.raw.mp3'), workdir };
}
