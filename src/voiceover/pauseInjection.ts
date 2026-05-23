import { logger } from '../util/logger.js';
import { runFfmpeg } from './ffmpeg.js';
import { detectSilences } from './silence.js';
import type { Segment } from '../manifest/schema.js';

export interface PauseInjectionConfig {
  strategy: 'action_boundaries' | 'trailing';
  min_silence_ms: number;
  snap_window_ms: number;
}

export interface InjectionResult {
  output_path: string;
  slack_seconds: number;
  inserted_seconds: number;
  applied_strategy: 'action_boundaries' | 'trailing' | 'copy';
  snapped_breaks: Array<{ target: number; silence_start: number; silence_end: number; added: number }>;
  fallback_reason?: string;
}

export interface InjectInput {
  inputPath: string;
  outputPath: string;
  inputDuration: number;
  segment: Segment;
  config: PauseInjectionConfig;
}

export async function injectPauses(input: InjectInput): Promise<InjectionResult> {
  const segmentDuration = input.segment.end - input.segment.start;
  const slack = segmentDuration - input.inputDuration;
  const minSilence = input.config.min_silence_ms / 1000;

  if (slack < minSilence) {
    await copyClip(input.inputPath, input.outputPath);
    return {
      output_path: input.outputPath,
      slack_seconds: slack,
      inserted_seconds: 0,
      applied_strategy: 'copy',
      snapped_breaks: [],
      fallback_reason: slack < 0 ? 'clip exceeds segment budget' : 'slack below min_silence_ms',
    };
  }

  if (input.config.strategy === 'trailing' || input.segment.actions.length <= 1) {
    return await applyTrailing(input, slack, input.config.strategy === 'trailing' ? undefined : 'segment has ≤1 action');
  }

  return await applyActionBoundaries(input, slack);
}

async function applyTrailing(
  input: InjectInput,
  slack: number,
  fallbackReason: string | undefined,
): Promise<InjectionResult> {
  await runFfmpeg({
    args: [
      '-y',
      '-i',
      input.inputPath,
      '-af',
      `apad=pad_dur=${slack.toFixed(3)}`,
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      input.outputPath,
    ],
  });
  return {
    output_path: input.outputPath,
    slack_seconds: slack,
    inserted_seconds: slack,
    applied_strategy: 'trailing',
    snapped_breaks: [],
    fallback_reason: fallbackReason,
  };
}

async function applyActionBoundaries(input: InjectInput, slack: number): Promise<InjectionResult> {
  const actionCount = input.segment.actions.length;
  const candidates: number[] = [];
  for (let i = 1; i < actionCount; i++) {
    candidates.push((i / actionCount) * input.inputDuration);
  }

  const silences = await detectSilences(input.inputPath);
  const snapWindow = input.config.snap_window_ms / 1000;

  const snapped: Array<{ target: number; silence: (typeof silences)[number] }> = [];
  const usedSilences = new Set<number>();

  for (const target of candidates) {
    let best: { distance: number; silence: (typeof silences)[number] } | undefined;
    for (const s of silences) {
      const key = Math.round(s.mid * 1000);
      if (usedSilences.has(key)) continue;
      const distance = Math.abs(s.mid - target);
      if (distance > snapWindow) continue;
      if (!best || distance < best.distance) {
        best = { distance, silence: s };
      }
    }
    if (best) {
      usedSilences.add(Math.round(best.silence.mid * 1000));
      snapped.push({ target, silence: best.silence });
    } else {
      logger.warn(
        `segment ${input.segment.id}: no natural silence within ${snapWindow}s of target ${target.toFixed(2)}s — skipping`,
      );
    }
  }

  if (snapped.length === 0) {
    return await applyTrailing(input, slack, 'no candidate boundaries snapped to natural silence');
  }

  snapped.sort((a, b) => a.silence.start - b.silence.start);
  const perPoint = slack / snapped.length;

  const filterParts: string[] = [];
  const concatInputs: string[] = [];
  let prevEnd = 0.0;
  for (let j = 0; j < snapped.length; j++) {
    const { silence } = snapped[j]!;
    const trimLabel = `a${j}`;
    filterParts.push(
      `[0:a]atrim=start=${prevEnd.toFixed(3)}:end=${silence.start.toFixed(3)},asetpts=PTS-STARTPTS[${trimLabel}]`,
    );
    concatInputs.push(`[${trimLabel}]`);

    const silenceDuration = silence.duration + perPoint;
    const silLabel = `s${j}`;
    filterParts.push(
      `aevalsrc=0:d=${silenceDuration.toFixed(3)}:sample_rate=44100[${silLabel}]`,
    );
    concatInputs.push(`[${silLabel}]`);

    prevEnd = silence.end;
  }
  const tailLabel = `a${snapped.length}`;
  filterParts.push(`[0:a]atrim=start=${prevEnd.toFixed(3)},asetpts=PTS-STARTPTS[${tailLabel}]`);
  concatInputs.push(`[${tailLabel}]`);
  filterParts.push(`${concatInputs.join('')}concat=n=${concatInputs.length}:v=0:a=1[out]`);

  await runFfmpeg({
    args: [
      '-y',
      '-i',
      input.inputPath,
      '-filter_complex',
      filterParts.join(';'),
      '-map',
      '[out]',
      '-ar',
      '44100',
      '-ac',
      '1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      input.outputPath,
    ],
  });

  return {
    output_path: input.outputPath,
    slack_seconds: slack,
    inserted_seconds: slack,
    applied_strategy: 'action_boundaries',
    snapped_breaks: snapped.map((item) => ({
      target: item.target,
      silence_start: item.silence.start,
      silence_end: item.silence.end,
      added: perPoint,
    })),
  };
}

async function copyClip(input: string, output: string): Promise<void> {
  await runFfmpeg({ args: ['-y', '-i', input, '-c', 'copy', output] });
}
