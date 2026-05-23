import { logger } from '../util/logger.js';
import type { SynthesisResult } from './elevenlabs.js';

const SPEED_MIN = 0.85;
const SPEED_MAX = 1.15;
const MAX_RESYNTH_ATTEMPTS = 2;

export interface DriftAssessment {
  drift_pct: number;
  over_threshold: boolean;
  ratio: number;
}

export function assessDrift(
  actualDuration: number,
  allocatedDuration: number,
  thresholdPct: number,
): DriftAssessment {
  if (allocatedDuration <= 0) {
    return { drift_pct: Infinity, over_threshold: true, ratio: Infinity };
  }
  const driftPct = (Math.abs(actualDuration - allocatedDuration) / allocatedDuration) * 100;
  return {
    drift_pct: driftPct,
    over_threshold: driftPct > thresholdPct,
    ratio: actualDuration / allocatedDuration,
  };
}

export type SynthAt = (speed: number) => Promise<SynthesisResult>;

export interface ResynthesizeOptions {
  initial: SynthesisResult;
  allocatedDuration: number;
  thresholdPct: number;
  currentSpeed: number;
  synth: SynthAt;
  segmentId: string;
}

export interface ResynthesizeOutcome {
  result: SynthesisResult;
  speed: number;
  attempts: number;
  final_drift_pct: number;
  fell_back: boolean;
  warnings: string[];
}

export async function resynthesizeForFit(
  opts: ResynthesizeOptions,
): Promise<ResynthesizeOutcome> {
  const warnings: string[] = [];
  let best = opts.initial;
  let bestSpeed = opts.currentSpeed;
  let bestAssessment = assessDrift(best.durationSeconds, opts.allocatedDuration, opts.thresholdPct);

  if (!bestAssessment.over_threshold) {
    return {
      result: best,
      speed: bestSpeed,
      attempts: 0,
      final_drift_pct: bestAssessment.drift_pct,
      fell_back: false,
      warnings,
    };
  }

  let speed = opts.currentSpeed;
  for (let attempt = 1; attempt <= MAX_RESYNTH_ATTEMPTS; attempt++) {
    const desired = speed * (best.durationSeconds / opts.allocatedDuration);
    const next = clamp(desired, SPEED_MIN, SPEED_MAX);
    if (Math.abs(next - speed) < 0.005) {
      warnings.push(
        `segment ${opts.segmentId}: speed already at clamp boundary (${speed.toFixed(2)}); cannot resynthesize further`,
      );
      break;
    }
    speed = next;
    logger.info(`segment ${opts.segmentId}: resynth attempt ${attempt} at speed=${speed.toFixed(2)}`, {
      previous_duration: best.durationSeconds,
      allocated: opts.allocatedDuration,
    });

    const candidate = await opts.synth(speed);
    const candidateAssessment = assessDrift(
      candidate.durationSeconds,
      opts.allocatedDuration,
      opts.thresholdPct,
    );

    if (candidateAssessment.drift_pct < bestAssessment.drift_pct) {
      best = candidate;
      bestSpeed = speed;
      bestAssessment = candidateAssessment;
    }
    if (!candidateAssessment.over_threshold) {
      return {
        result: best,
        speed: bestSpeed,
        attempts: attempt,
        final_drift_pct: candidateAssessment.drift_pct,
        fell_back: false,
        warnings,
      };
    }
  }

  warnings.push(
    `segment ${opts.segmentId}: drift still over threshold after ${MAX_RESYNTH_ATTEMPTS} resynth attempts; falling back to adjust_timing`,
  );
  return {
    result: best,
    speed: bestSpeed,
    attempts: MAX_RESYNTH_ATTEMPTS,
    final_drift_pct: bestAssessment.drift_pct,
    fell_back: true,
    warnings,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
