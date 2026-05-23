import { writeFile } from 'node:fs/promises';
import { loadAlignment, type CharacterAlignment } from '../manifest/alignment.js';
import type { Manifest } from '../manifest/schema.js';
import type { SlicePlan } from './slice.js';
import { logger } from '../util/logger.js';

const MAX_CUE_CHARS = 42;
const MAX_CUE_SECONDS = 3;

export interface Cue {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

export interface EmitCaptionsOptions {
  manifest: Manifest;
  alignmentDir: string;
  slicePlan: SlicePlan;
  /** Output path stem (without extension). `.srt` and/or `.vtt` are appended. */
  outputBase: string;
  format: 'srt' | 'vtt' | 'both';
  /**
   * Seconds added to every cue to account for any pre-roll (e.g. the title card).
   * Slice_plan timestamps are in master.webm time; the final mp4 has title card
   * + outro card glued on the ends. The caller passes the title card duration here.
   */
  titleCardOffset?: number;
}

export async function emitCaptions(opts: EmitCaptionsOptions): Promise<string[]> {
  const cues: Cue[] = [];
  const titleOffset = opts.titleCardOffset ?? 0;
  let cueIndex = 1;

  for (const seg of opts.manifest.segments) {
    const slice = opts.slicePlan.segments.find((s) => s.id === seg.id);
    if (slice && slice.status !== 'ok') continue;

    // The manifest is rewritten by the voiceover stage so segment.start/end
    // reflect the audio-concat timeline used by mux. Final-mp4 time =
    // title_card_duration + manifest segment.start. The slice_plan's t_start
    // lives in master.webm coordinates (which include the pre-segment recording
    // offset) and is wrong for the final mp4 — don't use it here.
    const segmentStartInFinalMp4 = titleOffset + seg.start;
    const segmentEndInFinalMp4 = titleOffset + seg.end;

    const alignmentPath = `${opts.alignmentDir}/${seg.id}.alignment.json`;
    const alignment = await loadAlignment(alignmentPath);
    if (!alignment) {
      logger.warn(`captions: no alignment for segment ${seg.id} — falling back to whole-segment cue`);
      cues.push({
        index: cueIndex++,
        startSec: segmentStartInFinalMp4,
        endSec: segmentEndInFinalMp4,
        text: collapse(seg.vo_line),
      });
      continue;
    }

    // Per-segment alignment now uses segment-mp3 time (0 = segment mp3 start,
    // including any leading silence before speech). Adding segmentStartInFinalMp4
    // gives the absolute time in the final mp4.
    const segCues = chunkAlignmentToCues(alignment, segmentStartInFinalMp4);
    for (const c of segCues) {
      cues.push({ ...c, index: cueIndex++ });
    }
  }

  const written: string[] = [];
  if (opts.format === 'srt' || opts.format === 'both') {
    const path = `${opts.outputBase}.srt`;
    await writeFile(path, renderSrt(cues), 'utf8');
    written.push(path);
  }
  if (opts.format === 'vtt' || opts.format === 'both') {
    const path = `${opts.outputBase}.vtt`;
    await writeFile(path, renderVtt(cues), 'utf8');
    written.push(path);
  }
  return written;
}

export function chunkAlignmentToCues(
  alignment: CharacterAlignment,
  segmentStartSec: number,
): Cue[] {
  const cues: Cue[] = [];
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  if (chars.length === 0) return cues;

  let cueStart = starts[0]!;
  let cueChars: string[] = [];
  let lastBoundaryIdx = -1;
  let i = 0;

  const pushCue = (endIdx: number): void => {
    const text = cueChars.join('').replace(/\s+/g, ' ').trim();
    if (text.length === 0) return;
    cues.push({
      index: 0, // assigned by caller
      startSec: segmentStartSec + cueStart,
      endSec: segmentStartSec + ends[endIdx]!,
      text,
    });
  };

  while (i < chars.length) {
    cueChars.push(chars[i]!);

    const cuTextLen = cueChars.join('').length;
    const cueDuration = ends[i]! - cueStart;
    const atWordBoundary = /\s/.test(chars[i]!) || /[.,;!?—]/.test(chars[i]!);
    if (atWordBoundary) lastBoundaryIdx = i;

    const overChars = cuTextLen >= MAX_CUE_CHARS;
    const overTime = cueDuration >= MAX_CUE_SECONDS;

    if ((overChars || overTime) && lastBoundaryIdx > -1) {
      // Split at the last word boundary; keep everything after for the next cue
      const cutAt = lastBoundaryIdx;
      cueChars = cueChars.slice(0, cutAt - i + cueChars.length);
      pushCue(cutAt);
      // Reset for next cue
      cueStart = starts[cutAt + 1] ?? starts[i]!;
      cueChars = [];
      // continue from cutAt + 1
      i = cutAt + 1;
      lastBoundaryIdx = -1;
      continue;
    }

    i++;
  }

  // Final cue
  if (cueChars.length > 0) {
    pushCue(chars.length - 1);
  }

  return cues;
}

function renderSrt(cues: Cue[]): string {
  return cues
    .map((c) => `${c.index}\n${fmtSrt(c.startSec)} --> ${fmtSrt(c.endSec)}\n${c.text}\n`)
    .join('\n');
}

function renderVtt(cues: Cue[]): string {
  return ['WEBVTT', '', ...cues.map((c) => `${fmtVtt(c.startSec)} --> ${fmtVtt(c.endSec)}\n${c.text}\n`)].join(
    '\n',
  );
}

function fmtSrt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

function fmtVtt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

function pad(n: number, w: number): string {
  return n.toString().padStart(w, '0');
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
