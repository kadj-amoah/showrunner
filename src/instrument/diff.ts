import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import type { Suggestion } from './suggest.js';

export interface DiffOptions {
  /** When set, paths in the diff are written relative to this dir. */
  basePath?: string;
}

/**
 * Build a unified diff from per-file single-line replacements. Each suggestion
 * is treated independently; lines that don't match the suggestion's `original`
 * exactly are skipped with a warning header but don't block the rest.
 */
export async function buildDiff(
  suggestions: Suggestion[],
  opts: DiffOptions = {},
): Promise<{ patch: string; skipped: { file: string; line: number; reason: string }[] }> {
  const byFile = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    const arr = byFile.get(s.file) ?? [];
    arr.push(s);
    byFile.set(s.file, arr);
  }

  const skipped: { file: string; line: number; reason: string }[] = [];
  const fileDiffs: string[] = [];

  for (const [file, perFile] of byFile) {
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch (err) {
      for (const s of perFile) {
        skipped.push({
          file,
          line: s.line,
          reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      continue;
    }
    const lines = source.split('\n');
    const sorted = [...perFile].sort((a, b) => a.line - b.line);

    const hunks: string[] = [];
    for (const s of sorted) {
      const idx = s.line - 1;
      const actual = lines[idx];
      if (actual === undefined) {
        skipped.push({ file, line: s.line, reason: 'line out of range' });
        continue;
      }
      if (actual.trim() !== s.original.trim()) {
        skipped.push({
          file,
          line: s.line,
          reason: `source line drifted from suggestion (expected "${s.original.trim()}", saw "${actual.trim()}")`,
        });
        continue;
      }
      hunks.push(
        `@@ -${s.line},1 +${s.line},1 @@\n-${actual}\n+${s.replacement}`,
      );
    }

    if (hunks.length === 0) continue;
    const displayPath = opts.basePath ? relative(opts.basePath, file).replace(/\\/g, '/') : file;
    fileDiffs.push(`--- a/${displayPath}\n+++ b/${displayPath}\n${hunks.join('\n')}`);
  }

  return { patch: fileDiffs.join('\n') + (fileDiffs.length > 0 ? '\n' : ''), skipped };
}
