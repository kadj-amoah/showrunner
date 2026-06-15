import type { Manifest } from '../manifest/schema.js';

export function manifestFromScript(script: string): Manifest {
  const paragraphs = script
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) {
    throw new Error('manifestFromScript: script is empty');
  }
  const SEG = 4; // placeholder seconds; the voiceover stage rewrites timings from real durations
  const segments = paragraphs.map((vo_line, i) => ({
    id: `seg-${i}`,
    label: `Segment ${i + 1}`,
    start: i * SEG,
    end: (i + 1) * SEG,
    vo_line,
    actions: [{ type: 'idle', at: 0 }],
    transition: i === 0 ? 'fade_in' : 'none',
  }));
  return {
    total_duration_seconds: paragraphs.length * SEG,
    generated_from: 'studio-adhoc',
    segments,
  } as unknown as Manifest;
}
