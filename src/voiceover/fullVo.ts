import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../util/logger.js';
import { runFfmpeg } from './ffmpeg.js';
import type { Segment } from '../manifest/schema.js';
import type { CharacterAlignment } from '../manifest/alignment.js';

export interface SegmentWindow {
  segment_id: string;
  start_time_seconds: number;
  end_time_seconds: number;
  start_char_index: number;
  end_char_index: number;
}

export interface BreakPolicy {
  /** Default pause between segments, in seconds. */
  betweenSegments: number;
  /** Pause around fade_in / fade_out transitions. */
  fadeBoundary: number;
}

const DEFAULT_BREAK_POLICY: BreakPolicy = {
  betweenSegments: 0.45,
  fadeBoundary: 0.75,
};

/**
 * Build the master script that gets sent as a single ElevenLabs call. Segments
 * are joined with `<break time="X.Xs"/>` SSML tags so the TTS engine renders
 * one continuous take with model-generated pauses between segments — preserving
 * prosody, breath, and natural intonation across the entire demo. Slicing back
 * into per-segment files happens against the rendered audio, at midpoints
 * inside each break, so concatenation reproduces the master.
 */
export function buildFullScript(segments: Segment[], policy: BreakPolicy = DEFAULT_BREAK_POLICY): string {
  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (i > 0) {
      const prev = segments[i - 1]!;
      const fade = prev.transition === 'fade_out' || seg.transition === 'fade_in';
      const dur = fade ? policy.fadeBoundary : policy.betweenSegments;
      parts.push(`<break time="${dur.toFixed(2)}s"/>`);
    }
    parts.push(seg.vo_line.trim());
  }
  return parts.join(' ');
}

/**
 * Walk the alignment.characters array and identify, for each segment, the
 * [start, end] character indices that correspond to its vo_line. We match by
 * comparing collapsed-whitespace prefixes — robust to small drift between the
 * exact text we sent and what ElevenLabs reports back in the alignment.
 */
export function locateSegmentWindows(
  segments: Segment[],
  alignment: CharacterAlignment,
): SegmentWindow[] {
  const windows: SegmentWindow[] = [];
  let cursor = 0;
  for (const seg of segments) {
    const target = seg.vo_line.trim();
    if (target.length === 0) {
      windows.push({
        segment_id: seg.id,
        start_time_seconds: cursor < alignment.character_start_times_seconds.length
          ? alignment.character_start_times_seconds[cursor] ?? 0
          : 0,
        end_time_seconds: cursor < alignment.character_end_times_seconds.length
          ? alignment.character_end_times_seconds[cursor] ?? 0
          : 0,
        start_char_index: cursor,
        end_char_index: cursor,
      });
      continue;
    }
    const startIdx = findSegmentStart(alignment.characters, target, cursor);
    if (startIdx === -1) {
      throw new Error(
        `Could not locate segment "${seg.id}" in master alignment (starting search at index ${cursor}). ` +
          `First 80 chars of expected text: ${JSON.stringify(target.slice(0, 80))}`,
      );
    }
    const endIdx = findSegmentEnd(alignment.characters, target, startIdx);
    if (endIdx === -1) {
      throw new Error(
        `Located start of segment "${seg.id}" at index ${startIdx} but could not find its end.`,
      );
    }
    windows.push({
      segment_id: seg.id,
      start_time_seconds: alignment.character_start_times_seconds[startIdx] ?? 0,
      end_time_seconds: alignment.character_end_times_seconds[endIdx] ?? 0,
      start_char_index: startIdx,
      end_char_index: endIdx,
    });
    cursor = endIdx + 1;
  }
  return windows;
}

/**
 * Find the index in `chars` where `target` begins, starting search at `from`.
 * Tolerates whitespace differences (consecutive whitespace in either string is
 * treated as a single space).
 */
function findSegmentStart(chars: string[], target: string, from: number): number {
  const normTarget = collapseWhitespace(target);
  const firstTargetChar = normTarget[0]!;
  for (let i = from; i < chars.length; i++) {
    const c = chars[i]!;
    if (c.toLowerCase() !== firstTargetChar.toLowerCase()) continue;
    if (matchesAt(chars, i, normTarget)) return i;
  }
  return -1;
}

function findSegmentEnd(chars: string[], target: string, startIdx: number): number {
  // Walk forward from startIdx, matching against target with whitespace tolerance.
  let ti = 0;
  let ci = startIdx;
  const normTarget = collapseWhitespace(target);
  while (ti < normTarget.length && ci < chars.length) {
    const tc = normTarget[ti]!;
    const cc = chars[ci]!;
    if (tc === ' ') {
      // Consume one or more whitespace chars in source
      if (isWs(cc)) {
        while (ci < chars.length && isWs(chars[ci]!)) ci++;
        ti++;
        continue;
      }
      // Target wants space but source doesn't — abort
      return -1;
    }
    if (cc.toLowerCase() === tc.toLowerCase()) {
      ti++;
      ci++;
      continue;
    }
    if (isWs(cc)) {
      // skip extra whitespace in source
      ci++;
      continue;
    }
    return -1;
  }
  return ti === normTarget.length ? ci - 1 : -1;
}

function matchesAt(chars: string[], from: number, normTarget: string): boolean {
  let ti = 0;
  let ci = from;
  // Quick check: scan PREFIX_CHECK characters
  const PREFIX_CHECK = Math.min(20, normTarget.length);
  while (ti < PREFIX_CHECK && ci < chars.length) {
    const tc = normTarget[ti]!;
    const cc = chars[ci]!;
    if (tc === ' ') {
      if (isWs(cc)) {
        while (ci < chars.length && isWs(chars[ci]!)) ci++;
        ti++;
        continue;
      }
      return false;
    }
    if (cc.toLowerCase() === tc.toLowerCase()) {
      ti++;
      ci++;
      continue;
    }
    if (isWs(cc)) {
      ci++;
      continue;
    }
    return false;
  }
  return ti === PREFIX_CHECK;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ');
}

function isWs(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

export interface SliceBoundary {
  segment_id: string;
  /** Start time in master (seconds). Includes leading silence up to the midpoint of the prior gap. */
  start_sec: number;
  /** End time in master (seconds). Includes trailing silence up to the midpoint of the next gap. */
  end_sec: number;
}

/**
 * Convert per-segment character windows into mp3 slice boundaries. Each segment
 * absorbs half of the silence on either side of it, so concatenating all slices
 * exactly reproduces the master audio — preserving the model-generated pauses
 * (and the natural breath/prosody around them) instead of replacing them with
 * dead silence.
 */
export function computeSliceBoundaries(
  windows: SegmentWindow[],
  masterDurationSec: number,
): SliceBoundary[] {
  const boundaries: SliceBoundary[] = [];
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]!;
    const prev = windows[i - 1];
    const next = windows[i + 1];
    const start =
      i === 0
        ? 0
        : (prev!.end_time_seconds + w.start_time_seconds) / 2;
    const end =
      i === windows.length - 1
        ? masterDurationSec
        : (w.end_time_seconds + next!.start_time_seconds) / 2;
    boundaries.push({ segment_id: w.segment_id, start_sec: start, end_sec: end });
  }
  return boundaries;
}

/**
 * Slice a single segment out of the master mp3 with a clean re-encode so cut
 * boundaries land on frame edges. Re-encode is fast for ~5s clips and avoids
 * the keyframe glitches `-c copy` would introduce.
 */
export async function sliceMasterAudio(opts: {
  masterPath: string;
  outputPath: string;
  startSec: number;
  durationSec: number;
}): Promise<void> {
  await runFfmpeg({
    args: [
      '-y',
      '-ss',
      opts.startSec.toFixed(3),
      '-i',
      opts.masterPath,
      '-t',
      Math.max(0.1, opts.durationSec).toFixed(3),
      '-c:a',
      'libmp3lame',
      '-q:a',
      '4',
      opts.outputPath,
    ],
  });
}

/**
 * Build a per-segment alignment file by slicing the master alignment and
 * shifting all timestamps into segment-mp3-file time. The mp3 starts at
 * `boundary.start_sec` in the master, so subtracting that gives times that are
 * relative to the segment's mp3 file (i.e. include the leading silence before
 * the speech starts). This is what both record.ts (at_word resolution) and
 * captions.ts (cue scheduling) need.
 */
export function sliceAlignment(
  master: CharacterAlignment,
  window: SegmentWindow,
  boundary: SliceBoundary,
): CharacterAlignment {
  const start = window.start_char_index;
  const end = window.end_char_index;
  const t0 = boundary.start_sec;
  return {
    characters: master.characters.slice(start, end + 1),
    character_start_times_seconds: master.character_start_times_seconds
      .slice(start, end + 1)
      .map((t) => t - t0),
    character_end_times_seconds: master.character_end_times_seconds
      .slice(start, end + 1)
      .map((t) => t - t0),
  };
}

export async function loadMasterAlignment(path: string): Promise<CharacterAlignment | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as CharacterAlignment;
  } catch {
    return null;
  }
}

export async function writeMasterAlignment(
  path: string,
  alignment: CharacterAlignment,
): Promise<void> {
  await writeFile(path, JSON.stringify(alignment) + '\n', 'utf8');
  logger.debug(`Wrote master alignment to ${path}`);
}

export interface MasterPaths {
  rawAudio: string;
  alignment: string;
}

export function masterPaths(audioDir: string, alignmentDir: string): MasterPaths {
  return {
    rawAudio: join(audioDir, '_master.raw.mp3'),
    alignment: join(alignmentDir, '_master.alignment.json'),
  };
}
