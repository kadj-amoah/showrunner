import { readFile } from 'node:fs/promises';

export interface QaSummaryShape {
  gate?: { ok?: boolean; issues?: string[] };
  naturalness?: { available?: boolean; score?: number | null; floor?: number | null; belowFloor?: boolean };
}

/** Render the QA verdict (gate + naturalness) from a voiceover summary as a
 *  short, human-readable block. Returns '' when there's nothing to report. */
export function formatQaSummary(summary: QaSummaryShape): string {
  const lines: string[] = [];

  if (summary.gate) {
    lines.push(
      summary.gate.ok
        ? '✓ QA gate: passed'
        : `⚠ QA gate: flagged — ${(summary.gate.issues ?? []).join('; ')}`,
    );
  }

  const n = summary.naturalness;
  if (n) {
    if (!n.available) {
      lines.push('Naturalness: not scored');
    } else {
      const floorNote = n.belowFloor ? ` — BELOW floor ${n.floor}` : '';
      lines.push(`Naturalness (MOS): ${n.score}${floorNote}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '';
}

/** Read a voiceover_summary.json if present; null when absent or unreadable. */
export async function loadVoiceoverSummary(path: string): Promise<QaSummaryShape | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as QaSummaryShape;
  } catch {
    return null;
  }
}
