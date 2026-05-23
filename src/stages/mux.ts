import { mkdir, rm, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Stage, StageResult, PipelineContext } from '../pipeline/types.js';
import { logger } from '../util/logger.js';
import { readManifest, ManifestError } from '../manifest/io.js';
import { ffprobeDuration } from '../voiceover/ffmpeg.js';
import { normalizeVideo } from '../mux/normalize.js';
import { prepareSegmentVideo, readSlicePlan } from '../mux/slice.js';
import { muxSegment } from '../mux/segmentMux.js';
import { concatSegments } from '../mux/concat.js';
import { applyBackgroundMusic, fileExists, renderCard } from '../mux/branding.js';
import { emitCaptions } from '../mux/captions.js';
import {
  assertEnoughDisk,
  computeThreadCap,
  formatBytes,
  getFreeDiskBytes,
  getFreeMemoryBytes,
} from '../util/resources.js';

export const muxStage: Stage = {
  name: 'mux',
  async run(ctx: PipelineContext): Promise<StageResult> {
    const start = Date.now();
    const warnings: string[] = [];

    const manifestPath = resolve(ctx.configDir, './scripts/manifest.json');
    const videoDir = resolve(ctx.configDir, ctx.config.recording.output_dir);
    const audioDir = resolve(ctx.configDir, ctx.config.voiceover.output_dir);
    const masterWebm = resolve(videoDir, 'master.webm');
    const slicePlanPath = resolve(videoDir, 'slice_plan.json');
    const outputPath = resolveOutput(ctx.config.output.output_path, ctx.configDir);

    const forced = ctx.forced.has('mux');
    if ((await fileExists(outputPath)) && !forced) {
      logger.event({ stage: 'mux', status: 'reusing', path: outputPath });
      return {
        stage: 'mux',
        skipped: true,
        reason: 'output file already present',
        durationMs: Date.now() - start,
        artifacts: { output: outputPath },
      };
    }

    for (const [label, path] of [
      ['manifest.json', manifestPath],
      ['master.webm', masterWebm],
      ['slice_plan.json', slicePlanPath],
    ] as const) {
      if (!(await fileExists(path))) {
        return {
          stage: 'mux',
          skipped: true,
          reason: `${label} not found at ${path} — run upstream stages first`,
          durationMs: Date.now() - start,
        };
      }
    }

    let manifest;
    try {
      manifest = await readManifest(manifestPath);
    } catch (err) {
      if (err instanceof ManifestError) {
        throw new Error(`mux stage: ${err.message}`);
      }
      throw err;
    }

    const slicePlan = await readSlicePlan(slicePlanPath);

    for (const seg of manifest.segments) {
      const audio = join(audioDir, `${seg.id}.mp3`);
      if (!(await fileExists(audio))) {
        return {
          stage: 'mux',
          skipped: true,
          reason: `audio for segment "${seg.id}" not found at ${audio} — run voiceover stage first`,
          durationMs: Date.now() - start,
        };
      }
    }

    const workDir = resolve(ctx.configDir, '.showrunner-cache', 'mux');
    await mkdir(workDir, { recursive: true });

    const fps = ctx.config.output.fps;
    const [widthStr, heightStr] = ctx.config.output.resolution.split('x');
    const width = Number.parseInt(widthStr!, 10);
    const height = Number.parseInt(heightStr!, 10);
    const quality = ctx.config.output.quality;
    logger.event({ stage: 'mux', status: 'quality', preset: quality });

    // Preflight: RAM headroom drives a per-encode thread cap; disk space gets
    // a sanity check on the workDir (rough estimate: 50 MB per segment + 200 MB
    // for the normalized master + final mp4 headroom).
    const freeMem = getFreeMemoryBytes();
    const freeDisk = await getFreeDiskBytes(workDir);
    const threads = computeThreadCap({ width, height, fps, quality, freeMemBytes: freeMem });
    const estDiskNeed = (manifest.segments.length * 50 + 200) * 1024 * 1024;
    logger.event({
      stage: 'mux',
      status: 'preflight',
      free_mem: formatBytes(freeMem),
      free_disk: formatBytes(freeDisk),
      threads,
      est_disk_need: formatBytes(estDiskNeed),
    });
    await assertEnoughDisk(workDir, estDiskNeed, 'mux workDir');

    logger.event({ stage: 'mux', status: 'normalizing_master' });
    const normalizedMaster = join(workDir, 'master.mp4');
    await normalizeVideo({
      inputPath: masterWebm,
      outputPath: normalizedMaster,
      fps,
      width,
      height,
      quality,
      threads,
    });

    const segmentPaths: string[] = [];

    if (ctx.config.output.branding.title_card?.enabled) {
      const tc = ctx.config.output.branding.title_card;
      const titlePath = join(workDir, '_title.mp4');
      await renderCard({
        outputPath: titlePath,
        width,
        height,
        fps,
        durationSeconds: tc.duration_seconds,
        text: tc.text,
        textColor: tc.text_color,
        backgroundColor: tc.background_color,
        fontPath: tc.font ? resolveMaybe(tc.font, ctx.configDir) : undefined,
        fontSize: tc.font_size,
        logoPath: tc.logo ? resolveMaybe(tc.logo, ctx.configDir) : undefined,
        logoPosition: tc.logo_position,
        quality,
      });
      segmentPaths.push(titlePath);
      logger.event({ stage: 'mux', status: 'title_card_rendered', path: titlePath });
    }

    for (const seg of manifest.segments) {
      logger.event({ stage: 'mux', status: 'segment_prepare', segment: seg.id });
      const videoSource = await prepareSegmentVideo({
        id: seg.id,
        videoDir,
        workDir,
        normalizedMasterPath: normalizedMaster,
        slicePlan,
        fps,
        width,
        height,
        quality,
      });

      const finalSeg = join(workDir, `${seg.id}.final.mp4`);
      await muxSegment({
        videoPath: videoSource.path,
        audioPath: join(audioDir, `${seg.id}.mp3`),
        outputPath: finalSeg,
        fps,
        width,
        height,
        transition: seg.transition,
        quality,
      });
      segmentPaths.push(finalSeg);
      logger.event({
        stage: 'mux',
        status: 'segment_muxed',
        segment: seg.id,
        source: videoSource.source,
      });
    }

    if (ctx.config.output.branding.outro_card?.enabled) {
      const oc = ctx.config.output.branding.outro_card;
      const outroPath = join(workDir, '_outro.mp4');
      await renderCard({
        outputPath: outroPath,
        width,
        height,
        fps,
        durationSeconds: oc.duration_seconds,
        text: oc.text,
        textColor: '#FFFFFF',
        backgroundColor: '#0F172A',
        fontSize: 36,
        quality,
      });
      segmentPaths.push(outroPath);
      logger.event({ stage: 'mux', status: 'outro_card_rendered', path: outroPath });
    }

    const concatPath = join(workDir, 'stitched.mp4');
    logger.event({ stage: 'mux', status: 'concat', inputs: segmentPaths.length });
    await concatSegments({
      segmentPaths,
      workDir,
      outputPath: concatPath,
    });

    let finalSource = concatPath;
    const music = ctx.config.output.background_music;
    if (music?.path) {
      const musicPath = resolveMaybe(music.path, ctx.configDir);
      if (await fileExists(musicPath)) {
        const mixed = join(workDir, 'mixed.mp4');
        logger.event({ stage: 'mux', status: 'background_music', path: musicPath });
        await applyBackgroundMusic({
          inputPath: concatPath,
          outputPath: mixed,
          musicPath,
          volumeDb: music.volume_db,
          quality,
        });
        finalSource = mixed;
      } else {
        warnings.push(`background_music.path not found at ${musicPath} — skipping mix`);
      }
    }

    await mkdir(dirname(outputPath), { recursive: true });
    let finalOutputPath = outputPath;
    if (await fileExists(outputPath)) {
      try {
        await rm(outputPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? '';
        if (code === 'EBUSY' || code === 'EPERM') {
          const ext = outputPath.endsWith('.mp4') ? '.mp4' : '';
          const stem = outputPath.slice(0, outputPath.length - ext.length);
          const stamp = new Date()
            .toISOString()
            .replace(/[:.]/g, '-')
            .slice(0, 19);
          finalOutputPath = `${stem}-${stamp}${ext}`;
          warnings.push(
            `existing output ${outputPath} is locked (likely open in a player); wrote new MP4 to ${finalOutputPath} instead`,
          );
          logger.warn(
            `existing output locked; writing to ${finalOutputPath} (close the player to reuse the canonical filename)`,
          );
        } else {
          throw err;
        }
      }
    }
    await rename(finalSource, finalOutputPath);

    const finalDuration = await ffprobeDuration(finalOutputPath);

    const captionsCfg = ctx.config.output.captions;
    const captionPaths: string[] = [];
    if (captionsCfg.enabled) {
      const alignmentDir = resolve(ctx.configDir, ctx.config.voiceover.alignment_dir);
      const titleCardOffset = ctx.config.output.branding.title_card?.enabled
        ? ctx.config.output.branding.title_card.duration_seconds
        : 0;
      const outputBase = finalOutputPath.replace(/\.mp4$/i, '');
      try {
        const written = await emitCaptions({
          manifest,
          alignmentDir,
          slicePlan,
          outputBase,
          format: captionsCfg.format,
          titleCardOffset,
        });
        captionPaths.push(...written);
        for (const p of written) {
          logger.event({ stage: 'mux', status: 'captions_written', path: p });
        }
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        warnings.push(`caption emission failed: ${cause}`);
      }
    }

    return {
      stage: 'mux',
      skipped: false,
      durationMs: Date.now() - start,
      artifacts: { output: finalOutputPath, captions: captionPaths.join(',') || undefined } as Record<
        string,
        string | undefined
      > as Record<string, string>,
      warnings,
      meta: {
        duration_seconds: finalDuration,
        segments: manifest.segments.length,
        had_title_card: !!ctx.config.output.branding.title_card?.enabled,
        had_outro_card: !!ctx.config.output.branding.outro_card?.enabled,
        captions: captionPaths,
      },
    };
  },
};

function resolveOutput(p: string, configDir: string): string {
  return isAbsolute(p) ? p : resolve(configDir, p);
}

function resolveMaybe(p: string, configDir: string): string {
  return isAbsolute(p) ? p : resolve(configDir, p);
}
