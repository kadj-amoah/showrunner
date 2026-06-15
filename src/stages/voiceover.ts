import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Stage, StageResult, PipelineContext } from '../pipeline/types.js';
import { logger } from '../util/logger.js';
import { readManifest, writeManifest, ManifestError } from '../manifest/io.js';
import type { Manifest, Segment } from '../manifest/schema.js';
import { ffprobeDuration } from '../voiceover/ffmpeg.js';
import {
  buildFullScript,
  computeSliceBoundaries,
  loadMasterAlignment,
  locateSegmentWindows,
  masterPaths,
  sliceAlignment,
  sliceMasterAudio,
  writeMasterAlignment,
  type SegmentWindow,
  type SliceBoundary,
} from '../voiceover/fullVo.js';
import { normalizeSegments, type NormalizationDiff } from '../voiceover/normalize.js';
import {
  resolveAlignmentStrategy,
  resolveElevenLabsConfigOrNull,
  resolveTTSProvider,
  type AlignmentStrategy,
} from '../providers/tts/resolveFromContext.js';
import { TTSProviderError, type TTSProvider } from '../providers/tts/types.js';
import type { VoiceoverConfig } from '../config/schema.js';

interface SegmentArtifact {
  segment_id: string;
  final_path: string;
  natural_duration_seconds: number;
  final_duration_seconds: number;
  target_duration_seconds: number;
  characters_synthesized: number;
  used_speed: number;
  drift_action: 'kept' | 'auto_extended' | 'reused';
  pause_strategy: 'master_slice';
  warnings: string[];
}

export const voiceoverStage: Stage = {
  name: 'voiceover',
  async run(ctx: PipelineContext): Promise<StageResult> {
    const start = Date.now();
    const stageWarnings: string[] = [];

    const manifestPath = resolve(ctx.configDir, './scripts/manifest.json');
    const audioDir = resolve(ctx.configDir, ctx.config.voiceover.output_dir);
    const alignmentDir = resolve(ctx.configDir, ctx.config.voiceover.alignment_dir);
    await mkdir(audioDir, { recursive: true });
    await mkdir(alignmentDir, { recursive: true });

    if (!(await fileExists(manifestPath))) {
      return {
        stage: 'voiceover',
        skipped: true,
        reason: `manifest.json not found at ${manifestPath} — run the script stage first`,
        durationMs: Date.now() - start,
      };
    }

    let manifest: Manifest;
    try {
      manifest = await readManifest(manifestPath);
    } catch (err) {
      if (err instanceof ManifestError) {
        throw new Error(`voiceover stage: ${err.message}`);
      }
      throw err;
    }

    const vo = ctx.config.voiceover;
    const elevenSpec = resolveElevenLabsConfigOrNull(ctx);
    const voSpeed = elevenSpec?.speed ?? 1.0;
    const forced = ctx.forced.has('voiceover');
    const tailPaddingSec = vo.tail_padding_ms / 1000;
    const master = masterPaths(audioDir, alignmentDir);
    const alignmentStrategy = resolveAlignmentStrategy(ctx);
    const provider = resolveTTSProvider(ctx);

    // Transient normalization: produce the spoken text used for synthesis AND
    // alignment-window matching, while the manifest's vo_line stays
    // human-readable. Diffs are logged to the voiceover summary.
    const { segments: voSegments, diffs: normalizationDiffs } = normalizeSegments(
      manifest.segments,
      ctx.config.voiceover.normalization.enabled,
    );
    if (normalizationDiffs.length > 0) {
      logger.event({
        stage: 'voiceover',
        status: 'normalized',
        substitutions: normalizationDiffs.length,
      });
    }

    // Provider doesn't return alignment AND user requires it → fail fast.
    if (!provider.supportsAlignment && alignmentStrategy === 'required') {
      throw new Error(
        `voiceover stage: provider '${provider.name}' does not return alignment data, ` +
          `but voiceover.alignment_strategy is 'required'. Either switch providers (elevenlabs) ` +
          `or set alignment_strategy: best_effort in demo.yaml.`,
      );
    }

    // Non-aligned providers take the per-segment fallback path — one TTS call
    // per segment, concatenated. Skips master-alignment work entirely.
    if (!provider.supportsAlignment) {
      return await runBestEffortPath({
        ctx,
        manifest,
        provider,
        audioDir,
        alignmentDir,
        tailPaddingSec,
        forced,
        start,
        manifestPath,
        voSpeed,
        voSegments,
        normalizationDiffs,
      });
    }

    // 1. Synthesize the master VO (one TTS call), or reuse cache.
    const masterCached =
      (await fileExists(master.rawAudio)) && (await fileExists(master.alignment));
    if (forced || !masterCached) {
      logger.event({
        stage: 'voiceover',
        status: 'synthesizing_master',
        provider: provider.name,
        segments: manifest.segments.length,
      });
      try {
        const fullText = buildFullScript(voSegments);
        const result = await provider.synthesize({ text: fullText });
        if (!result.alignment) {
          // provider.supportsAlignment said true but didn't return any — surface as error.
          throw new TTSProviderError(
            `provider ${provider.name} advertised supportsAlignment but returned no alignment data`,
            provider.name,
          );
        }
        await writeFile(master.rawAudio, result.audio);
        await writeMasterAlignment(master.alignment, result.alignment);
        logger.event({
          stage: 'voiceover',
          status: 'master_written',
          path: master.rawAudio,
          duration: result.durationSeconds.toFixed(2),
          chars: result.charactersSynthesized,
        });
      } catch (err) {
        if (err instanceof TTSProviderError) {
          throw new Error(`voiceover stage: master synthesis failed — ${err.message}`);
        }
        throw err;
      }
    } else {
      logger.event({
        stage: 'voiceover',
        status: 'reusing_master',
        path: master.rawAudio,
      });
    }

    // 2. Load master alignment, locate each segment's window.
    const alignment = await loadMasterAlignment(master.alignment);
    if (!alignment) {
      throw new Error(`voiceover stage: failed to load master alignment at ${master.alignment}`);
    }
    let windows: SegmentWindow[];
    try {
      windows = locateSegmentWindows(voSegments, alignment);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`voiceover stage: ${cause}`);
    }

    // 3. Compute midpoint boundaries so each segment slice absorbs half of the
    //    silence on either side. Concatenating the slices reproduces the master
    //    bit-for-bit (modulo ffmpeg re-encode), preserving model-generated pauses.
    const masterDuration = await ffprobeDuration(master.rawAudio);
    const boundaries = computeSliceBoundaries(windows, masterDuration);

    // 4. Slice master per segment, write per-segment alignment.
    const artifacts: SegmentArtifact[] = [];
    for (let i = 0; i < manifest.segments.length; i++) {
      const segment = manifest.segments[i]!;
      const window = windows[i]!;
      const boundary = boundaries[i]!;
      try {
        const artifact = await sliceSegmentFromMaster({
          segment,
          window,
          boundary,
          masterAudioPath: master.rawAudio,
          masterAlignment: alignment,
          operatorAllocated: segment.end - segment.start,
          tailPaddingSec,
          audioDir,
          alignmentDir,
          voSpeed,
        });
        artifacts.push(artifact);
        logger.event({
          stage: 'voiceover',
          status: 'segment_sliced',
          segment: segment.id,
          slice_start: boundary.start_sec.toFixed(2),
          slice_end: boundary.end_sec.toFixed(2),
          natural: artifact.natural_duration_seconds.toFixed(2),
          final: artifact.final_duration_seconds.toFixed(2),
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        throw new Error(`voiceover stage: segment ${segment.id}: ${cause}`);
      }
    }

    // 4. Rewrite manifest timings to reflect actual VO durations.
    const rewritten = rewriteManifestTimings(manifest, artifacts);
    if (rewritten.changed) {
      await writeManifest(manifestPath, rewritten.manifest);
      stageWarnings.push(
        `manifest timings derived from VO: total_duration ${manifest.total_duration_seconds.toFixed(2)}s → ${rewritten.manifest.total_duration_seconds.toFixed(2)}s`,
      );
      logger.event({
        stage: 'voiceover',
        status: 'manifest_rewritten',
        path: manifestPath,
        new_total: rewritten.manifest.total_duration_seconds,
      });
    }

    const summaryPath = join(audioDir, 'voiceover_summary.json');
    const totalCharacters = manifest.segments.reduce((acc, s) => acc + s.vo_line.length, 0);
    await writeFile(
      summaryPath,
      JSON.stringify(
        {
          mode: 'full',
          characters_synthesized: totalCharacters,
          tail_padding_ms: vo.tail_padding_ms,
          normalization: {
            enabled: ctx.config.voiceover.normalization.enabled,
            substitutions: normalizationDiffs.length,
            diffs: normalizationDiffs,
          },
          master_audio: master.rawAudio,
          master_alignment: master.alignment,
          segments: artifacts,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );

    const artifactsRecord: Record<string, string> = {
      voiceover_summary: summaryPath,
      master_audio: master.rawAudio,
      master_alignment: master.alignment,
    };
    for (const a of artifacts) {
      artifactsRecord[`audio_${a.segment_id}`] = a.final_path;
    }

    return {
      stage: 'voiceover',
      skipped: false,
      durationMs: Date.now() - start,
      artifacts: artifactsRecord,
      warnings: [...stageWarnings, ...artifacts.flatMap((a) => a.warnings)],
      meta: {
        mode: 'full',
        segments: artifacts.length,
        characters_synthesized: totalCharacters,
      },
    };
  },
};

interface SliceSegmentInput {
  segment: Segment;
  window: SegmentWindow;
  boundary: SliceBoundary;
  masterAudioPath: string;
  masterAlignment: import('../manifest/alignment.js').CharacterAlignment;
  operatorAllocated: number;
  tailPaddingSec: number;
  audioDir: string;
  alignmentDir: string;
  voSpeed: number;
}

async function sliceSegmentFromMaster(input: SliceSegmentInput): Promise<SegmentArtifact> {
  const {
    segment,
    window,
    boundary,
    masterAudioPath,
    masterAlignment,
    operatorAllocated,
    audioDir,
    alignmentDir,
    voSpeed,
  } = input;
  const warnings: string[] = [];

  // The slice covers boundary.start_sec → boundary.end_sec of the master, which
  // includes this segment's speech plus its half-share of inter-segment silence.
  // No debreath, no pause injection — the master already carries natural pauses.
  const finalPath = join(audioDir, `${segment.id}.mp3`);
  await sliceMasterAudio({
    masterPath: masterAudioPath,
    outputPath: finalPath,
    startSec: boundary.start_sec,
    durationSec: boundary.end_sec - boundary.start_sec,
  });

  // Per-segment alignment file with segment-mp3 timings (0 = start of the mp3
  // including any leading silence). Both at_word resolution in record.ts and
  // caption emission rely on this coordinate system.
  const segAlignment = sliceAlignment(masterAlignment, window, boundary);
  const alignmentPath = join(alignmentDir, `${segment.id}.alignment.json`);
  await writeFile(alignmentPath, JSON.stringify(segAlignment, null, 2) + '\n', 'utf8');

  const finalDuration = await ffprobeDuration(finalPath);
  const speechDuration = window.end_time_seconds - window.start_time_seconds;
  const driftAction: SegmentArtifact['drift_action'] =
    Math.abs(finalDuration - operatorAllocated) > 0.05 ? 'auto_extended' : 'kept';

  return {
    segment_id: segment.id,
    final_path: finalPath,
    natural_duration_seconds: speechDuration,
    final_duration_seconds: finalDuration,
    target_duration_seconds: finalDuration,
    characters_synthesized: segment.vo_line.length,
    used_speed: voSpeed,
    drift_action: driftAction,
    pause_strategy: 'master_slice',
    warnings,
  };
}

interface RewriteResult {
  manifest: Manifest;
  changed: boolean;
}

function rewriteManifestTimings(manifest: Manifest, artifacts: SegmentArtifact[]): RewriteResult {
  const byId = new Map(artifacts.map((a) => [a.segment_id, a]));
  let cursor = 0;
  let changed = false;
  const newSegments = manifest.segments.map((seg) => {
    const a = byId.get(seg.id);
    const allocated = seg.end - seg.start;
    const actual = a?.final_duration_seconds ?? allocated;
    if (Math.abs(actual - allocated) > 0.01 || Math.abs(seg.start - cursor) > 0.01) {
      changed = true;
    }
    const newStart = cursor;
    const newEnd = cursor + actual;
    cursor = newEnd;
    return { ...seg, start: round(newStart), end: round(newEnd) };
  });
  const newTotal = round(cursor);
  if (Math.abs(newTotal - manifest.total_duration_seconds) > 0.01) changed = true;
  return {
    manifest: { ...manifest, segments: newSegments, total_duration_seconds: newTotal },
    changed,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

interface BestEffortPathInput {
  ctx: PipelineContext;
  manifest: Manifest;
  provider: TTSProvider;
  audioDir: string;
  alignmentDir: string;
  tailPaddingSec: number;
  forced: boolean;
  start: number;
  manifestPath: string;
  voSpeed: number;
  voSegments: Segment[];
  normalizationDiffs: NormalizationDiff[];
}

/**
 * Per-segment synthesis fallback for providers that don't return alignment
 * data. One TTS call per segment; no master alignment to slice from. Captions
 * fall back to whole-segment cues (handled in mux/captions.ts), and at_word
 * action timing degrades to action.at (handled in record.ts:resolveAtForAction).
 */
async function runBestEffortPath(input: BestEffortPathInput): Promise<StageResult> {
  const { ctx, manifest, provider, audioDir, tailPaddingSec, forced, start, manifestPath, voSpeed, voSegments, normalizationDiffs } = input;
  void ctx;
  const stageWarnings: string[] = [
    `alignment_strategy=best_effort: provider '${provider.name}' produces no alignment — captions will be whole-segment cues and at_word will degrade to at-time`,
  ];
  logger.warn(stageWarnings[0]!);

  const artifacts: SegmentArtifact[] = [];
  let totalCharacters = 0;

  for (const segment of voSegments) {
    const finalPath = join(audioDir, `${segment.id}.mp3`);
    if ((await fileExists(finalPath)) && !forced) {
      const existingDuration = await ffprobeDuration(finalPath).catch(
        () => segment.end - segment.start,
      );
      artifacts.push({
        segment_id: segment.id,
        final_path: finalPath,
        natural_duration_seconds: existingDuration,
        final_duration_seconds: existingDuration,
        target_duration_seconds: existingDuration,
        characters_synthesized: 0,
        used_speed: voSpeed,
        drift_action: 'reused',
        pause_strategy: 'master_slice',
        warnings: [],
      });
      logger.event({ stage: 'voiceover', status: 'reusing', segment: segment.id, path: finalPath });
      continue;
    }

    logger.event({
      stage: 'voiceover',
      status: 'synthesizing_segment',
      provider: provider.name,
      segment: segment.id,
    });
    const result = await provider.synthesize({ text: segment.vo_line });
    await writeFile(finalPath, result.audio);
    totalCharacters += result.charactersSynthesized;
    const finalDuration = await ffprobeDuration(finalPath);
    artifacts.push({
      segment_id: segment.id,
      final_path: finalPath,
      natural_duration_seconds: result.durationSeconds,
      final_duration_seconds: finalDuration,
      target_duration_seconds: finalDuration + tailPaddingSec,
      characters_synthesized: result.charactersSynthesized,
      used_speed: voSpeed,
      drift_action: 'kept',
      pause_strategy: 'master_slice',
      warnings: [],
    });
    logger.event({
      stage: 'voiceover',
      status: 'segment_complete',
      segment: segment.id,
      duration: finalDuration.toFixed(2),
    });
  }

  const rewritten = rewriteManifestTimings(manifest, artifacts);
  if (rewritten.changed) {
    await writeManifest(manifestPath, rewritten.manifest);
    stageWarnings.push(
      `manifest timings derived from per-segment VO: total_duration ${manifest.total_duration_seconds.toFixed(2)}s → ${rewritten.manifest.total_duration_seconds.toFixed(2)}s`,
    );
  }

  const summaryPath = join(audioDir, 'voiceover_summary.json');
  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        mode: 'per_segment_best_effort',
        provider: provider.name,
        alignment_available: false,
        characters_synthesized: totalCharacters,
        normalization: {
          enabled: input.ctx.config.voiceover.normalization.enabled,
          substitutions: normalizationDiffs.length,
          diffs: normalizationDiffs,
        },
        segments: artifacts,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const artifactsRecord: Record<string, string> = { voiceover_summary: summaryPath };
  for (const a of artifacts) artifactsRecord[`audio_${a.segment_id}`] = a.final_path;

  return {
    stage: 'voiceover',
    skipped: false,
    durationMs: Date.now() - start,
    artifacts: artifactsRecord,
    warnings: [...stageWarnings, ...artifacts.flatMap((a) => a.warnings)],
    meta: {
      mode: 'best_effort',
      provider: provider.name,
      alignment_available: false,
      segments: artifacts.length,
      characters_synthesized: totalCharacters,
    },
  };
}
