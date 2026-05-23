import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Manifest } from './schema.js';

export interface VoScriptOptions {
  projectName: string;
  generatedAt?: Date;
}

export function renderVoScript(manifest: Manifest, opts: VoScriptOptions): string {
  const date = (opts.generatedAt ?? new Date()).toISOString().slice(0, 10);
  const lines: string[] = [
    `# Showrunner VO Script — ${opts.projectName}`,
    `# Total duration: ${formatDuration(manifest.total_duration_seconds)}`,
    `# Generated: ${date}`,
    ``,
    `# Edit the VO text below. Do not change the [m:ss] timestamps or line order.`,
    `# Re-run \`showrunner approve-vo\` to merge your edits back into the manifest.`,
    ``,
  ];
  for (const seg of manifest.segments) {
    lines.push(`[${formatTimestamp(seg.start)}] ${seg.vo_line}`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function writeVoScript(
  path: string,
  manifest: Manifest,
  opts: VoScriptOptions,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderVoScript(manifest, opts), 'utf8');
}

export class VoScriptMergeError extends Error {
  override readonly name = 'VoScriptMergeError';
}

interface ParsedLine {
  start: number;
  text: string;
  raw: string;
  lineNumber: number;
}

const LINE_PATTERN = /^\[(\d+):(\d{1,2})\]\s?(.*)$/;

export function parseVoScript(content: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const rawLines = content.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const match = LINE_PATTERN.exec(trimmed);
    if (!match) {
      throw new VoScriptMergeError(
        `Line ${i + 1} doesn't match \`[m:ss] text\` format: ${JSON.stringify(raw)}`,
      );
    }
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (seconds >= 60) {
      throw new VoScriptMergeError(`Line ${i + 1}: seconds must be < 60`);
    }
    out.push({
      start: minutes * 60 + seconds,
      text: (match[3] ?? '').trim(),
      raw,
      lineNumber: i + 1,
    });
  }
  return out;
}

export function mergeVoScript(manifest: Manifest, content: string): Manifest {
  const parsed = parseVoScript(content);
  if (parsed.length !== manifest.segments.length) {
    throw new VoScriptMergeError(
      `VO script has ${parsed.length} line(s); manifest has ${manifest.segments.length} segment(s). ` +
        `Adding or removing lines is not supported — regenerate the script via \`showrunner run --force script\`.`,
    );
  }
  const merged: Manifest = {
    ...manifest,
    segments: manifest.segments.map((seg, i) => {
      const line = parsed[i]!;
      if (Math.abs(line.start - seg.start) > 0.5) {
        throw new VoScriptMergeError(
          `Line ${line.lineNumber} timestamp [${formatTimestamp(line.start)}] does not match ` +
            `segment "${seg.id}" start (${formatTimestamp(seg.start)}). ` +
            `Did you reorder or retime lines? Regenerate via \`showrunner run --force script\`.`,
        );
      }
      return { ...seg, vo_line: line.text };
    }),
  };
  return merged;
}

export async function readAndMergeVoScript(path: string, manifest: Manifest): Promise<Manifest> {
  const content = await readFile(path, 'utf8');
  return mergeVoScript(manifest, content);
}

function formatTimestamp(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDuration(totalSeconds: number): string {
  return formatTimestamp(totalSeconds);
}
